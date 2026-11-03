using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One tire of a car (TIRE-2): on the car at Position while RemovedAt is null; a removed tire keeps the wheel it came off.</summary>
public class Tire : Entity
{
    public const int MaxBrandLength = 50;
    public const int MaxModelLength = 50;
    public const int MaxSizeLength = 30;
    public const int MaxDotCodeLength = 20;
    public const int MaxNotesLength = 1_000;
    public const int MaxPerVehicle = 100;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public TirePosition Position { get; set; }
    public required string Brand { get; set; }
    public string? Model { get; set; }
    public string? Size { get; set; }
    public TireSeason Season { get; set; }
    public string? DotCode { get; set; }
    public DateOnly? PurchaseDate { get; set; }

    public DateOnly FittedAt { get; set; }
    public decimal FittedOdometerKm { get; set; }
    public DateOnly? RemovedAt { get; set; }
    public decimal? RemovedOdometerKm { get; set; }

    public string? Notes { get; set; }

    /// <summary>The service record of its purchase (a Replace); null for tires entered as already on the car.</summary>
    public Guid? ServiceRecordId { get; set; }
    public ServiceRecord? ServiceRecord { get; set; }

    public List<TireMeasurement> Measurements { get; set; } = [];
}
