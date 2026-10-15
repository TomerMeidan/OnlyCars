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

    /// <summary>The car's non-voided service records, newest first (same order as the history search).</summary>
    public async Task<List<ServiceRecordDto>> ListRecordsAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        var records = await NewestFirst(db.ServiceRecords
            .Include(r => r.Tasks).ThenInclude(j => j.MaintenanceTask)
            .Include(r => r.Items)
            .AsSplitQuery()
            .Where(r => r.VehicleId == vehicleId && !r.IsVoided))
            .ToListAsync(ct);

        return records.Select(ToDto).ToList();
    }

    // One order for the car page and /history, so same-day records line up on both.
    private static IOrderedQueryable<ServiceRecord> NewestFirst(IQueryable<ServiceRecord> query) => query
        .OrderByDescending(r => r.Date)
        .ThenByDescending(r => r.OdometerKm)
        .ThenByDescending(r => r.CreatedAt)
        .ThenBy(r => r.Id); // unique tie-break so pages never overlap or skip a row

    public const int MaxSearchLength = 100;
    public const int MaxPageSize = 100;

    /// <summary>
    /// Non-voided records of all the caller's cars (archived included), filtered with AND, newest first by
    /// (date, odometer, creation time). Another user's vehicleId or taskId just matches nothing, so no id is confirmed.
    /// </summary>
    public async Task<ServiceRecordPageDto> SearchRecordsAsync(Guid userId, Guid? vehicleId, Guid? taskId, DateOnly? from, DateOnly? to,
        string? q, int skip, int take, CancellationToken ct = default)
    {
        if (from > to)
        {
            throw new ValidationFailedException("serviceRecord.invalidDateRange", "The start date must not be after the end date.");
        }
        var term = string.IsNullOrWhiteSpace(q) ? null : q.Trim();
        if (term?.Length > MaxSearchLength)
        {
            throw new ValidationFailedException("serviceRecord.searchTooLong", $"The search can be up to {MaxSearchLength} characters.");
        }
        if (skip < 0 || take < 1 || take > MaxPageSize)
        {
            throw new ValidationFailedException("serviceRecord.invalidPaging", $"Skip must be 0 or more and take 1 to {MaxPageSize}.");
        }

        var query = db.ServiceRecords.Where(r => r.Vehicle!.UserId == userId && !r.IsVoided);
        if (vehicleId is { } v) query = query.Where(r => r.VehicleId == v);
        if (taskId is { } t) query = query.Where(r => r.Tasks.Any(j => j.MaintenanceTaskId == t));
        if (from is { } f) query = query.Where(r => r.Date >= f);
        if (to is { } u) query = query.Where(r => r.Date <= u);
        if (term is not null)
        {
            // shortcut: unindexed LIKE '%term%' scans the user's records, fine at personal-app scale; add full-text search if it gets slow.
            // ToLower on both sides keeps it case-insensitive on any collation (and on the case-sensitive InMemory test provider).
            var lower = term.ToLower();
            query = query.Where(r =>
                (r.ShopName != null && r.ShopName.ToLower().Contains(lower)) ||
                (r.Notes != null && r.Notes.ToLower().Contains(lower)) ||
                r.Items.Any(i => i.Description.ToLower().Contains(lower) ||
                    (i.Brand != null && i.Brand.ToLower().Contains(lower)) ||
                    (i.PartNumber != null && i.PartNumber.ToLower().Contains(lower))));
        }

        var totalCount = await query.CountAsync(ct);
        var totalCost = await query.SumAsync(r => r.TotalCost ?? 0, ct);
        var page = await NewestFirst(query
            .Include(r => r.Tasks).ThenInclude(j => j.MaintenanceTask)
            .Include(r => r.Items)
            .AsSplitQuery())
            .Skip(skip).Take(take)
            .ToListAsync(ct);

        return new(page.Select(ToDto).ToList(), totalCount, totalCost);
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

        var (items, totalCost) = ValidateItems(request.Items, request.TotalCost);
        var shop = TrimShop(request.ShopName);
        var notes = TrimNotes(request.Notes);

        var carTasks = await db.MaintenanceTasks.Where(t => t.VehicleId == vehicle.Id).ToListAsync(ct);
        var linked = Resolve(carTasks, request.TaskIds ?? []);

        var record = new ServiceRecord
        {
            VehicleId = vehicle.Id,
            Date = date,
            OdometerKm = odometerKm,
            ShopName = shop,
            TotalCost = totalCost,
            Notes = notes,
            Items = items
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

    // Matched in memory against this car's tasks, so another car's (or user's) task id is not found; duplicates are ignored.
    private static List<MaintenanceTask> Resolve(List<MaintenanceTask> carTasks, List<Guid> taskIds) => taskIds.Distinct()
        .Select(id => carTasks.FirstOrDefault(t => t.Id == id) ?? throw new NotFoundException(nameof(MaintenanceTask), id))
        .OrderBy(t => t.Name)
        .ToList();

    /// <summary>
    /// Edits shop, cost, notes and items (the items list is replaced), and when sent (MVP3-D) the date, odometer and tasks:
    /// the Service reading moves with the record and the car's odometer is recomputed; removed, added and kept tasks follow
    /// the MVP3-D rules in decisions.md. Date-order checks run only when the date or odometer change. Every check runs
    /// before anything changes; one SaveChanges. Returns the record and every task of the car.
    /// </summary>
    public async Task<CreateServiceRecordResponse> UpdateRecordAsync(Guid userId, Guid vehicleId, Guid recordId, UpdateServiceRecordRequest request,
        CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var record = await db.ServiceRecords
            .Include(r => r.Tasks).ThenInclude(j => j.MaintenanceTask)
            .Include(r => r.Items)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == recordId && r.VehicleId == vehicle.Id, ct)
            ?? throw new NotFoundException(nameof(ServiceRecord), recordId);

        if (record.IsVoided)
        {
            throw new ConflictException("serviceRecord.alreadyVoided", "This service record is deleted.");
        }

        var today = TodayUtc();
        var oldKey = (record.Date, record.OdometerKm);
        var newKey = (Date: request.Date ?? record.Date, Km: request.OdometerKm ?? record.OdometerKm);
        var moved = newKey != oldKey;
        if (moved && newKey.Date > today.AddDays(1))
        {
            throw new ValidationFailedException("serviceRecord.futureDate", "The service date can't be in the future.");
        }

        var (items, totalCost) = ValidateItems(request.Items, request.TotalCost);
        var shop = TrimShop(request.ShopName);
        var notes = TrimNotes(request.Notes);

        var carTasks = await db.MaintenanceTasks.Where(t => t.VehicleId == vehicle.Id).ToListAsync(ct);
        var wanted = request.TaskIds is null ? null : Resolve(carTasks, request.TaskIds);

        var readings = await db.OdometerReadings.Where(r => r.VehicleId == vehicle.Id).ToListAsync(ct);
        var reading = readings.FirstOrDefault(r => r.ServiceRecordId == record.Id);
        if (moved)
        {
            // Validate excludes the reading itself, so the record never collides with its own old value.
            OdometerService.Validate(readings, reading ?? new OdometerReading(), newKey.Km, newKey.Date, request.ConfirmCorrection);
        }

        var now = DateTimeOffset.UtcNow;
        var removed = wanted is null ? [] : record.Tasks.Where(j => wanted.All(t => t.Id != j.MaintenanceTaskId)).ToList();
        var kept = record.Tasks.Except(removed).ToList();
        // Every link of the removed and kept tasks, voided ones included, for the void-rule fallback.
        var fallbackIds = record.Tasks.Select(j => j.MaintenanceTaskId).ToList();
        var links = await db.ServiceRecordTasks.Include(j => j.ServiceRecord)
            .Where(j => fallbackIds.Contains(j.MaintenanceTaskId)).ToListAsync(ct);

        foreach (var self in removed)
        {
            var task = self.MaintenanceTask!;
            if ((task.LastDoneDate, task.LastDoneOdometerKm) == oldKey)
            {
                (task.LastDoneDate, task.LastDoneOdometerKm) = FallBack(self, links);
                task.UpdatedAt = now;
            }
            db.ServiceRecordTasks.Remove(self);
            record.Tasks.Remove(self);
        }

        if (moved)
        {
            foreach (var self in kept)
            {
                var task = self.MaintenanceTask!;
                var current = (task.LastDoneDate, task.LastDoneOdometerKm);
                if (current == oldKey)
                {
                    var fallBack = FallBack(self, links);
                    (task.LastDoneDate, task.LastDoneOdometerKm) = fallBack.CompareTo(newKey) > 0 ? fallBack : newKey;
                }
                else if (newKey.CompareTo(current) >= 0)
                {
                    (task.LastDoneDate, task.LastDoneOdometerKm) = newKey;
                }
                if ((task.LastDoneDate, task.LastDoneOdometerKm) != current) task.UpdatedAt = now;
            }
        }

        foreach (var task in (wanted ?? []).Where(t => record.Tasks.All(j => j.MaintenanceTaskId != t.Id)))
        {
            var join = new ServiceRecordTask
            {
                MaintenanceTask = task,
                PreviousLastDoneOdometerKm = task.LastDoneOdometerKm,
                PreviousLastDoneDate = task.LastDoneDate
            };
            // Added explicitly, as with items below: a preset Id would otherwise be treated as an existing row.
            db.ServiceRecordTasks.Add(join);
            record.Tasks.Add(join);

            // Same rule as POST: an older service never makes a task look less recently done.
            if (newKey.CompareTo((task.LastDoneDate, task.LastDoneOdometerKm)) >= 0)
            {
                (task.LastDoneDate, task.LastDoneOdometerKm) = newKey;
                task.UpdatedAt = now;
            }
        }

        if (moved)
        {
            (record.Date, record.OdometerKm) = newKey;
            if (reading is null)
            {
                LogServiceReading(vehicle, readings, ServiceReading(record));
            }
            else
            {
                (reading.ReadingDate, reading.ValueKm) = newKey;
                reading.UpdatedAt = now;
                OdometerService.Recompute(vehicle, readings);
            }
        }

        db.ServiceItems.RemoveRange(record.Items);
        record.Items.Clear();
        // Added explicitly: Entity sets Id up front, so items added through the tracked record would be treated as existing rows.
        db.ServiceItems.AddRange(items);
        foreach (var item in items)
        {
            record.Items.Add(item);
        }

        record.ShopName = shop;
        record.TotalCost = totalCost;
        record.Notes = notes;
        record.UpdatedAt = now;

        await db.SaveChangesAsync(ct);
        return new(ToDto(record), carTasks.OrderByDescending(t => t.IsEnabled).ThenBy(t => t.Name).Select(t => ToDto(t, vehicle, today)).ToList());
    }

    /// <summary>
    /// Undo, in any order: voids the record, and each linked task whose LastDone* still equals this record's date and odometer
    /// goes to the later, by (date, odometer), of this record's snapshot (followed back through earlier-voided records it
    /// points at) and the latest remaining non-voided linked record. Other tasks (a later record or a manual edit) are left alone. The
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
        // Every link of these tasks, voided ones included (a snapshot can point at an earlier voided record).
        var links = await db.ServiceRecordTasks.Include(j => j.ServiceRecord)
            .Where(j => taskIds.Contains(j.MaintenanceTaskId)).ToListAsync(ct);
        foreach (var task in tasks.Where(t => t.LastDoneDate == record.Date && t.LastDoneOdometerKm == record.OdometerKm))
        {
            (task.LastDoneDate, task.LastDoneOdometerKm) = FallBack(record.Tasks.Single(j => j.MaintenanceTaskId == task.Id), links);
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

    /// <summary>
    /// "Void recompute, corrected": a task's last done without the record of <paramref name="self"/>. Starts from that link's
    /// snapshot, follows it back through earlier-voided linked records, then takes the later, by (date, odometer), of that
    /// and the latest other non-voided linked record. <paramref name="links"/> holds the task's links with their records.
    /// </summary>
    private static (DateOnly Date, decimal Km) FallBack(ServiceRecordTask self, List<ServiceRecordTask> links)
    {
        var own = links.Where(j => j.MaintenanceTaskId == self.MaintenanceTaskId && j != self).ToList();
        var baseValue = (self.PreviousLastDoneDate, self.PreviousLastDoneOdometerKm);
        // Follow the snapshot chain back through records voided earlier; each is used once, so it can't loop.
        var voided = own.Where(j => j.ServiceRecord!.IsVoided).OrderByDescending(j => j.ServiceRecord!.CreatedAt).ToList();
        while (voided.FirstOrDefault(j => (j.ServiceRecord!.Date, j.ServiceRecord.OdometerKm) == baseValue) is { } earlier)
        {
            baseValue = (earlier.PreviousLastDoneDate, earlier.PreviousLastDoneOdometerKm);
            voided.Remove(earlier);
        }

        var latest = own.Select(j => j.ServiceRecord!).Where(r => !r.IsVoided).MaxBy(r => (r.Date, r.OdometerKm, r.CreatedAt));
        return latest is not null && (latest.Date, latest.OdometerKm).CompareTo(baseValue) > 0 ? (latest.Date, latest.OdometerKm) : baseValue;
    }

    private static void ValidateCost(decimal? cost)
    {
        if (cost is { } c && (c < 0 || c > ServiceRecord.MaxCost || decimal.Round(c, 2) != c))
        {
            throw new ValidationFailedException("serviceRecord.invalidCost",
                $"The cost must be 0 to {ServiceRecord.MaxCost} with at most 2 decimals.");
        }
    }

    // Trimmed; blank is null (DIY).
    private static string? TrimShop(string? shopName)
    {
        var shop = shopName?.Trim();
        if (shop?.Length > ServiceRecord.MaxShopNameLength)
        {
            throw new ValidationFailedException("serviceRecord.shopTooLong", $"The shop name can be up to {ServiceRecord.MaxShopNameLength} characters.");
        }

        return string.IsNullOrEmpty(shop) ? null : shop;
    }

    /// <summary>
    /// Checks the items in order (each error names its 0-based row in an <c>index</c> extension) and returns them with the
    /// record's total: the sum of quantity times unit cost when there are items (the entered cost is ignored), else the entered cost.
    /// </summary>
    private static (List<ServiceItem> Items, decimal? TotalCost) ValidateItems(List<ServiceItemRequest>? requests, decimal? enteredCost)
    {
        requests ??= [];
        if (requests.Count > ServiceItem.MaxItemsPerRecord)
        {
            throw new ValidationFailedException("serviceRecord.tooManyItems", $"A service can have up to {ServiceItem.MaxItemsPerRecord} items.");
        }

        var items = requests.Select(ToItem).ToList();
        if (items.Count == 0)
        {
            ValidateCost(enteredCost);
            return (items, enteredCost);
        }

        // Half away from zero, the usual money rounding; the client's live sum must round the same way.
        var sum = decimal.Round(items.Sum(i => i.Quantity * i.UnitCost), 2, MidpointRounding.AwayFromZero);
        ValidateCost(sum);
        return (items, sum);
    }

    private static ServiceItem ToItem(ServiceItemRequest? request, int index)
    {
        var description = request?.Description?.Trim();
        if (request is null || string.IsNullOrEmpty(description) || description.Length > ServiceItem.MaxDescriptionLength)
        {
            throw ItemError("serviceItem.invalidDescription", $"The description must be 1 to {ServiceItem.MaxDescriptionLength} characters.", index);
        }

        var brand = request.Brand?.Trim() is { Length: > 0 } b ? b : null;
        if (brand?.Length > ServiceItem.MaxBrandLength)
        {
            throw ItemError("serviceItem.brandTooLong", $"The brand can be up to {ServiceItem.MaxBrandLength} characters.", index);
        }

        var partNumber = request.PartNumber?.Trim() is { Length: > 0 } p ? p : null;
        if (partNumber?.Length > ServiceItem.MaxPartNumberLength)
        {
            throw ItemError("serviceItem.partNumberTooLong", $"The part number can be up to {ServiceItem.MaxPartNumberLength} characters.", index);
        }

        if (request.Quantity is not { } quantity || quantity <= 0 || quantity > ServiceItem.MaxQuantity || decimal.Round(quantity, 2) != quantity)
        {
            throw ItemError("serviceItem.invalidQuantity", $"The quantity must be above 0 and up to {ServiceItem.MaxQuantity} with at most 2 decimals.", index);
        }

        if (request.UnitCost is not { } unitCost || unitCost < 0 || unitCost > ServiceRecord.MaxCost || decimal.Round(unitCost, 2) != unitCost)
        {
            throw ItemError("serviceItem.invalidUnitCost", $"The unit cost must be 0 to {ServiceRecord.MaxCost} with at most 2 decimals.", index);
        }

        return new ServiceItem
        {
            Description = description,
            Brand = brand,
            PartNumber = partNumber,
            Quantity = quantity,
            UnitCost = unitCost,
            IsLabor = request.IsLabor,
            SortOrder = index
        };
    }

    private static ValidationFailedException ItemError(string code, string message, int index)
    {
        var ex = new ValidationFailedException(code, $"Item {index + 1}: {message}");
        ex.Extensions["index"] = index;
        return ex;
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
            .OrderBy(t => t.Name).Select(t => new ServiceRecordTaskDto(t.Id, t.Name, t.Category)).ToList(),
        r.Items.OrderBy(i => i.SortOrder)
            .Select(i => new ServiceItemDto(i.Id, i.Description, i.Brand, i.PartNumber, i.Quantity, i.UnitCost, i.IsLabor)).ToList(),
        r.VehicleId);

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
