using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>
/// One per user and channel. No InApp row means DefaultLeadDays. LeadKm (spec Part 2) is not built (NOT-1).
/// No Email row means the daily digest is on and was never sent (NOT-2); its LeadDays is unused.
/// </summary>
public class NotificationRule : Entity
{
    public const int DefaultLeadDays = 30;
    public const int MinLeadDays = 1;
    public const int MaxLeadDays = 365;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public NotificationChannel Channel { get; set; }
    public int LeadDays { get; set; } = DefaultLeadDays;

    // Email row only: the user's opt-out of the daily digest.
    public bool IsEnabled { get; set; } = true;

    // Email row only: the Israel-time day the last digest went out, so a second run that day sends nothing.
    public DateOnly? LastSentOn { get; set; }
}
