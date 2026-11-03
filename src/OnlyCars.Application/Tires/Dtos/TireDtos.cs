using OnlyCars.Domain;

namespace OnlyCars.Application.Tires.Dtos;

// TIRE-2. Km in km, computed on read: KmOnTire = (RemovedOdometerKm ?? the car's current) - FittedOdometerKm, at least 0.
// DotDate is the Monday of the DOT week when DotCode ends in WWYY (WW 01 to 53), else null. RemovedAt/RemovedOdometerKm are null on the car.
public record TireDto(Guid Id, TirePosition Position, string Brand, string? Model, string? Size, TireSeason Season, string? DotCode,
    DateOnly? DotDate, DateOnly? PurchaseDate, DateOnly FittedAt, decimal FittedOdometerKm, DateOnly? RemovedAt, decimal? RemovedOdometerKm,
    decimal KmOnTire, string? Notes, Guid? ServiceRecordId, TireMeasurementDto? LatestMeasurement);

public record TireMeasurementDto(DateOnly MeasuredAt, TirePosition Position, decimal? PressureBar, decimal? TreadDepthMm);

// Current: the tires on the car in FL, FR, RL, RR, Spare order. Removed: newest removal first.
public record VehicleTiresDto(List<TireDto> Current, List<TireDto> Removed, DateOnly? LastCheckDate, LastTireRotationDto? LastRotation);

// One set of details for every position. Positions: one position, [FL, FR], [RL, RR] or the four. A null Date is today (UTC).
// Cost, ShopName and Notes go on the service record it creates; Notes also on each new tire.
public record ReplaceTiresRequest(List<TirePosition>? Positions, DateOnly? Date, decimal? OdometerKm, string? Brand, string? Model,
    string? Size, TireSeason? Season, string? DotCode, DateOnly? PurchaseDate, decimal? Cost, string? ShopName, string? Notes,
    bool ConfirmCorrection = false);

// PUT /api/tires/{id}: the detail fields only. Season is required (a null one is tire.invalidSeason).
public record UpdateTireRequest(string? Brand, string? Model, string? Size, TireSeason? Season, string? DotCode, DateOnly? PurchaseDate,
    string? Notes);

// One tire of a check; at least one of the two values is set.
public record TireCheckItemDto(Guid TireId, TirePosition Position, decimal? PressureBar, decimal? TreadDepthMm);

// A check is the car's measurements of one date; items in the order FL, FR, RL, RR, Spare.
public record TireCheckDto(DateOnly MeasuredAt, List<TireCheckItemDto> Items);

// Position is required (a missing one is tireMeasurement.invalidPosition); a null MeasuredAt is today (UTC).
public record TireCheckItemRequest(TirePosition? Position, decimal? PressureBar, decimal? TreadDepthMm);

public record TireCheckRequest(DateOnly? MeasuredAt, List<TireCheckItemRequest>? Items);

public record TireRotationMoveDto(Guid TireId, TirePosition FromPosition, TirePosition ToPosition);

// Moves is empty on rotations migrated from tire sets ("Wheels not recorded").
public record TireRotationDto(Guid Id, DateOnly Date, decimal OdometerKm, string? Notes, List<TireRotationMoveDto> Moves);

// KmSince is in km: max(0, the car's current odometer - the rotation's odometer).
public record LastTireRotationDto(Guid Id, DateOnly Date, decimal OdometerKm, decimal KmSince);

public record TireRotationMoveRequest(TirePosition? FromPosition, TirePosition? ToPosition);

// A null Date is today (UTC); OdometerKm is required.
public record TireRotationRequest(DateOnly? Date, decimal? OdometerKm, string? Notes, List<TireRotationMoveRequest>? Moves);
