using System.Net;
using System.Net.Sockets;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OnlyCars.Application.Auth;

namespace OnlyCars.Api.Common;

/// <summary>Per-IP rate limits (SEC-1) and the forwarded-headers setup they depend on.</summary>
public static class RequestLimits
{
    /// <summary>Applied to login and register, which share one bucket per IP.</summary>
    public const string AuthPolicy = "auth";

    // shortcut: rate-limit counters live in this process's memory (reset on restart, not shared between instances),
    // fine for one App Service instance; move to a shared store (Redis) if the API scales out.
    public static IServiceCollection AddRequestLimits(this IServiceCollection services, IConfiguration configuration)
    {
        var section = configuration.GetSection(RateLimitOptions.SectionName);
        services.AddOptions<RateLimitOptions>().Bind(section)
            .Validate(o => new[]
                {
                    o.AuthPermitLimit, o.AuthWindowSeconds, o.GlobalPermitLimit, o.GlobalWindowSeconds,
                    o.FailedLoginLimit, o.FailedLoginWindowSeconds
                }.All(v => v > 0), "Every RateLimiting value must be positive.")
            .ValidateOnStart();
        var limits = section.Get<RateLimitOptions>() ?? new RateLimitOptions();

        // App Service's front ends append the client IP to X-Forwarded-For and have no fixed addresses, so trust any
        // proxy. ForwardLimit stays 1: only the rightmost entry (added by Azure) is used, not ones a client sent.
        services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            o.KnownIPNetworks.Clear();
            o.KnownProxies.Clear();
        });

        services.AddRateLimiter(o =>
        {
            o.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
                FixedWindowPerIp(ctx, limits.GlobalPermitLimit, limits.GlobalWindowSeconds));
            // The middleware calls a policy's own OnRejected only when that policy rejected, so a global-limit
            // rejection on an auth endpoint still gets http.429.
            o.AddPolicy(AuthPolicy, new AuthLimitPolicy(limits));
            o.OnRejected = (context, ct) => RejectAsync(context, "http.429", ct);
        });

        return services;
    }

    /// <summary>
    /// The middleware that must run in this order, shared by Program.cs and the tests.
    /// Forwarded headers first, so the limiter sees the real client IP; CORS before the limiter, so a 429 carries
    /// the CORS headers the browser needs to read it.
    /// </summary>
    public static IApplicationBuilder UseRequestLimits(this IApplicationBuilder app, string corsPolicy) =>
        app.UseForwardedHeaders().UseCors(corsPolicy).UseRateLimiter();

    private sealed class AuthLimitPolicy(RateLimitOptions limits) : IRateLimiterPolicy<string>
    {
        public Func<OnRejectedContext, CancellationToken, ValueTask> OnRejected { get; } =
            (context, ct) => RejectAsync(context, "auth.tooManyAttempts", ct);

        public RateLimitPartition<string> GetPartition(HttpContext ctx) =>
            FixedWindowPerIp(ctx, limits.AuthPermitLimit, limits.AuthWindowSeconds);
    }

    private static async ValueTask RejectAsync(OnRejectedContext context, string code, CancellationToken ct)
    {
        var http = context.HttpContext;
        var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var r) ? r : TimeSpan.FromMinutes(1);

        http.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        http.Response.Headers.RetryAfter = Math.Max((int)Math.Ceiling(retryAfter.TotalSeconds), 1).ToString();
        await http.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = StatusCodes.Status429TooManyRequests,
            Title = "Too many requests",
            Detail = "Too many requests. Try again later.",
            Extensions = { ["code"] = code }
        }, ct);
    }

    private static RateLimitPartition<string> FixedWindowPerIp(HttpContext ctx, int permitLimit, int windowSeconds) =>
        RateLimitPartition.GetFixedWindowLimiter(ClientKey(ctx.Connection.RemoteIpAddress), _ =>
            new FixedWindowRateLimiterOptions
            {
                PermitLimit = permitLimit,
                Window = TimeSpan.FromSeconds(windowSeconds),
                QueueLimit = 0
            });

    /// <summary>IPv4 per address; IPv6 per /64, since one client usually holds a whole /64 (SEC-1 F4).</summary>
    public static string ClientKey(IPAddress? ip)
    {
        if (ip is null)
        {
            return "unknown";
        }

        if (ip.IsIPv4MappedToIPv6)
        {
            return ip.MapToIPv4().ToString();
        }

        if (ip.AddressFamily != AddressFamily.InterNetworkV6)
        {
            return ip.ToString();
        }

        var bytes = ip.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return new IPAddress(bytes) + "/64";
    }
}
