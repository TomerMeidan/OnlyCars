namespace OnlyCars.Api.Common;

public static class NoSniff
{
    /// <summary>
    /// <c>X-Content-Type-Options: nosniff</c> on every response, and since the API also serves the web app (2026-10-31) no framing by
    /// other sites and a referrer cut to the origin elsewhere. Set as the response starts, because the exception handler clears
    /// headers before writing its problem+json. Register first.
    /// </summary>
    public static IApplicationBuilder UseNoSniff(this IApplicationBuilder app) =>
        app.Use((ctx, next) =>
        {
            ctx.Response.OnStarting(() =>
            {
                var h = ctx.Response.Headers;
                h.XContentTypeOptions = "nosniff";
                h.XFrameOptions = "DENY";
                h.ContentSecurityPolicy = "frame-ancestors 'none'";
                h["Referrer-Policy"] = "strict-origin-when-cross-origin";
                return Task.CompletedTask;
            });
            return next();
        });
}
