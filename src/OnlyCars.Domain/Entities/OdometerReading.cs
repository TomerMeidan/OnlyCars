using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class OdometerReading : Entity
{
    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public const decimal MaxValueKm = 10_000_000;
    public const int MaxPerVehicle = 5_000;

    public decimal ValueKm { get; set; }
    public DateOnly ReadingDate { get; set; }
    public OdometerSource Source { get; set; } = OdometerSource.Manual;

    /// <summary>Set on the reading a reset logged, so undo can find and remove it.</summary>
    public Guid? ServiceRecordId { get; set; }
    public ServiceRecord? ServiceRecord { get; set; }
}
