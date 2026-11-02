namespace OnlyCars.Application.Reminders;

/// <summary>The "Email" section (NOT-2). Without ResendApiKey nothing is sent; without JobKey the job endpoint is a 404.</summary>
public class EmailOptions
{
    public const string SectionName = "Email";

    public string? ResendApiKey { get; set; }
    public string? From { get; set; }
    public string? SiteUrl { get; set; }
    public string? JobKey { get; set; }
    public int DigestHourLocal { get; set; } = 8;
}
