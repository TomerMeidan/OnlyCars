using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Vehicles;

// storage is null when the R2 settings are missing (a fresh clone): photo endpoints answer 503 and photoUrl is null.
public class VehicleService(IAppDbContext db, IFileStorage? storage = null, ILogger<VehicleService>? logger = null)
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

    public const int MaxPhotoBytes = 10 * 1024 * 1024;

    public static PayloadTooLargeException PhotoTooLarge() =>
        new("file.tooLarge", "The photo must be 10 MB or smaller.") { Extensions = { ["maxBytes"] = MaxPhotoBytes } };

    /// <summary>Uploads a cleaned copy of the image, then points the car at it and deletes the previous photo.</summary>
    public async Task<VehicleDto> SetPhotoAsync(Guid userId, Guid vehicleId, byte[]? content, CancellationToken ct = default)
    {
        var files = Storage();
        var vehicle = await FindOwnedAsync(userId, vehicleId, ct);
        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("vehiclePhoto.vehicleArchived", "This car is archived.");
        }

        if (content is not { Length: > 0 })
        {
            throw new ValidationFailedException("file.required", "Choose a photo to upload.");
        }

        if (content.Length > MaxPhotoBytes)
        {
            throw PhotoTooLarge();
        }

        var image = ImageFiles.Clean(content);
        var key = $"users/{userId}/vehicles/{vehicleId}/photo/{Guid.NewGuid():N}.{image.Extension}";
        await files.PutAsync(key, image.Content, image.ContentType, ct);

        var previous = PhotoKey(vehicle);
        vehicle.PhotoUrl = key;
        vehicle.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            await DeleteQuietlyAsync(key);
            throw;
        }

        await DeleteQuietlyAsync(previous);
        return ToDto(vehicle);
    }

    /// <summary>Allowed on an archived car. No photo is a no-op.</summary>
    public async Task DeletePhotoAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        Storage();
        var vehicle = await FindOwnedAsync(userId, vehicleId, ct);
        if (PhotoKey(vehicle) is not { } key)
        {
            return;
        }

        vehicle.PhotoUrl = null;
        vehicle.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        await DeleteQuietlyAsync(key);
    }

    private IFileStorage Storage() =>
        storage ?? throw new ServiceUnavailableException("file.storageUnavailable", "File storage is not configured.");

    // shortcut: a failed delete leaves an orphaned object (logged); add the orphan sweep (decisions.md "not now") if they pile up.
    private async Task DeleteQuietlyAsync(string? key)
    {
        if (key is null)
        {
            return;
        }

        try
        {
            await Storage().DeleteAsync(key, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "Could not delete stored file {Key}", key);
        }
    }

    // PhotoUrl holds the storage key (decisions.md "Car photo, FILE-1"); clients only ever get a signed URL.
    private string? SignedPhotoUrl(Vehicle v) =>
        PhotoKey(v) is { } key && storage is not null ? storage.GetSignedUrl(key, TimeSpan.FromHours(1)) : null;

    /// <summary>The stored key, or null unless it is a key SetPhotoAsync writes for this car, so a bad row never signs or deletes another object.</summary>
    private static string? PhotoKey(Vehicle v)
    {
        var prefix = $"users/{v.UserId}/vehicles/{v.Id}/photo/";
        return v.PhotoUrl is { } key && key.StartsWith(prefix, StringComparison.Ordinal)
                                     && Regex.IsMatch(key.AsSpan(prefix.Length), @"^[0-9a-f]{32}\.(jpg|png|webp)$")
            ? key
            : null;
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

    private VehicleDto ToDto(Vehicle v) => new(
        v.Id, v.Nickname, v.Make, v.Model, v.Year, v.Vin, v.Plate, v.FuelType,
        v.PurchaseDate, v.PurchasePrice, SignedPhotoUrl(v), v.CurrentOdometerKm, v.AvgKmPerDay, v.IsArchived);
}
