using System.Collections.Concurrent;
using System.Net;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Npgsql;
using OnlyCars.Api.Common;
using OnlyCars.Api.Middleware;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Reminders;
using Sentry;
using Sentry.AspNetCore;
using Sentry.Extensibility;
using Sentry.Protocol.Envelopes;

namespace OnlyCars.Tests;

/// <summary>
/// ERR-1a: what reaches Sentry, through a capturing transport (nothing leaves the machine). One class, so the tests don't run in
/// parallel: Sentry keeps one global hub.
/// </summary>
public class ErrorReportingTests
{
    private const string UserId = "6f1c2a7e-1111-4c4c-9a9a-123456789abc";

    private sealed class CapturingTransport : ITransport
    {
        public readonly ConcurrentQueue<JsonElement> Events = new();

        public async Task SendEnvelopeAsync(Envelope envelope, CancellationToken cancellationToken = default)
        {
            foreach (var item in envelope.Items.Where(i => i.TryGetType() == "event"))
            {
                using var stream = new MemoryStream();
                await item.Payload.SerializeAsync(stream, null, cancellationToken);
                Events.Enqueue(JsonDocument.Parse(stream.ToArray()).RootElement.Clone());
            }
        }
    }

    private static async Task<(WebApplication App, HttpClient Client)> StartAsync(CapturingTransport? transport, string environment = "Production",
        Action<WebApplicationBuilder>? configure = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = environment });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            // A made-up DSN, only to switch Sentry on; the capturing transport sends nothing.
            ["Sentry:Dsn"] = transport is null ? "" : "https://public@sentry.invalid/1",
            ["RENDER_GIT_COMMIT"] = "abc1234",
        });
        builder.AddErrorReporting(); // the same call as Program.cs
        if (transport is not null)
        {
            builder.Services.PostConfigure<SentryAspNetCoreOptions>(o => o.Transport = transport);
        }
        builder.Services.AddControllers().AddApplicationPart(typeof(ErrorReportingTests).Assembly)
            .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = GlobalExceptionHandler.InvalidModelStateResponse);
        builder.Services.AddProblemDetails();
        builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
        configure?.Invoke(builder);

        var app = builder.Build();
        app.UseExceptionHandler(_ => { });
        // Stands in for authentication: a signed-in user with an email claim, which must not reach Sentry.
        app.Use((ctx, next) =>
        {
            ctx.User = new ClaimsPrincipal(new ClaimsIdentity(
                [new Claim(ClaimTypes.NameIdentifier, UserId), new Claim(ClaimTypes.Email, "owner@example.com")], "test"));
            return next();
        });
        app.UseErrorReportingUser(); // the same call as Program.cs
        app.MapPost("/boom", (HttpRequest _) =>
        {
            throw new InvalidOperationException("Failed for owner@example.com at https://x.r2.cloudflarestorage.com/k?X-Amz-Signature=abc");
        });
        app.MapGet("/throw/{kind}", (string kind) =>
        {
            throw kind switch
            {
                "unavailable" => new ServiceUnavailableException("file.storageUnavailable", "down"),
                "validation" => new ValidationFailedException("x.invalid", "bad"),
                "unauthorized" => new UnauthorizedException("auth.invalidCredentials", "no"),
                "notFound" => new NotFoundException("Vehicle", Guid.NewGuid()),
                "expired" => new LinkExpiredException("link.expired", "old"),
                "conflict" => new ConflictException("vehicle.vinTaken", "taken"),
                "concurrency" => new DbUpdateConcurrencyException("expected to affect 1 row(s)"),
                "tooLarge" => new PayloadTooLargeException("file.tooLarge", "big"),
                "bodyTooLarge" => new BadHttpRequestException("Request body too large.", 413),
                "tooMany" => new TooManyRequestsException("auth.tooManyAttempts", "slow down", 60),
                "pg22P02" => new DbUpdateException("An error occurred while saving the entity changes.",
                    new PostgresException("invalid input syntax for type uuid: \"nick-secret\"", "ERROR", "ERROR", "22P02")),
                "pg23505" => new PostgresException("duplicate key value violates unique constraint \"IX_Vehicles_UserId_Vin\"", "ERROR", "ERROR", "23505",
                    detail: "Key (\"UserId\", \"Vin\")=(owner@example.com, vin-secret) already exists."),
                _ => new InvalidOperationException(kind),
            };
        });
        app.MapDevThrow(); // the same call as Program.cs
        app.MapControllers();
        await app.StartAsync();
        return (app, new HttpClient { BaseAddress = new Uri(app.Urls.First()) });
    }

    private static async Task<JsonElement[]> FlushAsync(WebApplication app, CapturingTransport transport)
    {
        await app.Services.GetRequiredService<IHub>().FlushAsync(TimeSpan.FromSeconds(5));
        return transport.Events.ToArray();
    }

    [Fact]
    public async Task NoDsn_SentryIsOff_AndTheApiAnswersAsBefore()
    {
        var (app, client) = await StartAsync(transport: null);

        Assert.Null(app.Services.GetService<IHub>());
        Assert.Equal(HttpStatusCode.InternalServerError, (await client.PostAsync("/boom", null)).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await client.GetAsync("/throw/unavailable")).StatusCode);
        await app.DisposeAsync();
    }

    [Theory]
    [InlineData("/throw/other", 500)]
    [InlineData("/throw/unavailable", 503)]
    public async Task A5xx_GivesExactlyOneEvent_WithEnvironmentAndRelease(string path, int status)
    {
        var transport = new CapturingTransport();
        var (app, client) = await StartAsync(transport);

        Assert.Equal(status, (int)(await client.GetAsync(path)).StatusCode);

        var e = Assert.Single(await FlushAsync(app, transport));
        Assert.Equal("production", e.GetProperty("environment").GetString());
        Assert.Equal("abc1234", e.GetProperty("release").GetString());
        await app.DisposeAsync();
    }

    [Fact]
    public async Task Expected4xx_GiveNoEvent()
    {
        var transport = new CapturingTransport();
        var (app, client) = await StartAsync(transport);

        var kinds = new Dictionary<string, int>
        {
            ["validation"] = 400, ["unauthorized"] = 401, ["notFound"] = 404, ["expired"] = 404, ["conflict"] = 409,
            ["concurrency"] = 409, ["tooLarge"] = 413, ["bodyTooLarge"] = 413, ["tooMany"] = 429,
        };
        foreach (var (kind, status) in kinds)
        {
            Assert.Equal(status, (int)(await client.GetAsync($"/throw/{kind}")).StatusCode);
        }
        var binding = await client.PostAsync("/test/vehicles", new StringContent("{", Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, binding.StatusCode); // model binding

        Assert.Empty(await FlushAsync(app, transport));
        await app.DisposeAsync();
    }

    [Fact]
    public async Task A500_SendsNoHeadersCookiesBodyQueryEmailOrSignature_AndTheUserIsOnlyAnId()
    {
        var transport = new CapturingTransport();
        var (app, client) = await StartAsync(transport);

        var request = new HttpRequestMessage(HttpMethod.Post, "/boom?q=oil")
        {
            Content = new StringContent("""{"notes":"body-secret"}""", Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("Authorization", "Bearer token-secret");
        request.Headers.Add("Cookie", "session=cookie-secret");
        request.Headers.Add("X-Job-Key", "job-secret");
        request.Headers.Add("Referer", "https://onlycars.test/history?q=oil");
        request.Headers.Add("User-Agent", "Mozilla/5.0 test");
        Assert.Equal(HttpStatusCode.InternalServerError, (await client.SendAsync(request)).StatusCode);

        var e = Assert.Single(await FlushAsync(app, transport));
        var json = e.GetRawText();
        foreach (var leak in new[] { "token-secret", "cookie-secret", "job-secret", "body-secret", "q=oil", "owner@example.com", "X-Amz-Signature" })
        {
            Assert.DoesNotContain(leak, json, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Contains("https://x.r2.cloudflarestorage.com/k?[scrubbed]", json); // the host and path stay, to see what failed
        Assert.Equal([$"id:{UserId}"], e.GetProperty("user").EnumerateObject().Select(p => $"{p.Name}:{p.Value.GetString()}"));
        var sent = e.GetProperty("request");
        Assert.EndsWith("/boom", sent.GetProperty("url").GetString());
        Assert.Equal(["User-Agent"], sent.GetProperty("headers").EnumerateObject().Select(h => h.Name)); // the browser only
        Assert.False(sent.TryGetProperty("cookies", out _));
        Assert.False(sent.TryGetProperty("query_string", out _));
        Assert.False(sent.TryGetProperty("data", out _));
        await app.DisposeAsync();
    }

    [Fact]
    public async Task TheDailyDigestFailing_GivesOneScrubbedEvent()
    {
        var transport = new CapturingTransport();
        var (app, _) = await StartAsync(transport, configure: b =>
        {
            b.Services.Configure<EmailOptions>(o => o.DigestHourLocal = 0); // runs at start, any time of day
            b.Services.AddScoped<DigestService>(_ => throw new InvalidOperationException("owner@example.com"));
            b.Services.AddHostedService<DailyDigestTimer>();
        });

        JsonElement[] events = [];
        for (var i = 0; i < 50 && events.Length == 0; i++)
        {
            events = await FlushAsync(app, transport); // the timer logs on its own thread, shortly after start
            await Task.Delay(100);
        }

        var e = Assert.Single(events);
        Assert.Equal("Daily digest run failed: InvalidOperationException", e.GetProperty("logentry").GetProperty("formatted").GetString());
        Assert.DoesNotContain("owner@example.com", e.GetRawText());
        await app.DisposeAsync();
    }

    [Theory]
    [InlineData("Production", HttpStatusCode.NotFound)]
    [InlineData("Staging", HttpStatusCode.NotFound)]
    [InlineData("Development", HttpStatusCode.InternalServerError)]
    public async Task DevThrow_OnlyInDevelopment(string environment, HttpStatusCode expected)
    {
        var (app, client) = await StartAsync(transport: null, environment);

        Assert.Equal(expected, (await client.GetAsync("/api/dev/throw")).StatusCode);
        await app.DisposeAsync();
    }

    [Theory]
    [InlineData("/throw/pg22P02", "DbUpdateException, SQLSTATE 22P02", "nick-secret")]
    [InlineData("/throw/pg23505", "PostgresException, SQLSTATE 23505", "vin-secret")]
    public async Task ADatabaseError_SendsOnlyTheTypeAndSqlState_NotTheRowValues(string path, string expected, string secret)
    {
        var transport = new CapturingTransport();
        var (app, client) = await StartAsync(transport);

        Assert.Equal(HttpStatusCode.InternalServerError, (await client.GetAsync(path)).StatusCode);

        var e = Assert.Single(await FlushAsync(app, transport));
        var json = e.GetRawText();
        Assert.DoesNotContain(secret, json);
        Assert.DoesNotContain("owner@example.com", json);
        Assert.Contains(expected, e.GetProperty("exception").GetProperty("values").EnumerateArray().Select(v => v.GetProperty("value").GetString()));
        await app.DisposeAsync();
    }

    [Theory]
    [InlineData("see owner.name+cars@mail.example.co.il now", "see [scrubbed] now")]
    [InlineData("GET https://a.test/p?X-Amz-Signature=abc&b=1 failed", "GET https://a.test/p?[scrubbed] failed")]
    [InlineData("no url or email", "no url or email")]
    [InlineData("DETAIL: Key (\"Vin\")=(a), b) already exists.", "DETAIL: Key ([scrubbed]")]
    [InlineData("DETAIL: Failing row contains (it's\nsecret).", "DETAIL: Failing row contains [scrubbed]")]
    public void ScrubText_RemovesEmailsUrlQueriesAndSqlRowValues(string text, string expected) =>
        Assert.Equal(expected, ErrorReporting.ScrubText(text));
}
