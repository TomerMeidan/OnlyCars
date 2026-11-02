using System.Net.Http.Headers;
using System.Net.Http.Json;
using OnlyCars.Application.Common;

namespace OnlyCars.Infrastructure.Email;

/// <summary>Sends through Resend's REST API (POST /emails), so no SDK package is needed (NOT-2).</summary>
public sealed class ResendEmailSender(string apiKey, string from) : IEmailSender
{
    // One client for the app's life; the pooled-connection lifetime picks up DNS changes.
    private static readonly HttpClient Http = new(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.FromMinutes(15) })
    {
        BaseAddress = new Uri("https://api.resend.com/"),
        Timeout = TimeSpan.FromSeconds(30)
    };

    public async Task SendAsync(string to, string subject, string html, CancellationToken ct = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "emails")
        {
            Content = JsonContent.Create(new { from, to = new[] { to }, subject, html })
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        using var response = await Http.SendAsync(request, ct);
        // Status only: Resend's error body can repeat the address, which must not reach the logs.
        if (!response.IsSuccessStatusCode)
        {
            throw new HttpRequestException($"Resend returned {(int)response.StatusCode}.", null, response.StatusCode);
        }
    }
}
