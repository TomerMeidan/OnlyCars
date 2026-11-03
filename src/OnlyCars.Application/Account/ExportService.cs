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
    // 2 (TIRE-2): tireSets gave way to tires and rotations per car.
    public const int FormatVersion = 2;

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

        var tires = (await db.Tires.AsNoTracking().Where(t => t.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(t => t.FittedAt).ThenBy(t => t.Position).ThenBy(t => t.CreatedAt).ThenBy(t => t.Id).ToLookup(t => t.VehicleId);
        var measurements = (await db.TireMeasurements.AsNoTracking().Where(m => m.Tire!.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(m => m.MeasuredAt).ThenBy(m => m.Id).ToLookup(m => m.TireId);
        var rotations = (await db.TireRotations.AsNoTracking().Where(r => r.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(r => r.Date).ThenBy(r => r.CreatedAt).ThenBy(r => r.Id).ToLookup(r => r.VehicleId);
        var moves = (await db.TireRotationMoves.AsNoTracking().Where(m => m.TireRotation!.Vehicle!.UserId == userId).ToListAsync(ct))
            .OrderBy(m => m.FromPosition).ThenBy(m => m.Id).ToLookup(m => m.TireRotationId);

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
                documents[v.Id].Select(d => new ExportDocumentDto(d.Id, d.Type, d.ExpiryDate, d.Cost, d.Notes)).ToList(),
                tires[v.Id].Select(t => new ExportTireDto(t.Id, t.Position, t.Brand, t.Model, t.Size, t.Season, t.DotCode, t.PurchaseDate,
                    t.FittedAt, t.FittedOdometerKm, t.RemovedAt, t.RemovedOdometerKm,
                    Math.Max(0, (t.RemovedOdometerKm ?? v.CurrentOdometerKm) - t.FittedOdometerKm), t.Notes, t.ServiceRecordId,
                    measurements[t.Id].Select(m => new ExportTireMeasurementDto(m.MeasuredAt, m.Position, m.PressureBar, m.TreadDepthMm)).ToList()))
                    .ToList(),
                rotations[v.Id].Select(r => new ExportTireRotationDto(r.Id, r.Date, r.OdometerKm, r.Notes,
                    moves[r.Id].Select(m => new ExportTireRotationMoveDto(m.TireId, m.FromPosition, m.ToPosition)).ToList())).ToList())).ToList(),
            templates.Select(t => new ExportChecklistTemplateDto(t.Id, t.Name,
                templateItems[t.Id].Select(i => new ExportTemplateItemDto(i.Id, i.Label, i.Type, i.Unit, i.MinValue, i.MaxValue, i.SortOrder))
                    .ToList())).ToList());
    }

    /// <summary>Removes LRM, RLM and the isolates (U+2066 to U+2069) the Hebrew to-do prefill adds (decisions.md "Direction marks in the to-do prefill").</summary>
    public static string? StripDirectionMarks(string? text) =>
        text is null ? null : string.Concat(text.Where(c => c is not ('\u200E' or '\u200F' or (>= '\u2066' and <= '\u2069'))));
}
