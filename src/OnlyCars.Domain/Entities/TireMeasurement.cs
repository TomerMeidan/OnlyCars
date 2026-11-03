using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One tire's pressure and tread on a date (TIRE-2); a check is the car's measurements of one date.</summary>
public class TireMeasurement : Entity
{
    public const decimal MinPressureBar = 0.5m;
    public const decimal MaxPressureBar = 6.0m;
    public const decimal MaxTreadDepthMm = 20m;
    public const int MaxPerTire = 1_000;

    public Guid TireId { get; set; }
    public Tire? Tire { get; set; }

    /// <summary>Where the tire was when measured.</summary>
    public TirePosition Position { get; set; }
    public DateOnly MeasuredAt { get; set; }
    public decimal? PressureBar { get; set; }
    public decimal? TreadDepthMm { get; set; }
}
