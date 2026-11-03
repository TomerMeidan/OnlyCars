using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A rotation of a car's tires (TIRE-2); migrated rotations have no moves ("Wheels not recorded").</summary>
public class TireRotation : Entity
{
    public const int MaxNotesLength = 500;
    public const int MaxPerVehicle = 200;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public DateOnly Date { get; set; }
    public decimal OdometerKm { get; set; }
    public string? Notes { get; set; }

    public List<TireRotationMove> Moves { get; set; } = [];
}

/// <summary>One tire of a rotation, from one wheel to another.</summary>
public class TireRotationMove : Entity
{
    public Guid TireRotationId { get; set; }
    public TireRotation? TireRotation { get; set; }

    public Guid TireId { get; set; }
    public Tire? Tire { get; set; }

    public TirePosition FromPosition { get; set; }
    public TirePosition ToPosition { get; set; }
}
