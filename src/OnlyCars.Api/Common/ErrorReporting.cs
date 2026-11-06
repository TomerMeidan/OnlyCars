using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Api.Middleware;
using Sentry;
using Sentry.AspNetCore;
using Sentry.Extensibility;
using Sentry.Extensions.Logging;

namespace OnlyCars.Api.Common;

/// <summary>
/// ERR-1a: the API's 5xx and Error-level logs go to Sentry (`onlycars-api`), with nothing personal in them. Off without Sentry:Dsn,
/// so local runs, tests and CI send nothing.
/// </summary>
public static partial class ErrorReporting
{
    private const string Scrubbed = "[scrubbed]";

    public static void AddErrorReporting(this WebApplicationBuilder builder)
    {
        if (string.IsNullOrWhiteSpace(builder.Configuration["Sentry:Dsn"]))
        {
            return;
        }

        var release = builder.Configuration["RENDER_GIT_COMMIT"] is { Length: > 0 } commit ? commit : null;
        builder.WebHost.UseSentry((SentryAspNetCoreOptions o) => // binds the "Sentry" section too, so Sentry:Dsn comes from there
        {
            o.Environment = builder.Environment.EnvironmentName.ToLowerInvariant();
            o.Release = release;
            o.SendDefaultPii = false;
            o.MaxRequestBodySize = RequestSize.None;
            o.TracesSampleRate = 0;
            o.EnableLogs = false;
            o.DisableUnobservedTaskExceptionCapture(); // only the 5xx and Error logs (ERR-1a scope), not background task noise
            o.MinimumEventLevel = LogLevel.Error;
            o.MinimumBreadcrumbLevel = LogLevel.Warning;
            // EF Core's own error logs repeat the 500 with the SQL text; the handler's log reports it once.
            o.AddLogEntryFilter((category, _, _, _) => category.StartsWith("Microsoft.EntityFrameworkCore", StringComparison.Ordinal));
            o.SetBeforeSend(e => Scrub(e, release));
            o.SetBeforeBreadcrumb(b => new Breadcrumb(ScrubText(b.Message) ?? "", b.Type,
                b.Data?.ToDictionary(d => d.Key, d => ScrubText(d.Value) ?? ""), b.Category, b.Level));
        });
    }

    /// <summary>The signed-in user's id on the request's Sentry scope; nothing else about the user. After authentication.</summary>
    public static IApplicationBuilder UseErrorReportingUser(this IApplicationBuilder app) =>
        app.Use((ctx, next) =>
        {
            if ((ctx.User.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)) is { } id)
            {
                ctx.RequestServices.GetService<IHub>()?.ConfigureScope(s => s.User = new SentryUser { Id = id });
            }
            return next();
        });

    /// <summary>A test error for the whole path, locally. Development only: elsewhere the path stays a 404.</summary>
    public static void MapDevThrow(this WebApplication app)
    {
        if (app.Environment.IsDevelopment())
        {
            app.MapGet("/api/dev/throw", () => { throw new InvalidOperationException("ERR-1a test error from /api/dev/throw"); });
        }
    }

    /// <summary>Drops the expected 4xx and removes anything personal (trust boundary): body, cookies, headers, query strings, emails.</summary>
    public static SentryEvent? Scrub(SentryEvent e, string? release)
    {
        if (e.Exception is { } ex && GlobalExceptionHandler.StatusFor(ex).Status < 500)
        {
            return null; // the middleware also sees exceptions the handler answered with a 4xx
        }

        e.Release = release; // no commit (local): no release, not the assembly version Sentry would pick
        e.User = new SentryUser { Id = e.User.Id };

        var request = e.Request;
        request.Url = request.Url is { } url ? url.Split('?', 2)[0] : null;
        request.QueryString = null;
        request.Cookies = null;
        request.Data = null;
        request.Env.Clear();
        foreach (var name in request.Headers.Keys.Where(k => !k.Equals("User-Agent", StringComparison.OrdinalIgnoreCase)).ToList())
        {
            request.Headers.Remove(name); // only the browser; Authorization, Cookie, X-Job-Key, Referer and the rest stay out
        }

        if (e.Message is { } message)
        {
            message.Message = ScrubText(message.Message);
            message.Formatted = ScrubText(message.Formatted);
            message.Params = null;
        }
        // SQL Server quotes row values in its messages (2627/2601 duplicate key, 2628 truncation): only the type and number go.
        var databaseTypes = Chain(e.Exception).Where(x => x is SqlException or DbUpdateException).Select(x => x.GetType().FullName).ToHashSet();
        var sqlNumber = SqlNumber(e.Exception);
        foreach (var exception in e.SentryExceptions ?? [])
        {
            exception.Value = databaseTypes.Contains(exception.Type)
                ? $"{exception.Type?.Split('.')[^1]}{(sqlNumber is { } n ? $", SQL error {n}" : "")}"
                : ScrubText(exception.Value);
        }
        foreach (var (key, value) in e.Extra.ToList())
        {
            e.SetExtra(key, value is string text ? ScrubText(text) : value);
        }
        foreach (var (key, value) in e.Tags.ToList())
        {
            e.SetTag(key, ScrubText(value) ?? "");
        }
        return e;
    }

    /// <summary>The SQL Server error number in an exception or its inner ones, if any.</summary>
    public static int? SqlNumber(Exception? ex) => Chain(ex).OfType<SqlException>().FirstOrDefault()?.Number;

    private static IEnumerable<Exception> Chain(Exception? ex)
    {
        for (; ex is not null; ex = ex.InnerException)
        {
            yield return ex;
        }
    }

    /// <summary>
    /// A database or storage error can quote a value: emails, the query part of URLs (signed links, search words) and everything
    /// after SQL Server's quoted row values go.
    /// </summary>
    public static string? ScrubText(string? text) =>
        text is null ? null : SqlValue().Replace(Email().Replace(UrlQuery().Replace(text, "$1?" + Scrubbed), Scrubbed), "$1" + Scrubbed);

    // To the end of the text: a quoted value can hold anything, newlines and quotes included.
    [GeneratedRegex(@"(duplicate key value is |Truncated value: ).*", RegexOptions.IgnoreCase | RegexOptions.Singleline)]
    private static partial Regex SqlValue();

    [GeneratedRegex(@"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")]
    private static partial Regex Email();

    [GeneratedRegex(@"(\b[a-z][a-z0-9+.\-]*://[^\s?#""'<>]+)\?[^\s#""'<>]*", RegexOptions.IgnoreCase)]
    private static partial Regex UrlQuery();
}
