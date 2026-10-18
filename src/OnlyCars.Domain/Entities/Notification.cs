using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One per (user, kind, item): the snooze now, the sent mark with NOT-2. RefId is a task, vehicle checklist or document id.</summary>
public class Notification : Entity
{
    public Guid UserId { get; set; }
    public User? User { get; set; }

    // No FK: a second cascade path from User through Vehicle is refused by SQL Server.
    public Guid VehicleId { get; set; }
    public NotificationKind Kind { get; set; }
    public Guid RefId { get; set; }
    public DateTimeOffset? SentAt { get; set; }
    public DateOnly? SnoozedUntil { get; set; }
}
