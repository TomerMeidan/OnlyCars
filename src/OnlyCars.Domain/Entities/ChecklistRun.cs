using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class ChecklistRun : Entity
{
    public const int MaxNotesLength = 1_000;

    public Guid VehicleChecklistId { get; set; }
    public VehicleChecklist? VehicleChecklist { get; set; }

    public DateOnly RunAt { get; set; }
    public decimal OdometerKm { get; set; }
    public string? Notes { get; set; }

    /// <summary>The Checklist reading this run logged (null when no odometer was entered); removed with the run.</summary>
    public Guid? OdometerReadingId { get; set; }
    public OdometerReading? OdometerReading { get; set; }

    public List<ChecklistRunItem> Items { get; set; } = [];
}
