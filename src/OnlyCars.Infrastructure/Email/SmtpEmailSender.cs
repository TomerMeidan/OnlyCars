using System.Net;
using System.Net.Mail;
using System.Text;
using OnlyCars.Application.Common;

namespace OnlyCars.Infrastructure.Email;

/// <summary>
/// Sends through an SMTP server with a login, by default Gmail with an app password (owner, 2026-11-02: free, and reaches anyone,
/// unlike Resend without a domain). .NET's own SmtpClient, so no package; one client per send, as SmtpClient isn't thread-safe.
/// </summary>
public sealed class SmtpEmailSender(string host, int port, string user, string password, string from) : IEmailSender
{
    public async Task SendAsync(string to, string subject, string html, CancellationToken ct = default)
    {
        using var message = Message(from, to, subject, html);
        using var smtp = new SmtpClient(host, port) { EnableSsl = true, Credentials = new NetworkCredential(user, password), Timeout = 30_000 };
        try
        {
            await smtp.SendMailAsync(message, ct);
        }
        catch (SmtpException ex)
        {
            // Status only: the server's text can repeat the address, which must not reach the logs.
            throw new InvalidOperationException($"SMTP send failed: {ex.StatusCode}.");
        }
    }

    /// <summary>UTF-8 HTML, so Hebrew subjects and bodies arrive intact. From is "OnlyCars &lt;me@gmail.com&gt;" or a bare address.</summary>
    public static MailMessage Message(string from, string to, string subject, string html) =>
        new(new MailAddress(from), new MailAddress(to))
        {
            Subject = subject,
            SubjectEncoding = Encoding.UTF8,
            Body = html,
            BodyEncoding = Encoding.UTF8,
            IsBodyHtml = true
        };
}
