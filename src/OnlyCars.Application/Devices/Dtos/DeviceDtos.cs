namespace OnlyCars.Application.Devices.Dtos;

public record DeviceTokenDto(Guid Id, string Name, DateTimeOffset CreatedAt, DateTimeOffset? LastUsedAt);

public record CreateDeviceTokenRequest(string? Name);

/// <summary>The only response that carries the token itself.</summary>
public record CreatedDeviceTokenDto(Guid Id, string Name, DateTimeOffset CreatedAt, string Token);

/// <summary>What a device may see of a car: enough to pick it and to prefill its odometer.</summary>
public record DeviceVehicleDto(Guid Id, string Nickname, string? Make, string? Model, int? Year, string? Plate, decimal CurrentOdometerKm);
