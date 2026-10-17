using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A dated rotation of the mounted set (MVP5-E); it does not record which tire moved where.</summary>
public class TireRotation : Entity
{
    public const int MaxNotesLength = 500;
    public const int MaxPerMount = 100;

    public Guid TireMountId { get; set; }
    public TireMount? TireMount { get; set; }

    public DateOnly Date { get; set; }
    public decimal OdometerKm { get; set; }
    public string? Notes { get; set; }
}
