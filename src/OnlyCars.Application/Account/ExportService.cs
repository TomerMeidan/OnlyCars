using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Account.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Reminders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Account;

/// <summary>
/// Everything the user owns as one document (ACC-1, decisions.md "Data export, ACC-1"): one query per table, whatever the
/// number of cars, then joined in memory. Lists run oldest first, then by id, so unchanged data exports identically.
/// </summary>
public class ExportService(IAppDbContext db)
{
    public const int FormatVersion = 1;

    public async Task<ExportDto> ExportAsync(Guid userId, CancellationToken ct = default)
    {
        // Projected, so the password hash and the photo key are never read.
        var user = await db.Users.Where(u => u.Id == userId)
            .Select(u => new { u.Email, u.DistanceUnit, u.Currency, u.Locale, u.Theme, u.CreatedAt })
            .SingleOrDefaultAsync(ct) ?? throw new NotFoundException(nameof(User), userId);
        var leadDays = await ReminderService.LeadDaysAsync(db, userId, ct);
        var vehicles = await db.Vehicles.Where(v => v.UserId == userId)
            .Select(v => new { v.Id, v.Nickname, v.Make, v.Model, v.Year, v.Vin, v.Plate, v.FuelType, v.PurchaseDate, v.PurchasePrice,
                v.CurrentOdometerKm, v.IsArchived, v.ArchivedAt, HasPhoto = v.PhotoUrl != null, v.CreatedAt })
            .ToListAsync(ct);

        var readings = (await db.OdometerReadings.AsNoTracking().Where(o => o.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(o => o.ReadingDate).ThenBy(o => o.CreatedAt).ThenBy(o => o.Id).ToLookup(o => o.VehicleId);
        var tasks = (await db.MaintenanceTasks.Where(t => t.Vehicle!.UserId == userId)
                .Select(t => new { Task = t, TemplateKey = t.Template != null ? t.Template.Key : null }).AsNoTracking().ToListAsync(ct))
            .OrderBy(t => t.Task.CreatedAt).ThenBy(t => t.Task.Id).ToLookup(t => t.Task.VehicleId);
        var records = (await db.ServiceRecords.AsNoTracking().Where(r => r.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(r => r.Date).ThenBy(r => r.CreatedAt).ThenBy(r => r.Id).ToLookup(r => r.VehicleId);
        var recordTasks = (await db.ServiceRecordTasks.AsNoTracking().Where(j => j.ServiceRecord!.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(j => j.MaintenanceTaskId).ToLookup(j => j.ServiceRecordId);
        var items = (await db.ServiceItems.AsNoTracking().Where(i => i.ServiceRecord!.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(i => i.SortOrder).ThenBy(i => i.Id).ToLookup(i => i.ServiceRecordId);
        // Projected, so the storage key (FileUrl) is never read.
        var files = (await db.Attachments
                .Where(a => a.ServiceRecord!.Vehicle!.UserId == userId || a.ChecklistRun!.VehicleChecklist!.Vehicle!.UserId == userId)
                .Select(a => new { a.Id, a.ServiceRecordId, a.ChecklistRunId, File = new ExportFileDto(a.FileName, a.ContentType, a.SizeBytes, a.CreatedAt) })
                .ToListAsync(ct))
            .OrderBy(a => a.File.CreatedAt).ThenBy(a => a.Id).ToList();
        var recordFiles = files.Where(a => a.ServiceRecordId != null).ToLookup(a => a.ServiceRecordId!.Value, a => a.File);
        var runFiles = files.Where(a => a.ChecklistRunId != null).ToLookup(a => a.ChecklistRunId!.Value, a => a.File);
        var checklists = (await db.VehicleChecklists.AsNoTracking().Where(c => c.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(c => c.CreatedAt).ThenBy(c => c.Id).ToLookup(c => c.VehicleId);
        var runs = (await db.ChecklistRuns.AsNoTracking().Where(r => r.VehicleChecklist!.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(r => r.RunAt).ThenBy(r => r.CreatedAt).ThenBy(r => r.Id).ToLookup(r => r.VehicleChecklistId);
        var runItems = (await db.ChecklistRunItems.AsNoTracking().Where(i => i.Run!.VehicleChecklist!.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(i => i.SortOrder).ThenBy(i => i.Id).ToLookup(i => i.RunId);
        var issues = (await db.Issues.AsNoTracking().Where(i => i.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(i => i.CreatedAt).ThenBy(i => i.Id).ToLookup(i => i.VehicleId);
        var documents = (await db.VehicleDocuments.AsNoTracking().Where(d => d.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(d => d.ExpiryDate).ThenBy(d => d.CreatedAt).ThenBy(d => d.Id).ToLookup(d => d.VehicleId);

        var templates = (await db.ChecklistTemplates.AsNoTracking().Where(t => t.UserId == userId).ToListAsync(ct))
            .OrderBy(t => t.CreatedAt).ThenBy(t => t.Id).ToList();
        var templateItems = (await db.ChecklistTemplateItems.AsNoTracking().Where(i => i.Template!.UserId == userId).ToListAsync(ct))
            .OrderBy(i => i.SortOrder).ThenBy(i => i.Id).ToLookup(i => i.TemplateId);

        var tireSets = (await db.TireSets.AsNoTracking().Where(s => s.UserId == userId).ToListAsync(ct))
            .OrderBy(s => s.CreatedAt).ThenBy(s => s.Id).ToList();
        var mounts = (await db.TireMounts.AsNoTracking().Where(m => m.TireSet!.UserId == userId).ToListAsync(ct))
            .OrderBy(m => m.MountedAt).ThenBy(m => m.CreatedAt).ThenBy(m => m.Id).ToLookup(m => m.TireSetId);
        var checks = (await db.TireChecks.AsNoTracking().Where(c => c.TireMount!.TireSet!.UserId == userId).ToListAsync(ct))
            .OrderBy(c => c.MeasuredAt).ThenBy(c => c.CreatedAt).ThenBy(c => c.Id).ToLookup(c => c.TireMountId);
        var measurements = (await db.TireMeasurements.AsNoTracking().Where(m => m.TireCheck!.TireMount!.TireSet!.UserId == userId).ToListAsync(ct))
            .OrderBy(m => m.Position).ThenBy(m => m.CreatedAt).ThenBy(m => m.Id).ToLookup(m => m.TireCheckId);
        var rotations = (await db.TireRotations.AsNoTracking().Where(r => r.TireMount!.TireSet!.UserId == userId).ToListAsync(ct))
            .OrderBy(r => r.Date).ThenBy(r => r.CreatedAt).ThenBy(r => r.Id).ToLookup(r => r.TireMountId);

        var currentKm = vehicles.ToDictionary(v => v.Id, v => v.CurrentOdometerKm);

        return new ExportDto(FormatVersion, DateTimeOffset.UtcNow, new("km", user.Currency),
            new(user.Email, user.DistanceUnit, user.Currency, user.Locale, user.Theme, leadDays, user.CreatedAt),
            vehicles.OrderBy(v => v.CreatedAt).ThenBy(v => v.Id).Select(v => new ExportVehicleDto(v.Id, v.Nickname, v.Make, v.Model, v.Year,
                v.Vin, v.Plate, v.FuelType, v.PurchaseDate, v.PurchasePrice, v.CurrentOdometerKm, v.IsArchived, v.ArchivedAt, v.HasPhoto,
                v.CreatedAt,
                readings[v.Id].Select(o => new ExportOdometerReadingDto(o.Id, o.ValueKm, o.ReadingDate, o.Source, o.ServiceRecordId)).ToList(),
                tasks[v.Id].Select(t => new ExportMaintenanceTaskDto(t.Task.Id, t.TemplateKey, t.Task.Name, t.Task.Category, t.Task.IntervalKm,
                    t.Task.IntervalDays, t.Task.DueSoonPercent, t.Task.IsEnabled, t.Task.LastDoneOdometerKm, t.Task.LastDoneDate)).ToList(),
                records[v.Id].Select(r => new ExportServiceRecordDto(r.Id, r.Date, r.OdometerKm, r.ShopName, r.TotalCost, r.Notes, r.IsVoided,
                    recordTasks[r.Id].Select(j => j.MaintenanceTaskId).ToList(),
                    items[r.Id].Select(i => new ExportServiceItemDto(i.Description, i.Brand, i.PartNumber, i.Quantity, i.UnitCost, i.IsLabor)).ToList(),
                    recordFiles[r.Id].ToList())).ToList(),
                checklists[v.Id].Select(c => new ExportChecklistDto(c.Id, c.TemplateId, c.IntervalKm, c.IntervalDays, c.LastRunOdometerKm,
                    c.LastRunDate, c.StartDate, c.StartOdometerKm, c.IsEnabled,
                    runs[c.Id].Select(r => new ExportChecklistRunDto(r.Id, r.RunAt, r.OdometerKm, r.OdometerReadingId, r.Notes,
                        runItems[r.Id].Select(i => new ExportRunItemDto(i.Id, i.TemplateItemId, i.LabelSnapshot, i.Type, i.Unit, i.MinValue, i.MaxValue, i.BoolValue,
                            i.NumberValue, i.TextValue, i.IsFlagged)).ToList(),
                        runFiles[r.Id].ToList())).ToList())).ToList(),
                issues[v.Id].Select(i => new ExportIssueDto(i.Id, i.Title, StripDirectionMarks(i.Description), i.Status, i.SourceRunItemId,
                    i.ResolvedAt, i.CreatedAt)).ToList(),
                documents[v.Id].Select(d => new ExportDocumentDto(d.Id, d.Type, d.ExpiryDate, d.Cost, d.Notes)).ToList())).ToList(),
            templates.Select(t => new ExportChecklistTemplateDto(t.Id, t.Name,
                templateItems[t.Id].Select(i => new ExportTemplateItemDto(i.Id, i.Label, i.Type, i.Unit, i.MinValue, i.MaxValue, i.SortOrder))
                    .ToList())).ToList(),
            tireSets.Select(s => new ExportTireSetDto(s.Id, s.Brand, s.Model, s.Size, s.Season, s.PurchaseDate, s.DotCode, s.Notes,
                mounts[s.Id].Select(m => new ExportTireMountDto(m.VehicleId, m.MountedAt, m.MountOdometerKm, m.UnmountedAt, m.UnmountOdometerKm,
                    // The same km per mount as the tire screens (TireService).
                    m.UnmountOdometerKm is { } off ? off - m.MountOdometerKm
                        : Math.Max(currentKm.GetValueOrDefault(m.VehicleId, m.MountOdometerKm) - m.MountOdometerKm, 0),
                    checks[m.Id].Select(c => new ExportTireCheckDto(c.MeasuredAt,
                        measurements[c.Id].Select(x => new ExportTireMeasurementDto(x.Position, x.PressureBar, x.TreadDepthMm)).ToList())).ToList(),
                    rotations[m.Id].Select(r => new ExportTireRotationDto(r.Date, r.OdometerKm, r.Notes)).ToList())).ToList())).ToList());
    }

    /// <summary>Removes LRM, RLM and the isolates (U+2066 to U+2069) the Hebrew to-do prefill adds (decisions.md "Direction marks in the to-do prefill").</summary>
    public static string? StripDirectionMarks(string? text) =>
        text is null ? null : string.Concat(text.Where(c => c is not ('\u200E' or '\u200F' or (>= '\u2066' and <= '\u2069'))));
}
