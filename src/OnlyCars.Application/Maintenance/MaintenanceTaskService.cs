using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Maintenance;

public class MaintenanceTaskService(IAppDbContext db, VehicleService vehicleService)
{
    public async Task<List<TaskTemplateDto>> TemplatesAsync(CancellationToken ct = default)
    {
        var templates = await db.TaskTemplates.OrderBy(t => t.Category).ThenBy(t => t.Key).ToListAsync(ct);
        return templates.Select(t => new TaskTemplateDto(t.Id, t.Key, t.Name, t.Category, t.DefaultIntervalKm, t.DefaultIntervalDays)).ToList();
    }

    public async Task<List<MaintenanceTaskDto>> ListAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        // The client sorts by urgency, then by name with a culture-aware compare in the UI language.
        var tasks = await db.MaintenanceTasks
            .Where(t => t.VehicleId == vehicleId)
            .OrderByDescending(t => t.IsEnabled)
            .ThenBy(t => t.Name)
            .ToListAsync(ct);

        var today = TodayUtc();
        return tasks.Select(t => ToDto(t, vehicle, today)).ToList();
    }

    public async Task<MaintenanceTaskDto> CreateAsync(Guid userId, Guid vehicleId, CreateMaintenanceTaskRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var (name, category) = Validate(vehicle, request.Name, request.Category, request.IntervalKm, request.IntervalDays,
            request.DueSoonPercent, request.LastDoneOdometerKm, request.LastDoneDate);

        if (request.TemplateId is { } templateId && !await db.TaskTemplates.AnyAsync(t => t.Id == templateId, ct))
        {
            throw new ValidationFailedException("task.invalidTemplate", "The template doesn't exist.");
        }

        var task = new MaintenanceTask
        {
            VehicleId = vehicle.Id,
            TemplateId = request.TemplateId,
            Name = name,
            Category = category,
            IntervalKm = request.IntervalKm,
            IntervalDays = request.IntervalDays,
            DueSoonPercent = request.DueSoonPercent ?? MaintenanceTask.DefaultDueSoonPercent,
            LastDoneOdometerKm = request.LastDoneOdometerKm!.Value,
            LastDoneDate = request.LastDoneDate!.Value
        };
        db.MaintenanceTasks.Add(task);

        await db.SaveChangesAsync(ct);
        return ToDto(task, vehicle, TodayUtc());
    }

    public async Task<MaintenanceTaskDto> UpdateAsync(Guid userId, Guid vehicleId, Guid taskId, UpdateMaintenanceTaskRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var task = await FindAsync(vehicle.Id, taskId, ct);
        var (name, category) = Validate(vehicle, request.Name, request.Category, request.IntervalKm, request.IntervalDays,
            request.DueSoonPercent, request.LastDoneOdometerKm, request.LastDoneDate, task);

        task.Name = name;
        task.Category = category;
        task.IntervalKm = request.IntervalKm;
        task.IntervalDays = request.IntervalDays;
        task.LastDoneOdometerKm = request.LastDoneOdometerKm!.Value;
        task.LastDoneDate = request.LastDoneDate!.Value;
        task.IsEnabled = request.IsEnabled ?? task.IsEnabled;
        task.DueSoonPercent = request.DueSoonPercent ?? task.DueSoonPercent;
        task.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return ToDto(task, vehicle, TodayUtc());
    }

    public async Task DeleteAsync(Guid userId, Guid vehicleId, Guid taskId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var task = await FindAsync(vehicle.Id, taskId, ct);
        // The join FK doesn't cascade (one cascade path only on SQL Server); the records and their readings stay as history.
        db.ServiceRecordTasks.RemoveRange(await db.ServiceRecordTasks.Where(j => j.MaintenanceTaskId == task.Id).ToListAsync(ct));
        db.MaintenanceTasks.Remove(task);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Mark as done at the car's current odometer: one record, one join row holding the task's old LastDone* (for undo),
    /// the task's LastDone* moved forward, and a Service reading linked to the record. One SaveChanges.
    /// </summary>
    public async Task<ResetTaskResponse> ResetAsync(Guid userId, Guid vehicleId, Guid taskId, ResetTaskRequest? request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var task = await FindAsync(vehicle.Id, taskId, ct);

        // The client sends its local date; one day of slack either way covers every time zone.
        var today = TodayUtc();
        var date = request?.Date ?? today;
        if (Math.Abs(date.DayNumber - today.DayNumber) > 1)
        {
            throw new ValidationFailedException("serviceRecord.invalidDate", "The date must be today.");
        }

        var cost = request?.Cost;
        if (cost is { } c && (c < 0 || c > ServiceRecord.MaxCost || decimal.Round(c, 2) != c))
        {
            throw new ValidationFailedException("serviceRecord.invalidCost",
                $"The cost must be 0 to {ServiceRecord.MaxCost} with at most 2 decimals.");
        }

        var notes = request?.Notes?.Trim();
        if (notes?.Length > ServiceRecord.MaxNotesLength)
        {
            throw new ValidationFailedException("serviceRecord.notesTooLong", $"Notes can be up to {ServiceRecord.MaxNotesLength} characters.");
        }

        var record = new ServiceRecord
        {
            VehicleId = vehicle.Id,
            Date = date,
            OdometerKm = vehicle.CurrentOdometerKm,
            TotalCost = cost,
            Notes = string.IsNullOrEmpty(notes) ? null : notes,
            Tasks =
            {
                new ServiceRecordTask
                {
                    MaintenanceTaskId = task.Id,
                    PreviousLastDoneOdometerKm = task.LastDoneOdometerKm,
                    PreviousLastDoneDate = task.LastDoneDate
                }
            }
        };
        db.ServiceRecords.Add(record);

        task.LastDoneOdometerKm = vehicle.CurrentOdometerKm;
        task.LastDoneDate = date;
        task.UpdatedAt = DateTimeOffset.UtcNow;

        // Its value is the current odometer, so it skips the date-order checks (decisions.md).
        var readings = await db.OdometerReadings.Where(r => r.VehicleId == vehicle.Id).ToListAsync(ct);
        var reading = new OdometerReading
        {
            VehicleId = vehicle.Id,
            ValueKm = vehicle.CurrentOdometerKm,
            ReadingDate = date,
            Source = OdometerSource.Service,
            ServiceRecord = record
        };
        db.OdometerReadings.Add(reading);
        readings.Add(reading);
        OdometerService.Recompute(vehicle, readings);

        await db.SaveChangesAsync(ct);
        return new(record.Id, ToDto(task, vehicle, today));
    }

    /// <summary>
    /// Undo: voids the record, restores each linked task's LastDone* from its snapshot, and removes the reading the reset
    /// logged (kept as a manual reading if it's the car's only one). Only each task's latest non-voided record can be voided,
    /// so the snapshot is always the value to go back to. One SaveChanges.
    /// </summary>
    public async Task<List<MaintenanceTaskDto>> VoidAsync(Guid userId, Guid vehicleId, Guid recordId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var record = await db.ServiceRecords.Include(r => r.Tasks)
            .FirstOrDefaultAsync(r => r.Id == recordId && r.VehicleId == vehicle.Id, ct)
            ?? throw new NotFoundException(nameof(ServiceRecord), recordId);

        if (record.IsVoided)
        {
            throw new ConflictException("serviceRecord.alreadyVoided", "This service record is already undone.");
        }

        var taskIds = record.Tasks.Select(j => j.MaintenanceTaskId).ToList();
        var hasLater = await db.ServiceRecordTasks.AnyAsync(j => taskIds.Contains(j.MaintenanceTaskId)
            && j.ServiceRecordId != record.Id
            && !j.ServiceRecord!.IsVoided
            && (j.ServiceRecord.Date > record.Date || j.ServiceRecord.Date == record.Date && j.ServiceRecord.CreatedAt > record.CreatedAt), ct);
        if (hasLater)
        {
            throw new ConflictException("serviceRecord.notLatest", "A later reset of this task must be undone first.");
        }

        var now = DateTimeOffset.UtcNow;
        record.IsVoided = true;
        record.UpdatedAt = now;

        var tasks = await db.MaintenanceTasks.Where(t => taskIds.Contains(t.Id)).OrderBy(t => t.Name).ToListAsync(ct);
        foreach (var task in tasks)
        {
            var snapshot = record.Tasks.Single(j => j.MaintenanceTaskId == task.Id);
            task.LastDoneOdometerKm = snapshot.PreviousLastDoneOdometerKm;
            task.LastDoneDate = snapshot.PreviousLastDoneDate;
            task.UpdatedAt = now;
        }

        var readings = await db.OdometerReadings.Where(r => r.VehicleId == vehicle.Id).ToListAsync(ct);
        foreach (var reading in readings.Where(r => r.ServiceRecordId == record.Id).ToList())
        {
            // Same rule as deleting a manual reading: the only reading stays, so the odometer isn't reset to 0.
            if (readings.Count == 1)
            {
                reading.Source = OdometerSource.Manual;
                reading.ServiceRecordId = null;
                reading.UpdatedAt = now;
                continue;
            }

            db.OdometerReadings.Remove(reading);
            readings.Remove(reading);
        }
        OdometerService.Recompute(vehicle, readings);

        await db.SaveChangesAsync(ct);
        var today = TodayUtc();
        return tasks.Select(t => ToDto(t, vehicle, today)).ToList();
    }

    // Scoped to the owned vehicle, so another car's task id is simply not found.
    private async Task<MaintenanceTask> FindAsync(Guid vehicleId, Guid taskId, CancellationToken ct) =>
        await db.MaintenanceTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.VehicleId == vehicleId, ct)
        ?? throw new NotFoundException(nameof(MaintenanceTask), taskId);

    /// <summary>
    /// Checks every field before anything changes, so a failed check saves nothing. Returns the trimmed name and parsed category.
    /// On update (<paramref name="stored"/> set), the last-done range checks only run on values that changed (decisions.md),
    /// so a task stays editable after the car's odometer is corrected below its last-done km.
    /// </summary>
    private static (string Name, TaskCategory Category) Validate(Vehicle vehicle, string? name, string? category,
        int? intervalKm, int? intervalDays, int? dueSoonPercent, decimal? lastDoneKm, DateOnly? lastDoneDate, MaintenanceTask? stored = null)
    {
        var trimmed = name?.Trim() ?? "";
        if (trimmed.Length is 0 or > MaintenanceTask.MaxNameLength)
        {
            throw new ValidationFailedException("task.nameRequired", $"The name must be 1 to {MaintenanceTask.MaxNameLength} characters.");
        }

        // Exact enum names only: Enum.TryParse would also accept numbers like "3".
        if (category is null || !Enum.GetNames<TaskCategory>().Contains(category))
        {
            throw new ValidationFailedException("task.invalidCategory", "The category is not valid.");
        }

        if (intervalKm is null && intervalDays is null)
        {
            throw new ValidationFailedException("task.intervalRequired", "Set a km interval, a time interval, or both.");
        }

        if (intervalKm is < 1 or > MaintenanceTask.MaxIntervalKm || intervalDays is < 1 or > MaintenanceTask.MaxIntervalDays)
        {
            throw new ValidationFailedException("task.invalidInterval",
                $"The km interval must be 1 to {MaintenanceTask.MaxIntervalKm} and the time interval 1 to {MaintenanceTask.MaxIntervalDays} days.");
        }

        if (dueSoonPercent is < 1 or > MaintenanceTask.MaxDueSoonPercent)
        {
            throw new ValidationFailedException("task.invalidDueSoonPercent",
                $"Due soon must start at 1 to {MaintenanceTask.MaxDueSoonPercent} percent of the interval.");
        }

        var kmChanged = lastDoneKm != stored?.LastDoneOdometerKm;
        if (lastDoneKm is null || lastDoneDate is null || kmChanged && (lastDoneKm < 0 || lastDoneKm > vehicle.CurrentOdometerKm))
        {
            throw new ValidationFailedException("task.invalidLastDone",
                $"Last done needs a date and a km value from 0 to the car's current odometer ({vehicle.CurrentOdometerKm} km).")
            {
                Extensions = { ["currentKm"] = vehicle.CurrentOdometerKm }
            };
        }

        // Same one day of slack as odometer readings (Israel is ahead of UTC).
        if (lastDoneDate != stored?.LastDoneDate && lastDoneDate > TodayUtc().AddDays(1))
        {
            throw new ValidationFailedException("task.futureDate", "The last done date can't be in the future.");
        }

        return (trimmed, Enum.Parse<TaskCategory>(category));
    }

    private static DateOnly TodayUtc() => DateOnly.FromDateTime(DateTime.UtcNow);

    private static MaintenanceTaskDto ToDto(MaintenanceTask t, Vehicle vehicle, DateOnly today)
    {
        var s = TaskStatusCalculator.Compute(t, vehicle.CurrentOdometerKm, today);
        return new(t.Id, t.VehicleId, t.TemplateId, t.Name, t.Category, t.IntervalKm, t.IntervalDays, t.DueSoonPercent,
            t.IsEnabled, t.LastDoneOdometerKm, t.LastDoneDate, s.Status, s.RemainingKm, s.RemainingDays, s.Progress);
    }
}
