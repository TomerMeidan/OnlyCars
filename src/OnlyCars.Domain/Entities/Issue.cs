using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A to-do on a car, added by hand or from a flagged checklist run item (MVP5-C).</summary>
public class Issue : Entity
{
    public const int MaxTitleLength = 100;
    public const int MaxDescriptionLength = 1_000;
    public const int MaxPerVehicle = 500;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public required string Title { get; set; }
    public string? Description { get; set; }
    public IssueStatus Status { get; set; }

    /// <summary>The flagged run item it came from; at most one to-do per run item. Cleared when the run is deleted.</summary>
    public Guid? SourceRunItemId { get; set; }
    public ChecklistRunItem? SourceRunItem { get; set; }

    /// <summary>The client's local date it was marked done; null while open.</summary>
    public DateOnly? ResolvedAt { get; set; }
}
