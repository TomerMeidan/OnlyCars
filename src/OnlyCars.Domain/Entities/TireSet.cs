using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A user's set of tires (MVP5-D); it belongs to the user, not a car, and moves between cars through mounts.</summary>
public class TireSet : Entity
{
    public const int MaxBrandLength = 50;
    public const int MaxModelLength = 50;
    public const int MaxSizeLength = 30;
    public const int MaxDotCodeLength = 20;
    public const int MaxNotesLength = 1_000;
    public const int MaxPerUser = 50;
    public const int MaxMounts = 500;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public required string Brand { get; set; }
    public string? Model { get; set; }
    public string? Size { get; set; }
    public TireSeason Season { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    public string? DotCode { get; set; }

    /// <summary>The storage notes.</summary>
    public string? Notes { get; set; }

    public List<TireMount> Mounts { get; set; } = [];
}
