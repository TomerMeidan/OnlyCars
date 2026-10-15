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
        ValidateCost(cost);
        var notes = TrimNotes(request?.Notes);

        var record = new ServiceRecord
        {
            VehicleId = vehicle.Id,
            Date = date,
            OdometerKm = vehicle.CurrentOdometerKm,
            TotalCost = cost,
            Notes = notes,
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
        LogServiceReading(vehicle, readings, ServiceReading(record));

        await db.SaveChangesAsync(ct);
        return new(record.Id, ToDto(task, vehicle, today));
    }

    /// <summary>The car's non-voided service records, newest first (by date, then creation time).</summary>
    public async Task<List<ServiceRecordDto>> ListRecordsAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        var records = await db.ServiceRecords
            .Include(r => r.Tasks).ThenInclude(j => j.MaintenanceTask)
            .Where(r => r.VehicleId == vehicleId && !r.IsVoided)
            .OrderByDescending(r => r.Date)
            .ThenByDescending(r => r.CreatedAt)
            .ToListAsync(ct);

        return records.Select(ToDto).ToList();
    }

    /// <summary>
    /// Records a past (or today's) service: the record, one join row per task with its old LastDone* snapshot, LastDone*
    /// moved only when the record is at least as recent (decisions.md), and a Service reading under the manual date-order
    /// rules. Every check runs before anything changes; one SaveChanges.
    /// </summary>
    public async Task<CreateServiceRecordResponse> CreateRecordAsync(Guid userId, Guid vehicleId, CreateServiceRecordRequest request,
        CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        // Same one day of slack as readings and resets: the client sends its local date.
        var today = TodayUtc();
        var date = request.Date ?? today;
        if (date > today.AddDays(1))
        {
            throw new ValidationFailedException("serviceRecord.futureDate", "The service date can't be in the future.");
        }

        if (request.OdometerKm is not { } odometerKm)
        {
            throw new ValidationFailedException("odometer.invalidValue", "The odometer reading is required.");
        }

        ValidateCost(request.TotalCost);

        var shop = request.ShopName?.Trim();
        if (shop?.Length > ServiceRecord.MaxShopNameLength)
        {
            throw new ValidationFailedException("serviceRecord.shopTooLong", $"The shop name can be up to {ServiceRecord.MaxShopNameLength} characters.");
        }

        var notes = TrimNotes(request.Notes);

        // Matched in memory against this car's tasks, so another car's (or user's) task id is not found.
        var carTasks = await db.MaintenanceTasks.Where(t => t.VehicleId == vehicle.Id).ToListAsync(ct);
        var linked = (request.TaskIds ?? []).Distinct()
            .Select(id => carTasks.FirstOrDefault(t => t.Id == id) ?? throw new NotFoundException(nameof(MaintenanceTask), id))
            .OrderBy(t => t.Name)
            .ToList();

        var record = new ServiceRecord
        {
            VehicleId = vehicle.Id,
            Date = date,
            OdometerKm = odometerKm,
            ShopName = string.IsNullOrEmpty(shop) ? null : shop,
            TotalCost = request.TotalCost,
            Notes = notes
        };

        var readings = await db.OdometerReadings.Where(r => r.VehicleId == vehicle.Id).ToListAsync(ct);
        var reading = ServiceReading(record);
        OdometerService.Validate(readings, reading, odometerKm, date, request.ConfirmCorrection);

        var now = DateTimeOffset.UtcNow;
        foreach (var task in linked)
        {
            record.Tasks.Add(new ServiceRecordTask
            {
                MaintenanceTask = task,
                PreviousLastDoneOdometerKm = task.LastDoneOdometerKm,
                PreviousLastDoneDate = task.LastDoneDate
            });

            // An older service never makes a task look less recently done.
            if ((date, odometerKm).CompareTo((task.LastDoneDate, task.LastDoneOdometerKm)) >= 0)
            {
                task.LastDoneOdometerKm = odometerKm;
                task.LastDoneDate = date;
                task.UpdatedAt = now;
            }
        }

        db.ServiceRecords.Add(record);
        LogServiceReading(vehicle, readings, reading);

        await db.SaveChangesAsync(ct);
        return new(ToDto(record), linked.Select(t => ToDto(t, vehicle, today)).ToList());
    }

    /// <summary>
    /// Undo, in any order: voids the record, and each linked task whose LastDone* still equals this record's date and odometer
    /// goes to the latest remaining non-voided linked record (by date, odometer, creation time), or with none left to the
    /// snapshot of its earliest-created linked record. Other tasks (a later record or a manual edit) are left alone. The
    /// record's reading is removed (kept as a manual reading if it's the car's only one). One SaveChanges.
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

        var now = DateTimeOffset.UtcNow;
        record.IsVoided = true;
        record.UpdatedAt = now;

        var taskIds = record.Tasks.Select(j => j.MaintenanceTaskId).ToList();
        var tasks = await db.MaintenanceTasks.Where(t => taskIds.Contains(t.Id)).OrderBy(t => t.Name).ToListAsync(ct);
        // Every link of these tasks, voided ones included (the earliest snapshot may sit on a voided record).
        var links = await db.ServiceRecordTasks.Include(j => j.ServiceRecord)
            .Where(j => taskIds.Contains(j.MaintenanceTaskId)).ToListAsync(ct);
        foreach (var task in tasks.Where(t => t.LastDoneDate == record.Date && t.LastDoneOdometerKm == record.OdometerKm))
        {
            var own = links.Where(j => j.MaintenanceTaskId == task.Id).ToList();
            var latest = own.Select(j => j.ServiceRecord!).Where(r => !r.IsVoided).MaxBy(r => (r.Date, r.OdometerKm, r.CreatedAt));
            var earliest = own.MinBy(j => j.ServiceRecord!.CreatedAt)!;
            (task.LastDoneDate, task.LastDoneOdometerKm) = latest is null
                ? (earliest.PreviousLastDoneDate, earliest.PreviousLastDoneOdometerKm)
                : (latest.Date, latest.OdometerKm);
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

    private static void ValidateCost(decimal? cost)
    {
        if (cost is { } c && (c < 0 || c > ServiceRecord.MaxCost || decimal.Round(c, 2) != c))
        {
            throw new ValidationFailedException("serviceRecord.invalidCost",
                $"The cost must be 0 to {ServiceRecord.MaxCost} with at most 2 decimals.");
        }
    }

    // Trimmed; blank is null.
    private static string? TrimNotes(string? notes)
    {
        var trimmed = notes?.Trim();
        if (trimmed?.Length > ServiceRecord.MaxNotesLength)
        {
            throw new ValidationFailedException("serviceRecord.notesTooLong", $"Notes can be up to {ServiceRecord.MaxNotesLength} characters.");
        }

        return string.IsNullOrEmpty(trimmed) ? null : trimmed;
    }

    private static OdometerReading ServiceReading(ServiceRecord record) => new()
    {
        VehicleId = record.VehicleId,
        ValueKm = record.OdometerKm,
        ReadingDate = record.Date,
        Source = OdometerSource.Service,
        ServiceRecord = record
    };

    private void LogServiceReading(Vehicle vehicle, List<OdometerReading> readings, OdometerReading reading)
    {
        db.OdometerReadings.Add(reading);
        readings.Add(reading);
        OdometerService.Recompute(vehicle, readings);
    }

    private static ServiceRecordDto ToDto(ServiceRecord r) => new(r.Id, r.Date, r.OdometerKm, r.ShopName, r.TotalCost, r.Notes,
        r.Tasks.Where(j => j.MaintenanceTask is not null).Select(j => j.MaintenanceTask!)
            .OrderBy(t => t.Name).Select(t => new ServiceRecordTaskDto(t.Id, t.Name, t.Category)).ToList());

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
