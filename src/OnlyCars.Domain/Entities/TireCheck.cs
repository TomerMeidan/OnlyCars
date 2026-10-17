using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A tire check (MVP5-E): one per mount per date, owning a TireMeasurement per wheel.</summary>
public class TireCheck : Entity
{
    public const int MaxPerMount = 200;

    public Guid TireMountId { get; set; }
    public TireMount? TireMount { get; set; }

    public DateOnly MeasuredAt { get; set; }

    public List<TireMeasurement> Measurements { get; set; } = [];
}
