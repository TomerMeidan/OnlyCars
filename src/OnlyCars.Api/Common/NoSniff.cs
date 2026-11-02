namespace OnlyCars.Api.Common;

public static class NoSniff
{
    /// <summary>
    /// What the web app may load (2026-11-02): its own files; Google Fonts; Google's sign-in script, button and its frame; car photos
    /// from R2's signed links. No inline script anywhere (index.html's boot code is public/boot.js), so an injected script can't run
    /// and read the sign-in token. Inline styles are allowed: Google's sign-in script adds a style block, and a style can't run code
    /// or read the token, which is in localStorage, not the page. connect-src has the fonts because the service worker fetches them.
    /// </summary>
    public const string ContentSecurityPolicy =
        "default-src 'self'; " +
        "script-src 'self' https://accounts.google.com/gsi/client; " +
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "img-src 'self' data: https://*.r2.cloudflarestorage.com; " +
        "connect-src 'self' https://accounts.google.com/gsi/ https://fonts.googleapis.com https://fonts.gstatic.com; " +
        "frame-src https://accounts.google.com/gsi/; " +
        "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

    /// <summary>
    /// <c>X-Content-Type-Options: nosniff</c> on every response, and since the API also serves the web app (2026-10-31) no framing by
    /// other sites, the policy above and a referrer cut to the origin elsewhere. Set as the response starts, because the exception
    /// handler clears headers before writing its problem+json. Register first.
    /// </summary>
    public static IApplicationBuilder UseNoSniff(this IApplicationBuilder app) =>
        app.Use((ctx, next) =>
        {
            ctx.Response.OnStarting(() =>
            {
                var h = ctx.Response.Headers;
                h.XContentTypeOptions = "nosniff";
                h.XFrameOptions = "DENY";
                // Swagger (Development only) runs inline scripts; it keeps the framing rule alone. Elsewhere /swagger is just a page of the app.
                var swagger = ctx.Request.Path.StartsWithSegments("/swagger") && ctx.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment();
                h.ContentSecurityPolicy = swagger ? "frame-ancestors 'none'" : ContentSecurityPolicy;
                h["Referrer-Policy"] = "strict-origin-when-cross-origin";
                return Task.CompletedTask;
            });
            return next();
        });
}
