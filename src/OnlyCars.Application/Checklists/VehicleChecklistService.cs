using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Checklists;

/// <summary>Checklists attached to cars and their runs (MVP5-B, decisions.md "Checklist run rules, MVP5-B").</summary>
public class VehicleChecklistService(IAppDbContext db, VehicleService vehicleService, IOptions<StorageOptions>? storageOptions = null)
{
    private readonly AttachmentFiles attachmentFiles = new(db, vehicleService, storageOptions);

    // shortcut: no GET /api/vehicle-checklists/{id}; the run page loads this whole list, fine at a few checklists per car, add it if lists grow.
    public async Task<List<VehicleChecklistDto>> ListAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        return await QueryAsync(db, c => c.VehicleId == vehicleId, ct);
    }

    /// <summary>The last run starts at the client's today and the car's current odometer, like a new task's last done.</summary>
    public async Task<VehicleChecklistDto> AttachAsync(Guid userId, Guid vehicleId, AttachChecklistRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        EnsureActive(vehicle);
        ValidateIntervals(request.IntervalKm, request.IntervalDays);

        // The client sends its local date; one day of slack either way, as for Mark done.
        var today = TodayUtc();
        var date = request.Date ?? today;
        if (Math.Abs(date.DayNumber - today.DayNumber) > 1)
        {
            throw new ValidationFailedException("vehicleChecklist.invalidDate", "The date must be today.");
        }

        var templateId = request.TemplateId ?? Guid.Empty;
        if (!await db.ChecklistTemplates.AnyAsync(t => t.Id == templateId && t.UserId == userId, ct))
        {
            throw new NotFoundException(nameof(ChecklistTemplate), templateId);
        }

        if (await db.VehicleChecklists.AnyAsync(c => c.VehicleId == vehicle.Id && c.TemplateId == templateId, ct))
        {
            throw Duplicate();
        }

        var checklist = new VehicleChecklist
        {
            VehicleId = vehicle.Id,
            TemplateId = templateId,
            IntervalKm = request.IntervalKm,
            IntervalDays = request.IntervalDays,
            LastRunDate = date,
            LastRunOdometerKm = vehicle.CurrentOdometerKm,
            StartDate = date,
            StartOdometerKm = vehicle.CurrentOdometerKm
        };
        db.VehicleChecklists.Add(checklist);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A simultaneous attach of the same template won the unique index (L51).
            if (await db.VehicleChecklists.AnyAsync(c => c.VehicleId == vehicle.Id && c.TemplateId == templateId && c.Id != checklist.Id, ct))
            {
                throw Duplicate();
            }

            throw;
        }

        return await DtoAsync(checklist.Id, ct);
    }

    private static ConflictException Duplicate() => new("vehicleChecklist.duplicate", "This checklist is already on this car.");

    public async Task<VehicleChecklistDto> UpdateAsync(Guid userId, Guid id, UpdateVehicleChecklistRequest request, CancellationToken ct = default)
    {
        var checklist = await FindOwnedAsync(userId, id, ct);
        ValidateIntervals(request.IntervalKm, request.IntervalDays);

        checklist.IntervalKm = request.IntervalKm;
        checklist.IntervalDays = request.IntervalDays;
        checklist.IsEnabled = request.IsEnabled ?? checklist.IsEnabled;
        checklist.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return await DtoAsync(checklist.Id, ct);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        var checklist = await FindOwnedAsync(userId, id, ct);
        if (await db.ChecklistRuns.AnyAsync(r => r.VehicleChecklistId == checklist.Id, ct))
        {
            throw new ConflictException("vehicleChecklist.hasRuns", "This checklist has runs. Turn it off instead.");
        }

        db.VehicleChecklists.Remove(checklist);
        await db.SaveChangesAsync(ct);
    }

    public const int MaxRunsListed = 200;

    /// <summary>Newest first: RunAt, then creation time.</summary>
    public async Task<List<ChecklistRunDto>> ListRunsAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        var checklist = await FindOwnedAsync(userId, id, ct);
        var runs = await db.ChecklistRuns.Include(r => r.Items).Include(r => r.Attachments)
            .Where(r => r.VehicleChecklistId == checklist.Id)
            .OrderByDescending(r => r.RunAt).ThenByDescending(r => r.CreatedAt)
            // shortcut: newest 200 runs only, no paging (decisions.md, LOW-3); page it if a car ever needs older runs on screen.
            .Take(MaxRunsListed)
            .AsSplitQuery()
            .ToListAsync(ct);
        var issues = await db.Issues.Where(i => i.SourceRunItem!.Run!.VehicleChecklistId == checklist.Id)
            .ToDictionaryAsync(i => i.SourceRunItemId!.Value, i => i.Id, ct);
        return runs.Select(r => ToDto(r, issues, userId, checklist.VehicleId)).ToList();
    }

    /// <summary>
    /// One run item per current template item, flagged by the server rules; an entered odometer is logged as a Checklist reading under
    /// the date-order rules. The last run moves only when the run is at least as recent. Every check runs before anything changes.
    /// </summary>
    public async Task<CreateChecklistRunResponse> CreateRunAsync(Guid userId, Guid id, CreateChecklistRunRequest request, CancellationToken ct = default)
    {
        var checklist = await FindOwnedAsync(userId, id, ct, withTemplateItems: true);
        var vehicle = checklist.Vehicle!;
        EnsureActive(vehicle);

        // Same one day of slack as readings and service records: the client sends its local date.
        var today = TodayUtc();
        var runAt = request.RunAt ?? today;
        DateRules.RejectTooEarly(runAt);
        if (runAt > today.AddDays(1))
        {
            throw new ValidationFailedException("checklistRun.futureDate", "The run date can't be in the future.");
        }

        if (request.OdometerKm is < 0 or > OdometerReading.MaxValueKm)
        {
            throw new ValidationFailedException("checklistRun.invalidOdometer", $"The odometer must be 0 to {OdometerReading.MaxValueKm} km.");
        }

        var notes = request.Notes?.Trim() is { Length: > 0 } n ? n : null;
        if (notes?.Length > ChecklistRun.MaxNotesLength)
        {
            throw new ValidationFailedException("checklistRun.invalidNotes", $"Notes can be up to {ChecklistRun.MaxNotesLength} characters.");
        }

        var items = BuildItems(checklist.Template!.Items, request.Items);

        var readings = await db.OdometerReadings.Where(r => r.VehicleId == vehicle.Id).ToListAsync(ct);
        OdometerReading? reading = null;
        if (request.OdometerKm is { } km)
        {
            reading = new OdometerReading { VehicleId = vehicle.Id, ValueKm = km, ReadingDate = runAt, Source = OdometerSource.Checklist };
            OdometerService.Validate(readings, reading, km, runAt, request.ConfirmCorrection);
        }

        var run = new ChecklistRun
        {
            VehicleChecklistId = checklist.Id,
            RunAt = runAt,
            OdometerKm = request.OdometerKm ?? vehicle.CurrentOdometerKm,
            Notes = notes,
            OdometerReading = reading,
            Items = items
        };
        db.ChecklistRuns.Add(run);

        if (reading is not null)
        {
            readings.Add(reading);
            OdometerService.Recompute(vehicle, readings);
        }

        // An older run never makes the checklist look less recently run (as for tasks).
        if ((runAt, run.OdometerKm).CompareTo((checklist.LastRunDate, checklist.LastRunOdometerKm)) >= 0)
        {
            (checklist.LastRunDate, checklist.LastRunOdometerKm) = (runAt, run.OdometerKm);
            checklist.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        return new(ToDto(run, new Dictionary<Guid, Guid>(), userId, vehicle.Id), await DtoAsync(checklist.Id, ct));
    }

    /// <summary>
    /// Hard delete. The last run becomes the later of the attach values and the latest remaining run, and the run's Checklist reading
    /// is removed with the odometer recompute.
    /// </summary>
    public async Task DeleteRunAsync(Guid userId, Guid runId, CancellationToken ct = default)
    {
        var run = await db.ChecklistRuns
            .Include(r => r.Items)
            .Include(r => r.Attachments)
            .Include(r => r.VehicleChecklist).ThenInclude(c => c!.Vehicle)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == runId && r.VehicleChecklist!.Vehicle!.UserId == userId, ct)
            ?? throw new NotFoundException(nameof(ChecklistRun), runId);
        var checklist = run.VehicleChecklist!;
        var now = DateTimeOffset.UtcNow;

        db.ChecklistRuns.Remove(run);
        // The photo link doesn't cascade (SQL Server's one-path rule): the rows go here, the objects after the save.
        var photos = run.Attachments.ToList();
        db.Attachments.RemoveRange(photos);

        // The to-do link doesn't cascade (SQL Server's one-path rule): the run's to-dos stay, without their source.
        foreach (var issue in await db.Issues.Where(i => i.SourceRunItem!.RunId == run.Id).ToListAsync(ct))
        {
            issue.SourceRunItemId = null;
            issue.UpdatedAt = now;
        }

        if (run.OdometerReadingId is { } readingId)
        {
            var readings = await db.OdometerReadings.Where(r => r.VehicleId == checklist.VehicleId).ToListAsync(ct);
            if (readings.FirstOrDefault(r => r.Id == readingId) is { } reading)
            {
                OdometerService.RemoveLinked(db, readings, reading, now);
                OdometerService.Recompute(checklist.Vehicle!, readings);
            }
        }

        var last = (checklist.StartDate, checklist.StartOdometerKm);
        var latest = await db.ChecklistRuns.Where(r => r.VehicleChecklistId == checklist.Id && r.Id != run.Id)
            .OrderByDescending(r => r.RunAt).ThenByDescending(r => r.OdometerKm)
            .FirstOrDefaultAsync(ct);
        if (latest is not null && (latest.RunAt, latest.OdometerKm).CompareTo(last) > 0)
        {
            last = (latest.RunAt, latest.OdometerKm);
        }

        (checklist.LastRunDate, checklist.LastRunOdometerKm) = last;
        checklist.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        await attachmentFiles.DeleteObjectsAsync(photos, AttachmentFiles.RunPrefix(userId, checklist.VehicleId, run.Id));
    }

    /// <summary>
    /// A photo (JPEG, PNG or WebP, metadata stripped; no PDF) on the caller's run, in the order of the FILE-3 contract; a turned-off
    /// checklist's runs still take photos. Returns the run with its photos.
    /// </summary>
    public async Task<ChecklistRunDto> AddRunAttachmentAsync(Guid userId, Guid runId, byte[]? content, string? fileName, CancellationToken ct = default)
    {
        vehicleService.Storage(); // keeps 503 file.storageUnavailable ahead of 404
        var run = await db.ChecklistRuns
            .Include(r => r.Items)
            .Include(r => r.Attachments)
            .Include(r => r.VehicleChecklist).ThenInclude(c => c!.Vehicle)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == runId && r.VehicleChecklist!.Vehicle!.UserId == userId, ct)
            ?? throw new NotFoundException(nameof(ChecklistRun), runId);
        var vehicle = run.VehicleChecklist!.Vehicle!;

        await attachmentFiles.AddAsync(userId, vehicle, run, run.Attachments, AttachmentFiles.RunPrefix(userId, vehicle.Id, run.Id),
            content, fileName, photosOnly: true, ct);
        var issues = await db.Issues.Where(i => i.SourceRunItem!.RunId == run.Id).ToDictionaryAsync(i => i.SourceRunItemId!.Value, i => i.Id, ct);
        return ToDto(run, issues, userId, vehicle.Id);
    }

    /// <summary>Deletes the row, then the object (a failed object delete is logged). Allowed on an archived car.</summary>
    public async Task DeleteRunAttachmentAsync(Guid userId, Guid runId, Guid attachmentId, CancellationToken ct = default)
    {
        vehicleService.Storage(); // keeps 503 file.storageUnavailable ahead of 404
        // One scoped lookup: another user's run or photo, or a mismatched path, is the same 404.
        var found = await db.Attachments
            .Where(a => a.Id == attachmentId && a.ChecklistRunId == runId && a.ChecklistRun!.VehicleChecklist!.Vehicle!.UserId == userId)
            .Select(a => new { Attachment = a, a.ChecklistRun!.VehicleChecklist!.VehicleId })
            .FirstOrDefaultAsync(ct)
            ?? throw new NotFoundException(nameof(Attachment), attachmentId);

        db.Attachments.Remove(found.Attachment);
        await db.SaveChangesAsync(ct);
        await attachmentFiles.DeleteObjectsAsync([found.Attachment], AttachmentFiles.RunPrefix(userId, found.VehicleId, runId));
    }

    /// <summary>
    /// Checklists matching <paramref name="filter"/> with status, most urgent first: Overdue, Due soon, OK, then manual only, then off;
    /// ties by name. Shared with the dashboard.
    /// </summary>
    internal static async Task<List<VehicleChecklistDto>> QueryAsync(IAppDbContext db, Expression<Func<VehicleChecklist, bool>> filter,
        CancellationToken ct)
    {
        var rows = await db.VehicleChecklists.Where(filter)
            .Select(c => new
            {
                Checklist = c,
                c.Template!.Name,
                ItemCount = c.Template.Items.Count,
                RunCount = c.Runs.Count,
                LatestRunDate = c.Runs.Max(r => (DateOnly?)r.RunAt),
                c.Vehicle!.CurrentOdometerKm
            })
            .ToListAsync(ct);

        var today = TodayUtc();
        return rows.Select(r => ToDto(r.Checklist, r.Name, r.ItemCount, r.RunCount, r.LatestRunDate, r.CurrentOdometerKm, today))
            .OrderBy(c => c.Status is null)
            .ThenByDescending(c => c.Status)
            .ThenByDescending(c => c.IsEnabled)
            .ThenBy(c => c.Name, StringComparer.InvariantCulture)
            .ToList();
    }

    private async Task<VehicleChecklistDto> DtoAsync(Guid id, CancellationToken ct) => (await QueryAsync(db, c => c.Id == id, ct)).Single();

    // Scoped through the car's owner, so another user's attachment is simply not found.
    private async Task<VehicleChecklist> FindOwnedAsync(Guid userId, Guid id, CancellationToken ct, bool withTemplateItems = false)
    {
        var query = db.VehicleChecklists.Include(c => c.Vehicle).AsQueryable();
        if (withTemplateItems)
        {
            query = query.Include(c => c.Template).ThenInclude(t => t!.Items);
        }

        return await query.FirstOrDefaultAsync(c => c.Id == id && c.Vehicle!.UserId == userId, ct)
            ?? throw new NotFoundException(nameof(VehicleChecklist), id);
    }

    private static void EnsureActive(Vehicle vehicle)
    {
        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("vehicleChecklist.vehicleArchived", "This car is archived.");
        }
    }

    private static void ValidateIntervals(int? intervalKm, int? intervalDays)
    {
        if (intervalKm is < 1 or > VehicleChecklist.MaxIntervalKm || intervalDays is < 1 or > VehicleChecklist.MaxIntervalDays)
        {
            throw new ValidationFailedException("vehicleChecklist.invalidInterval",
                $"The km interval must be 1 to {VehicleChecklist.MaxIntervalKm} and the time interval 1 to {VehicleChecklist.MaxIntervalDays} days.");
        }
    }

    /// <summary>The request must name each current template item exactly once (any order); otherwise the form is stale (itemsChanged).</summary>
    private static List<ChecklistRunItem> BuildItems(List<ChecklistTemplateItem> templateItems, List<ChecklistRunItemRequest?>? requests)
    {
        requests ??= [];
        var byId = templateItems.ToDictionary(i => i.Id);
        var ids = requests.Select(r => r?.TemplateItemId).ToList();
        if (ids.Count != byId.Count || ids.Distinct().Count() != ids.Count || ids.Any(i => i is not { } g || !byId.ContainsKey(g)))
        {
            throw new ValidationFailedException("checklistRun.itemsChanged", "The checklist has changed. Reload it and run it again.");
        }

        return requests.Select((r, index) => ToRunItem(byId[r!.TemplateItemId!.Value], r, index)).ToList();
    }

    private static ChecklistRunItem ToRunItem(ChecklistTemplateItem item, ChecklistRunItemRequest r, int index)
    {
        var text = r.TextValue?.Trim() is { Length: > 0 } t ? t : null;
        var fits = item.Type switch
        {
            ChecklistItemType.Check => r.NumberValue is null && text is null,
            ChecklistItemType.Number => r.BoolValue is null && text is null
                && (r.NumberValue is not { } n || Math.Abs(n) <= ChecklistTemplateItem.MaxAbsValue && decimal.Round(n, 2) == n),
            _ => r.BoolValue is null && r.NumberValue is null && !(text?.Length > ChecklistRunItem.MaxTextLength)
        };
        if (!fits)
        {
            throw ChecklistTemplateService.ItemError("checklistItem.invalidValue",
                $"The value doesn't fit this item (numbers -{ChecklistTemplateItem.MaxAbsValue} to {ChecklistTemplateItem.MaxAbsValue} " +
                $"with at most 2 decimals, text up to {ChecklistRunItem.MaxTextLength} characters).", index);
        }

        // Not OK and a number outside Min/Max (the bounds themselves are inside) are always flagged; the client can only add a flag.
        var autoFlagged = r.BoolValue == false || r.NumberValue < item.MinValue || r.NumberValue > item.MaxValue;
        return new ChecklistRunItem
        {
            TemplateItemId = item.Id,
            LabelSnapshot = item.Label,
            Type = item.Type,
            Unit = item.Unit,
            MinValue = item.MinValue,
            MaxValue = item.MaxValue,
            SortOrder = item.SortOrder,
            BoolValue = r.BoolValue,
            NumberValue = r.NumberValue,
            TextValue = text,
            IsFlagged = autoFlagged || r.IsFlagged
        };
    }

    private static DateOnly TodayUtc() => DateOnly.FromDateTime(DateTime.UtcNow);

    private static VehicleChecklistDto ToDto(VehicleChecklist c, string name, int itemCount, int runCount, DateOnly? latestRunDate,
        decimal currentKm, DateOnly today)
    {
        var s = TaskStatusCalculator.Compute(c.IsEnabled, c.IntervalKm, c.IntervalDays, VehicleChecklist.DueSoonPercent,
            c.LastRunOdometerKm, c.LastRunDate, currentKm, today);
        return new(c.Id, c.VehicleId, c.TemplateId, name, itemCount, c.IntervalKm, c.IntervalDays, c.IsEnabled, c.LastRunDate,
            c.LastRunOdometerKm, runCount, s.Status, s.RemainingKm, s.RemainingDays, s.Progress, latestRunDate);
    }

    // userId and vehicleId are the caller's, already checked to own the run; they only build the photo key check.
    private ChecklistRunDto ToDto(ChecklistRun r, Dictionary<Guid, Guid> issueByItem, Guid userId, Guid vehicleId) => new(r.Id,
        r.VehicleChecklistId, r.RunAt, r.OdometerKm, r.OdometerReadingId, r.Notes,
        r.Items.Count(i => i.IsFlagged),
        r.Items.OrderBy(i => i.SortOrder)
            .Select(i => new ChecklistRunItemDto(i.Id, i.TemplateItemId, i.LabelSnapshot, i.Type, i.Unit, i.MinValue, i.MaxValue,
                i.BoolValue, i.NumberValue, i.TextValue, i.IsFlagged, issueByItem.TryGetValue(i.Id, out var issueId) ? issueId : null))
            .ToList(),
        attachmentFiles.ToDtos(r.Attachments, AttachmentFiles.RunPrefix(userId, vehicleId, r.Id)));
}
