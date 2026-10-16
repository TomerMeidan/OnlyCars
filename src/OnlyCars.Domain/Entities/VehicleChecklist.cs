using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A checklist template attached to a car with a schedule; both intervals null is "manual only" (MVP5-B).</summary>
public class VehicleChecklist : Entity
{
    public const int MaxIntervalKm = 1_000_000;
    public const int MaxIntervalDays = 3_650;
    public const int DueSoonPercent = 10;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public Guid TemplateId { get; set; }
    public ChecklistTemplate? Template { get; set; }

    public int? IntervalKm { get; set; }
    public int? IntervalDays { get; set; }
    public bool IsEnabled { get; set; } = true;
    public decimal LastRunOdometerKm { get; set; }
    public DateOnly LastRunDate { get; set; }

    /// <summary>The attach values (beyond spec Part 2): the last run falls back to them when runs are deleted.</summary>
    public DateOnly StartDate { get; set; }
    public decimal StartOdometerKm { get; set; }

    public List<ChecklistRun> Runs { get; set; } = [];
}
