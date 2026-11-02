namespace OnlyCars.Application.Reminders;

/// <summary>
/// The "Email" section (NOT-2). Sends through Resend with ResendApiKey, else through SMTP (Gmail by default) with SmtpUser and
/// SmtpPassword; with neither nothing is sent. Without JobKey the job endpoint is a 404.
/// </summary>
public class EmailOptions
{
    public const string SectionName = "Email";

    public string? ResendApiKey { get; set; }
    public string? SmtpUser { get; set; }
    public string? SmtpPassword { get; set; }
    public string SmtpHost { get; set; } = "smtp.gmail.com";
    public int SmtpPort { get; set; } = 587;
    public string? From { get; set; }
    public string? SiteUrl { get; set; }
    public string? JobKey { get; set; }
    public int DigestHourLocal { get; set; } = 8;
}
