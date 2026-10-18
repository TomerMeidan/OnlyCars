namespace OnlyCars.Api.Common;

public static class NoSniff
{
    /// <summary>
    /// <c>X-Content-Type-Options: nosniff</c> on every response. Set as the response starts, because the exception handler clears
    /// headers before writing its problem+json. Register first.
    /// </summary>
    public static IApplicationBuilder UseNoSniff(this IApplicationBuilder app) =>
        app.Use((ctx, next) =>
        {
            ctx.Response.OnStarting(() =>
            {
                ctx.Response.Headers.XContentTypeOptions = "nosniff";
                return Task.CompletedTask;
            });
            return next();
        });
}
