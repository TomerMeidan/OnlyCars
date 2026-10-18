using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One per user and channel. No InApp row means DefaultLeadDays. LeadKm (spec Part 2) is not built (NOT-1).</summary>
public class NotificationRule : Entity
{
    public const int DefaultLeadDays = 30;
    public const int MinLeadDays = 1;
    public const int MaxLeadDays = 365;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public NotificationChannel Channel { get; set; }
    public int LeadDays { get; set; } = DefaultLeadDays;
}
