using OnlyCars.Domain;

namespace OnlyCars.Application.Vehicles.Dtos;

public record VehicleDto(
    Guid Id,
    string Nickname,
    string? Make,
    string? Model,
    int? Year,
    string? Vin,
    string? Plate,
    FuelType? FuelType,
    DateOnly? PurchaseDate,
    decimal? PurchasePrice,
    string? PhotoUrl, // a signed GET URL or null; the key isn't a field of its own, but the URL's path contains it, and a leaked URL works for up to 1 hour
    decimal CurrentOdometerKm,
    decimal? AvgKmPerDay,
    bool IsArchived);

public record CreateVehicleRequest(
    string Nickname,
    string? Make,
    string? Model,
    int? Year,
    string? Vin,
    string? Plate,
    FuelType? FuelType,
    DateOnly? PurchaseDate,
    decimal? PurchasePrice,
    string? PhotoUrl, // ignored: the photo is set only through PUT /api/vehicles/{id}/photo (FILE-1)
    decimal? InitialOdometerKm,
    DateOnly? ReadingDate = null); // the first reading's date: the client's local today, like quick-add

public record UpdateVehicleRequest(
    string Nickname,
    string? Make,
    string? Model,
    int? Year,
    string? Vin,
    string? Plate,
    FuelType? FuelType,
    DateOnly? PurchaseDate,
    decimal? PurchasePrice,
    string? PhotoUrl); // ignored: the photo is set only through PUT /api/vehicles/{id}/photo (FILE-1)
