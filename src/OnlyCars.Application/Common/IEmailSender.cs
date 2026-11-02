namespace OnlyCars.Application.Common;

/// <summary>Sends one email (NOT-2). Registered only when Email:ResendApiKey is set; otherwise services get null and send nothing.</summary>
public interface IEmailSender
{
    Task SendAsync(string to, string subject, string html, CancellationToken ct = default);
}
