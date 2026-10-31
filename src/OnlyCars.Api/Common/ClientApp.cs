namespace OnlyCars.Api.Common;

public static class ClientApp
{
    /// <summary>
    /// The built web app on the API's own address (deploy 2026-10-31: one Azure App Service, client/dist copied to wwwroot).
    /// Every path outside /api is a page of the app (/settings, /cars/…), answered with index.html so links and reloads work;
    /// an unknown /api path stays a 404. In Development there is no wwwroot: Vite serves the client.
    /// </summary>
    public static void MapClientApp(this WebApplication app)
    {
        app.UseStaticFiles();
        app.Map("/api/{**rest}", () => Results.NotFound()); // after every real endpoint, before the fallback
        app.MapFallbackToFile("index.html");
    }
}
