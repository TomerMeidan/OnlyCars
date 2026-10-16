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
    string VehicleNickname, DateOnly MountedAt, decimal MountOdometerKm, DateOnly? UnmountedAt, decimal? UnmountOdometerKm, decimal KmDriven);

// The car's open mount (null when no set is on) and its closed mounts, newest first.
public record VehicleTiresDto(TireMountDto? Current, List<TireMountDto> Past);

// A null MountedAt is today (UTC); OdometerKm is required.
public record MountTireSetRequest(Guid TireSetId, DateOnly? MountedAt, decimal? OdometerKm);

public record UnmountTireSetRequest(DateOnly? UnmountedAt, decimal? OdometerKm);
