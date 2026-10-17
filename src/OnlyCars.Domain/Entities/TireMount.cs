using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A tire set on a car from MountedAt; open (on the car now) while UnmountedAt is null.</summary>
public class TireMount : Entity
{
    public Guid TireSetId { get; set; }
    public TireSet? TireSet { get; set; }

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public DateOnly MountedAt { get; set; }
    public decimal MountOdometerKm { get; set; }
    public DateOnly? UnmountedAt { get; set; }
    public decimal? UnmountOdometerKm { get; set; }

    public List<TireCheck> Checks { get; set; } = [];
    public List<TireRotation> Rotations { get; set; } = [];
}
