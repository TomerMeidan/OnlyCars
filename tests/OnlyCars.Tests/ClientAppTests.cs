using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using OnlyCars.Api.Common;

namespace OnlyCars.Tests;

/// <summary>The API serving the built web app (deploy 2026-10-31), on a real Kestrel host with a throwaway wwwroot.</summary>
public class ClientAppTests
{
    [Fact]
    public async Task PagesGetIndex_FilesThemselves_AndUnknownApiPathsStay404()
    {
        var root = Directory.CreateTempSubdirectory("onlycars-client-").FullName;
        Directory.CreateDirectory(Path.Combine(root, "wwwroot"));
        await File.WriteAllTextAsync(Path.Combine(root, "wwwroot", "index.html"), "<!doctype html>app");
        await File.WriteAllTextAsync(Path.Combine(root, "wwwroot", "app.js"), "js");
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { ContentRootPath = root, WebRootPath = Path.Combine(root, "wwwroot") });
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        app.UseNoSniff();
        app.MapGet("/api/ping", () => "pong");
        app.MapClientApp();
        await app.StartAsync();
        using var client = new HttpClient { BaseAddress = new Uri(app.Urls.First()) };

        foreach (var page in new[] { "/", "/settings", "/cars/abc/checklists/def/run", "/apiary" })
        {
            Assert.Equal("<!doctype html>app", await client.GetStringAsync(page));
        }
        Assert.Equal("js", await client.GetStringAsync("/app.js"));
        Assert.Equal("pong", await client.GetStringAsync("/api/ping"));
        foreach (var api in new[] { "/api/nope", "/api" })
        {
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(api)).StatusCode);
        }

        var headers = (await client.GetAsync("/settings")).Headers;
        Assert.Equal("DENY", headers.GetValues("X-Frame-Options").Single());
        Assert.Equal(NoSniff.ContentSecurityPolicy, headers.GetValues("Content-Security-Policy").Single());
        var scripts = NoSniff.ContentSecurityPolicy.Split("; ").Single(d => d.StartsWith("script-src "));
        Assert.DoesNotContain("unsafe", scripts); // only scripts from the site and Google's sign-in run, never inline code

        await app.StopAsync();
        Directory.Delete(root, true);
    }
}
