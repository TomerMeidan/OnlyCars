using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Odometer;

public class OdometerService(IAppDbContext db, VehicleService vehicleService)
{
    public async Task<List<OdometerReadingDto>> HistoryAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        var readings = await db.OdometerReadings
            .Where(r => r.VehicleId == vehicleId)
            .OrderByDescending(r => r.ReadingDate)
            .ThenByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        return readings.Select(ToDto).ToList();
    }

    /// <summary>
    /// Quick-entry odometer update. Rejects a value lower than the latest known reading
    /// unless the caller sets ConfirmCorrection, per the spec's data-integrity rule.
    /// </summary>
    public async Task<OdometerReadingDto> AddAsync(Guid userId, Guid vehicleId, AddOdometerReadingRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        if (request.ValueKm < vehicle.CurrentOdometerKm && !request.ConfirmCorrection)
        {
            throw new ValidationFailedException(
                $"New reading ({request.ValueKm} km) is lower than the current odometer ({vehicle.CurrentOdometerKm} km). " +
                "Resubmit with confirmCorrection=true if this is an intentional correction.");
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var reading = new OdometerReading
        {
            VehicleId = vehicle.Id,
            ValueKm = request.ValueKm,
            ReadingDate = request.ReadingDate ?? today,
            Source = OdometerSource.Manual
        };

        db.OdometerReadings.Add(reading);

        // A lower reading dated in the past is a backfill and must not regress the current odometer;
        // a lower reading for today (already confirmed above) is a correction of the current value.
        var isBackfill = reading.ReadingDate < today;
        if (request.ValueKm >= vehicle.CurrentOdometerKm || !isBackfill)
        {
            vehicle.CurrentOdometerKm = request.ValueKm;
        }

        vehicle.AvgKmPerDay = await ComputeAvgKmPerDayAsync(vehicle.Id, reading, ct);
        vehicle.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return ToDto(reading);
    }

    /// <summary>
    /// Simple average: (latest - earliest) / days between them, across all logged readings.
    /// Includes <paramref name="pending"/> even though it has not been persisted yet, since a
    /// query against the DbSet would not otherwise see it until after SaveChangesAsync.
    /// </summary>
    private async Task<decimal?> ComputeAvgKmPerDayAsync(Guid vehicleId, OdometerReading pending, CancellationToken ct)
    {
        var persisted = await db.OdometerReadings
            .Where(r => r.VehicleId == vehicleId)
            .Select(r => new { r.ReadingDate, r.ValueKm })
            .ToListAsync(ct);

        var readings = persisted
            .Append(new { pending.ReadingDate, pending.ValueKm })
            .OrderBy(r => r.ReadingDate)
            .ToList();

        if (readings.Count < 2)
        {
            return null;
        }

        var first = readings[0];
        var last = readings[^1];
        var days = last.ReadingDate.DayNumber - first.ReadingDate.DayNumber;

        if (days <= 0 || last.ValueKm <= first.ValueKm)
        {
            return null;
        }

        return Math.Round((last.ValueKm - first.ValueKm) / days, 2);
    }

    private static OdometerReadingDto ToDto(OdometerReading r) => new(r.Id, r.VehicleId, r.ValueKm, r.ReadingDate, r.Source);
}
