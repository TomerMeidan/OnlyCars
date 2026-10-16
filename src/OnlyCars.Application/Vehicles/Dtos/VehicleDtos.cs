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
    string? PhotoUrl,
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
    string? PhotoUrl,
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
    string? PhotoUrl);
