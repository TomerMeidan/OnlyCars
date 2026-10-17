using OnlyCars.Domain;

namespace OnlyCars.Application.Tires.Dtos;

// The set's open mount: the car it is on now.
public record TireSetOpenMountDto(Guid VehicleId, string VehicleNickname, DateOnly MountedAt, decimal MountOdometerKm);

// KmDriven is in km, computed on read: closed mounts plus the open one up to the car's current odometer (never negative).
public record TireSetDto(Guid Id, string Brand, string? Model, string? Size, TireSeason Season, DateOnly? PurchaseDate, string? DotCode,
    string? Notes, DateTimeOffset CreatedAt, decimal KmDriven, TireSetOpenMountDto? OpenMount, int MountCount);

// Season is required; a null one is tireSet.invalidSeason.
public record TireSetRequest(string? Brand, string? Model, string? Size, TireSeason? Season, DateOnly? PurchaseDate, string? DotCode, string? Notes);

// One mount with its set and car. UnmountedAt and UnmountOdometerKm are null while the set is on the car.
public record TireMountDto(Guid Id, Guid TireSetId, string Brand, string? Model, string? Size, TireSeason Season, Guid VehicleId,
    string VehicleNickname, DateOnly MountedAt, decimal MountOdometerKm, DateOnly? UnmountedAt, decimal? UnmountOdometerKm, decimal KmDriven)
{
    // MVP5-E: filled only on VehicleTiresDto.Current; null on past mounts and set mount lists.
    public TireCheckDto? LastCheck { get; init; }
    public LastTireRotationDto? LastRotation { get; init; }
}

// The car's open mount (null when no set is on) and its closed mounts, newest first.
public record VehicleTiresDto(TireMountDto? Current, List<TireMountDto> Past);

// A null MountedAt is today (UTC); OdometerKm is required.
public record MountTireSetRequest(Guid TireSetId, DateOnly? MountedAt, decimal? OdometerKm);

public record UnmountTireSetRequest(DateOnly? UnmountedAt, decimal? OdometerKm);

// MVP5-E. One wheel of a check; at least one of the two values is set.
public record TireCheckItemDto(TirePosition Position, decimal? PressureBar, decimal? TreadDepthMm);

// A check is every wheel logged on one date; items in the order FL, FR, RL, RR, Spare.
public record TireCheckDto(DateOnly MeasuredAt, List<TireCheckItemDto> Items);

// Position is required (a missing one is tireMeasurement.invalidPosition); a null MeasuredAt is today (UTC).
public record TireCheckItemRequest(TirePosition? Position, decimal? PressureBar, decimal? TreadDepthMm);

public record TireCheckRequest(DateOnly? MeasuredAt, List<TireCheckItemRequest>? Items);

public record TireRotationDto(Guid Id, DateOnly Date, decimal OdometerKm, string? Notes);

// KmSince is in km: max(0, the car's current odometer - the rotation's odometer).
public record LastTireRotationDto(DateOnly Date, decimal OdometerKm, decimal KmSince);

// A null Date is today (UTC); OdometerKm is required.
public record TireRotationRequest(DateOnly? Date, decimal? OdometerKm, string? Notes);
