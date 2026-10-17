using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer;
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
        if (request.InitialOdometerKm is < 0 or > OdometerReading.MaxValueKm)
        {
            throw new ValidationFailedException("odometer.invalidValue", $"The starting odometer must be between 0 and {OdometerReading.MaxValueKm} km.");
        }

        var readingDate = request.ReadingDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
        if (request.InitialOdometerKm is not null)
        {
            OdometerService.ValidateDate(readingDate);
        }

        if (!string.IsNullOrWhiteSpace(request.Vin))
        {
            var vinTaken = await db.Vehicles.AnyAsync(v => v.UserId == userId && v.Vin == request.Vin, ct);
            if (vinTaken)
            {
                throw VinTaken();
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
                ReadingDate = readingDate,
                Source = OdometerSource.Manual
            });
        }

        await SaveVinAsync(vehicle, ct);
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
                throw VinTaken();
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

        await SaveVinAsync(vehicle, ct);
        return ToDto(vehicle);
    }

    private static ConflictException VinTaken() => new("vehicle.vinTaken", "A vehicle with this VIN already exists on your account.");

    private async Task SaveVinAsync(Vehicle vehicle, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (vehicle.Vin is not null)
        {
            // A simultaneous save of the same VIN won the unique Vehicle(UserId, Vin) index (L66).
            if (await db.Vehicles.AnyAsync(v => v.UserId == vehicle.UserId && v.Vin == vehicle.Vin && v.Id != vehicle.Id, ct))
            {
                throw VinTaken();
            }

            throw;
        }
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
