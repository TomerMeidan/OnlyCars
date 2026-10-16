using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Odometer;

/// <summary>
/// Readings are ordered by (ReadingDate, CreatedAt). Every write checks that a reading fits between its
/// neighbours in that order (unless the user confirms a correction), then recomputes the vehicle's
/// current odometer (the last reading) and average km/day.
/// </summary>
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

    public async Task<OdometerReadingDto> AddAsync(Guid userId, Guid vehicleId, AddOdometerReadingRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var readings = await LoadReadingsAsync(vehicle.Id, ct);

        var reading = new OdometerReading
        {
            VehicleId = vehicle.Id,
            ValueKm = request.ValueKm,
            ReadingDate = request.ReadingDate ?? DateOnly.FromDateTime(DateTime.UtcNow),
            Source = OdometerSource.Manual
        };
        Validate(readings, reading, reading.ValueKm, reading.ReadingDate, request.ConfirmCorrection);

        db.OdometerReadings.Add(reading);
        readings.Add(reading);
        Recompute(vehicle, readings);

        await db.SaveChangesAsync(ct);
        return ToDto(reading);
    }

    public async Task<OdometerReadingDto> UpdateAsync(Guid userId, Guid vehicleId, Guid readingId, UpdateOdometerReadingRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var readings = await LoadReadingsAsync(vehicle.Id, ct);
        var reading = FindManual(readings, readingId);

        var date = request.ReadingDate ?? reading.ReadingDate;
        Validate(readings, reading, request.ValueKm, date, request.ConfirmCorrection);

        reading.ValueKm = request.ValueKm;
        reading.ReadingDate = date;
        reading.UpdatedAt = DateTimeOffset.UtcNow;
        Recompute(vehicle, readings);

        await db.SaveChangesAsync(ct);
        return ToDto(reading);
    }

    public async Task DeleteAsync(Guid userId, Guid vehicleId, Guid readingId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var readings = await LoadReadingsAsync(vehicle.Id, ct);
        var reading = FindManual(readings, readingId);

        // Deleting the only reading would reset the odometer to 0; the user can edit it instead.
        if (readings.Count == 1)
        {
            throw new ConflictException("odometer.onlyReading", "The only reading on a car can't be deleted. Edit it instead.");
        }

        db.OdometerReadings.Remove(reading);
        readings.Remove(reading);
        Recompute(vehicle, readings);

        await db.SaveChangesAsync(ct);
    }

    private Task<List<OdometerReading>> LoadReadingsAsync(Guid vehicleId, CancellationToken ct) =>
        db.OdometerReadings.Where(r => r.VehicleId == vehicleId).ToListAsync(ct);

    // Looked up within the owned vehicle's readings, so another car's reading id is simply not found.
    private static OdometerReading FindManual(List<OdometerReading> readings, Guid readingId)
    {
        var reading = readings.FirstOrDefault(r => r.Id == readingId)
            ?? throw new NotFoundException(nameof(OdometerReading), readingId);

        if (reading.Source != OdometerSource.Manual)
        {
            throw new ConflictException("odometer.notManual", "This reading belongs to another record and can't be changed here.");
        }

        return reading;
    }

    /// <summary>
    /// Checks a value and date for <paramref name="reading"/> before anything changes, so a failed check saves nothing.
    /// Neighbours are found by the new date, excluding the reading itself.
    /// </summary>
    internal static void Validate(List<OdometerReading> readings, OdometerReading reading, decimal valueKm, DateOnly date, bool confirmCorrection)
    {
        if (valueKm < 0)
        {
            throw new ValidationFailedException("odometer.invalidValue", "The reading can't be negative.");
        }

        // No real car gets near this; it also keeps the value inside the decimal(12,2) column.
        if (valueKm > OdometerReading.MaxValueKm)
        {
            throw new ValidationFailedException("odometer.invalidValue", $"The reading can't be above {OdometerReading.MaxValueKm} km.");
        }

        ValidateDate(date);

        if (confirmCorrection)
        {
            return;
        }

        var key = (date, reading.CreatedAt);
        var others = readings.Where(r => r != reading).ToList();
        var previous = others.Where(r => (r.ReadingDate, r.CreatedAt).CompareTo(key) < 0).MaxBy(r => (r.ReadingDate, r.CreatedAt));
        var next = others.Where(r => (r.ReadingDate, r.CreatedAt).CompareTo(key) > 0).MinBy(r => (r.ReadingDate, r.CreatedAt));

        if (previous is not null && valueKm < previous.ValueKm)
        {
            throw new ValidationFailedException("odometer.lowerThanPrevious",
                $"New reading ({valueKm} km) is lower than the reading before it ({previous.ValueKm} km). " +
                "Resubmit with confirmCorrection=true if this is an intentional correction.")
            {
                Extensions = { ["previousKm"] = previous.ValueKm }
            };
        }

        if (next is not null && valueKm > next.ValueKm)
        {
            throw new ValidationFailedException("odometer.higherThanNext",
                $"New reading ({valueKm} km) is higher than the reading after it ({next.ValueKm} km). " +
                "Resubmit with confirmCorrection=true if this is an intentional correction.")
            {
                Extensions = { ["nextKm"] = next.ValueKm }
            };
        }
    }

    /// <summary>A reading date the client sends: from 1900-01-01 to the client's today.</summary>
    internal static void ValidateDate(DateOnly date)
    {
        DateRules.RejectTooEarly(date);

        // One day of slack: just after midnight in Israel, the user's today is still tomorrow in UTC.
        if (date > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1))
        {
            throw new ValidationFailedException("odometer.futureDate", "The reading date can't be in the future.");
        }
    }

    /// <summary>
    /// Removes a reading a record or run created. Same rule as deleting a manual reading: the car's only reading stays, turned
    /// into a manual one, so the odometer isn't reset to 0. The caller recomputes.
    /// </summary>
    internal static void RemoveLinked(IAppDbContext db, List<OdometerReading> readings, OdometerReading reading, DateTimeOffset now)
    {
        if (readings.Count == 1)
        {
            reading.Source = OdometerSource.Manual;
            reading.ServiceRecordId = null;
            reading.UpdatedAt = now;
            return;
        }

        db.OdometerReadings.Remove(reading);
        readings.Remove(reading);
    }

    /// <summary>
    /// Current odometer = the last reading. Average = (last - first) / days between them; null with fewer than
    /// 2 readings, 0 days between them, or no increase.
    /// </summary>
    internal static void Recompute(Vehicle vehicle, List<OdometerReading> readings)
    {
        var ordered = readings.OrderBy(r => r.ReadingDate).ThenBy(r => r.CreatedAt).ToList();
        vehicle.UpdatedAt = DateTimeOffset.UtcNow;
        vehicle.AvgKmPerDay = null;

        if (ordered.Count == 0)
        {
            return;
        }

        var first = ordered[0];
        var last = ordered[^1];
        vehicle.CurrentOdometerKm = last.ValueKm;

        var days = last.ReadingDate.DayNumber - first.ReadingDate.DayNumber;
        if (days > 0 && last.ValueKm > first.ValueKm)
        {
            vehicle.AvgKmPerDay = Math.Round((last.ValueKm - first.ValueKm) / days, 2);
        }
    }

    private static OdometerReadingDto ToDto(OdometerReading r) => new(r.Id, r.VehicleId, r.ValueKm, r.ReadingDate, r.Source);
}
