using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class Vehicle : Entity
{
    public const int MaxPerUser = 50;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public required string Nickname { get; set; }
    public string? Make { get; set; }
    public string? Model { get; set; }
    public int? Year { get; set; }
    public string? Vin { get; set; }
    public string? Plate { get; set; }
    public FuelType? FuelType { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    public decimal? PurchasePrice { get; set; }
    public string? PhotoUrl { get; set; }

    /// <summary>Denormalized for fast reads; kept in sync whenever a new OdometerReading is the latest one.</summary>
    public decimal CurrentOdometerKm { get; set; }

    /// <summary>Nullable, computed from odometer history; used to predict when time-less, km-based tasks come due.</summary>
    public decimal? AvgKmPerDay { get; set; }

    public bool IsArchived { get; set; }
    public DateTimeOffset? ArchivedAt { get; set; }

    public ICollection<OdometerReading> OdometerReadings { get; set; } = new List<OdometerReading>();
    public ICollection<MaintenanceTask> MaintenanceTasks { get; set; } = new List<MaintenanceTask>();
}
