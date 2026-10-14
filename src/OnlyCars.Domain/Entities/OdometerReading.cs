using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class OdometerReading : Entity
{
    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public const decimal MaxValueKm = 10_000_000;

    public decimal ValueKm { get; set; }
    public DateOnly ReadingDate { get; set; }
    public OdometerSource Source { get; set; } = OdometerSource.Manual;
}
