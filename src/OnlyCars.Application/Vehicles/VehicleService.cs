using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Vehicles;

public class VehicleService(IAppDbContext db)
{
    public async Task<List<VehicleDto>> ListAsync(Guid userId, bool includeArchived, CancellationToken ct = default)
    {
        var query = db.Vehicles.Where(v => v.UserId == userId);
        if (!includeArchived)
        {
            query = query.Where(v => !v.IsArchived);
        }

        var vehicles = await query.OrderBy(v => v.Nickname).ToListAsync(ct);
        return vehicles.Select(ToDto).ToList();
    }

    public async Task<VehicleDto> GetAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        var vehicle = await FindOwnedAsync(userId, vehicleId, ct);
        return ToDto(vehicle);
    }

    public async Task<VehicleDto> CreateAsync(Guid userId, CreateVehicleRequest request, CancellationToken ct = default)
    {
        if (!string.IsNullOrWhiteSpace(request.Vin))
        {
            var vinTaken = await db.Vehicles.AnyAsync(v => v.UserId == userId && v.Vin == request.Vin, ct);
            if (vinTaken)
            {
                throw new ConflictException("vehicle.vinTaken", "A vehicle with this VIN already exists on your account.");
            }
        }

        var vehicle = new Vehicle
        {
            UserId = userId,
            Nickname = request.Nickname,
            Make = request.Make,
            Model = request.Model,
            Year = request.Year,
            Vin = request.Vin,
            Plate = request.Plate,
            FuelType = request.FuelType,
            PurchaseDate = request.PurchaseDate,
            PurchasePrice = request.PurchasePrice,
            PhotoUrl = request.PhotoUrl,
            CurrentOdometerKm = request.InitialOdometerKm ?? 0
        };

        db.Vehicles.Add(vehicle);

        if (request.InitialOdometerKm is { } initial)
        {
            db.OdometerReadings.Add(new OdometerReading
            {
                VehicleId = vehicle.Id,
                Vehicle = vehicle,
                ValueKm = initial,
                ReadingDate = DateOnly.FromDateTime(DateTime.UtcNow),
                Source = OdometerSource.Manual
            });
        }

        await db.SaveChangesAsync(ct);
        return ToDto(vehicle);
    }

    public async Task<VehicleDto> UpdateAsync(Guid userId, Guid vehicleId, UpdateVehicleRequest request, CancellationToken ct = default)
    {
        var vehicle = await FindOwnedAsync(userId, vehicleId, ct);

        if (!string.IsNullOrWhiteSpace(request.Vin) && request.Vin != vehicle.Vin)
        {
            var vinTaken = await db.Vehicles.AnyAsync(v => v.UserId == userId && v.Vin == request.Vin && v.Id != vehicleId, ct);
            if (vinTaken)
            {
                throw new ConflictException("vehicle.vinTaken", "A vehicle with this VIN already exists on your account.");
            }
        }

        vehicle.Nickname = request.Nickname;
        vehicle.Make = request.Make;
        vehicle.Model = request.Model;
        vehicle.Year = request.Year;
        vehicle.Vin = request.Vin;
        vehicle.Plate = request.Plate;
        vehicle.FuelType = request.FuelType;
        vehicle.PurchaseDate = request.PurchaseDate;
        vehicle.PurchasePrice = request.PurchasePrice;
        vehicle.PhotoUrl = request.PhotoUrl;
        vehicle.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return ToDto(vehicle);
    }

    public async Task ArchiveAsync(Guid userId, Guid vehicleId, bool archived, CancellationToken ct = default)
    {
        var vehicle = await FindOwnedAsync(userId, vehicleId, ct);
        vehicle.IsArchived = archived;
        vehicle.ArchivedAt = archived ? DateTimeOffset.UtcNow : null;
        vehicle.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    internal async Task<Vehicle> FindOwnedAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        var vehicle = await db.Vehicles.FirstOrDefaultAsync(v => v.Id == vehicleId, ct);
        if (vehicle is null)
        {
            throw new NotFoundException(nameof(Vehicle), vehicleId);
        }

        if (vehicle.UserId != userId)
        {
            // Treat as not-found rather than forbidden so we don't leak existence of other users' vehicles.
            throw new NotFoundException(nameof(Vehicle), vehicleId);
        }

        return vehicle;
    }

    private static VehicleDto ToDto(Vehicle v) => new(
        v.Id, v.Nickname, v.Make, v.Model, v.Year, v.Vin, v.Plate, v.FuelType,
        v.PurchaseDate, v.PurchasePrice, v.PhotoUrl, v.CurrentOdometerKm, v.AvgKmPerDay, v.IsArchived);
}
