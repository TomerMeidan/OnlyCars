using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>An expiring car document (NOT-1). Renewing edits ExpiryDate; old dates aren't kept.</summary>
public class VehicleDocument : Entity
{
    public const int MaxNotesLength = 1_000;
    public const int MaxPerVehicle = 50;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public VehicleDocumentType Type { get; set; }
    public DateOnly ExpiryDate { get; set; }
    public decimal? Cost { get; set; }
    public string? Notes { get; set; }

    public List<Attachment> Attachments { get; set; } = [];
}
