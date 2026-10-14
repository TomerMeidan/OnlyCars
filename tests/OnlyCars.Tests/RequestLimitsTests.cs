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
            .AddApplicationPart(typeof(RequestLimitsTests).Assembly)
            .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = GlobalExceptionHandler.InvalidModelStateResponse);
        // Same as Program.cs.
        builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = c =>
            c.ProblemDetails.Extensions.TryAdd("code", GlobalExceptionHandler.FallbackCode(c.ProblemDetails.Status)));
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.AddCors(o => o.AddPolicy("test", p => p.WithOrigins("http://client.test")));

        var app = builder.Build();
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
}

[ApiController]
[Route("test/vehicles")]
public class ModelBindingTestController : ControllerBase
{
    [HttpPost]
    public IActionResult Create(CreateVehicleRequest request) => Ok();
}
