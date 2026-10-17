using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One wheel of a tire check (MVP5-E); the mount and MeasuredAt of spec Part 2 live on its TireCheck.</summary>
public class TireMeasurement : Entity
{
    public const decimal MinPressureBar = 0.5m;
    public const decimal MaxPressureBar = 6.0m;
    public const decimal MaxTreadDepthMm = 20m;

    public Guid TireCheckId { get; set; }
    public TireCheck? TireCheck { get; set; }

    public TirePosition Position { get; set; }
    public decimal? PressureBar { get; set; }
    public decimal? TreadDepthMm { get; set; }
}
