using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class MaintenanceTask : Entity
{
    public const int MaxNameLength = 100;
    public const int MaxIntervalKm = 1_000_000;
    public const int MaxIntervalDays = 7_300;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    /// <summary>Only links to the template the task was created from; the task's own fields are what count.</summary>
    public Guid? TemplateId { get; set; }
    public TaskTemplate? Template { get; set; }

    public required string Name { get; set; }
    public TaskCategory Category { get; set; }
    public int? IntervalKm { get; set; }
    public int? IntervalDays { get; set; }
    public int DueSoonPercent { get; set; } = 10;
    public bool IsEnabled { get; set; } = true;
    public decimal LastDoneOdometerKm { get; set; }
    public DateOnly LastDoneDate { get; set; }
}
