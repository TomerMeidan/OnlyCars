using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OnlyCars.Api.Common;
using OnlyCars.Api.Controllers;
using OnlyCars.Api.Middleware;
using OnlyCars.Application.Issues.Dtos;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles.Dtos;

namespace OnlyCars.Tests;

/// <summary>
/// Runs the API's rate limiting, forwarded headers and model-binding setup on a real Kestrel host,
/// with stub endpoints in place of the controllers that need a database.
/// </summary>
public class RequestLimitsTests
{
    private static async Task<(WebApplication App, HttpClient Client)> StartAsync(int authLimit = 3, int globalLimit = 100, int failedLoginLimit = 10)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["RateLimiting:AuthPermitLimit"] = authLimit.ToString(),
            ["RateLimiting:AuthWindowSeconds"] = "900",
            ["RateLimiting:GlobalPermitLimit"] = globalLimit.ToString(),
            ["RateLimiting:GlobalWindowSeconds"] = "60",
            ["RateLimiting:FailedLoginLimit"] = failedLoginLimit.ToString(),
        });
        builder.Services.AddControllers()
            .AddJsonOptions(ApiJson.Configure) // same as Program.cs
            .AddApplicationPart(typeof(RequestLimitsTests).Assembly)
            .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = GlobalExceptionHandler.InvalidModelStateResponse);
        // Same as Program.cs.
        builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = c =>
            c.ProblemDetails.Extensions.TryAdd("code", GlobalExceptionHandler.FallbackCode(c.ProblemDetails.Status)));
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.AddAuthentication(); // UseRequestLimits runs authentication; no scheme here, so nobody signs in
        builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
        builder.Services.AddCors(o => o.AddPolicy("test", p => p.WithOrigins("http://client.test")));

        var app = builder.Build();
        app.UseExceptionHandler(_ => { });
        app.UseRequestLimits("test"); // the same call as Program.cs
        app.MapPost("/api/auth/login", () => "ok").RequireRateLimiting(RequestLimits.AuthPolicy);
        app.MapPost("/api/auth/register", () => "ok").RequireRateLimiting(RequestLimits.AuthPolicy);
        app.MapGet("/api/ping", () => "ok");
        app.MapControllers();
        await app.StartAsync();

        return (app, new HttpClient { BaseAddress = new Uri(app.Urls.First()) });
    }

    private static HttpRequestMessage Post(string path, string? forwardedFor = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent("{}", Encoding.UTF8, "application/json") };
        if (forwardedFor is not null)
        {
            request.Headers.Add("X-Forwarded-For", forwardedFor);
        }
        return request;
    }

    [Fact]
    public void AuthController_UsesTheAuthPolicy()
    {
        var attribute = typeof(AuthController).GetCustomAttributes(typeof(EnableRateLimitingAttribute), true).Single();
        Assert.Equal(RequestLimits.AuthPolicy, ((EnableRateLimitingAttribute)attribute).PolicyName);
    }

    [Fact]
    public async Task AuthLimit_CountsLoginAndRegisterTogether_ThenReturns429WithCodeAndRetryAfter()
    {
        var (app, client) = await StartAsync(authLimit: 3);
        await using var _ = app;

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post("/api/auth/register"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post("/api/auth/login"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post("/api/auth/login"))).StatusCode);

        var rejected = await client.SendAsync(Post("/api/auth/register"));

        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        var retryAfter = int.Parse(rejected.Headers.GetValues("Retry-After").Single());
        Assert.InRange(retryAfter, 1, 900);
        var body = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("auth.tooManyAttempts", body.GetProperty("code").GetString());
        Assert.Equal(429, body.GetProperty("status").GetInt32());

        // Non-auth endpoints are still open.
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/ping")).StatusCode);
    }

    [Fact]
    public async Task GlobalLimit_Returns429WithHttpCode()
    {
        var (app, client) = await StartAsync(globalLimit: 2);
        await using var _ = app;

        await client.GetAsync("/api/ping");
        await client.GetAsync("/api/ping");
        var rejected = await client.GetAsync("/api/ping");

        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.True(rejected.Headers.Contains("Retry-After"));
        var body = JsonDocument.Parse(await rejected.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("http.429", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task ForwardedFor_GivesEachClientIpItsOwnBucket()
    {
        var (app, client) = await StartAsync(authLimit: 1);
        await using var _ = app;

        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post("/api/auth/login", "203.0.113.1"))).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.SendAsync(Post("/api/auth/login", "203.0.113.1"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(Post("/api/auth/login", "203.0.113.2"))).StatusCode);
        // Prepending a fake entry doesn't escape the bucket: only the rightmost (proxy-added) entry is used.
        Assert.Equal(HttpStatusCode.TooManyRequests,
            (await client.SendAsync(Post("/api/auth/login", "198.51.100.9, 203.0.113.1"))).StatusCode);
    }

    [Fact]
    public async Task ModelBindingError_HasFieldNamesOnly_NoTypeNames()
    {
        var (app, client) = await StartAsync();
        await using var _ = app;

        var response = await client.PostAsync("/test/vehicles",
            new StringContent("""{"year":"abc"}""", Encoding.UTF8, "application/json"));
        var text = await response.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("OnlyCars", text);
        Assert.DoesNotContain("Dtos", text);
        Assert.DoesNotContain("LineNumber", text);
        Assert.DoesNotContain("$", text);
        var body = JsonDocument.Parse(text).RootElement;
        Assert.Equal("http.400", body.GetProperty("code").GetString());
        Assert.Equal("Invalid value.", body.GetProperty("errors").GetProperty("year")[0].GetString());
    }

    // L65: names bind, numbers (defined or not) are a plain http.400 on every enum field.
    [Theory]
    [InlineData("/test/vehicles", """{"nickname":"A","fuelType":"Petrol"}""", HttpStatusCode.OK)]
    [InlineData("/test/vehicles", """{"nickname":"A","fuelType":99}""", HttpStatusCode.BadRequest)]
    [InlineData("/test/vehicles", """{"nickname":"A","fuelType":0}""", HttpStatusCode.BadRequest)]
    [InlineData("/test/vehicles", """{"nickname":"A","fuelType":"99"}""", HttpStatusCode.BadRequest)]
    [InlineData("/test/issues", """{"title":"A","status":"Done"}""", HttpStatusCode.OK)]
    [InlineData("/test/issues", """{"title":"A","status":2}""", HttpStatusCode.BadRequest)]
    [InlineData("/test/tire-sets", """{"brand":"A","season":"AllSeason"}""", HttpStatusCode.OK)]
    [InlineData("/test/tire-sets", """{"brand":"A","season":1}""", HttpStatusCode.BadRequest)]
    [InlineData("/test/tire-checks", """{"items":[{"position":"Spare","pressureBar":2.4}]}""", HttpStatusCode.OK)]
    [InlineData("/test/tire-checks", """{"items":[{"position":0,"pressureBar":2.4}]}""", HttpStatusCode.BadRequest)]
    public async Task EnumValues_BindByNameOnly(string path, string json, HttpStatusCode expected)
    {
        var (app, client) = await StartAsync();
        await using var _ = app;

        var response = await client.PostAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.Equal(expected, response.StatusCode);
        if (expected == HttpStatusCode.BadRequest)
        {
            Assert.Equal("http.400", JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString());
        }
    }

    // L37 and L62: the app-wide 64 KB body limit, on any endpoint.
    [Fact]
    public async Task BodyOver64KB_Is413_WithCode_AtTheLimitIsFine()
    {
        var (app, client) = await StartAsync();
        await using var _ = app;
        string Body(long size) => "{\"nickname\":\"" + new string('a', (int)size - 15) + "\"}";

        var atLimit = await client.PostAsync("/test/vehicles", new StringContent(Body(RequestLimits.MaxBodyBytes), Encoding.UTF8, "application/json"));
        var over = await client.PostAsync("/test/vehicles", new StringContent(Body(RequestLimits.MaxBodyBytes + 1), Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, atLimit.StatusCode);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, over.StatusCode);
        Assert.Equal("http.413", JsonDocument.Parse(await over.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString());
    }

    // L119: the API's own appsettings files, as the host layers them per environment.
    [Theory]
    [InlineData("Production", 10)]
    [InlineData("Development", 10_000)]
    public void UploadPermitLimit_IsHighInDevelopmentOnly(string environment, int expected)
    {
        var config = new ConfigurationBuilder().SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json").AddJsonFile($"appsettings.{environment}.json", optional: true).Build();

        Assert.Equal(expected, config.GetSection("RateLimiting").Get<OnlyCars.Application.Auth.RateLimitOptions>()!.UploadPermitLimit);
    }
}

[ApiController]
[Route("test")]
public class ModelBindingTestController : ControllerBase
{
    [HttpPost("vehicles")]
    public IActionResult Create(CreateVehicleRequest request) => Ok();

    [HttpPost("issues")]
    public IActionResult Update(UpdateIssueRequest request) => Ok();

    [HttpPost("tire-sets")]
    public IActionResult CreateTireSet(TireSetRequest request) => Ok();

    [HttpPost("tire-checks")]
    public IActionResult CreateTireCheck(TireCheckRequest request) => Ok();
}
