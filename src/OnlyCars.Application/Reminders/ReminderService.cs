using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Reminders;

/// <summary>In-app reminders computed on read, and their snoozes (NOT-1, decisions.md "Reminders, NOT-1").</summary>
public class ReminderService(IAppDbContext db)
{
    private const string InvalidDate = "reminder.invalidDate";
    private static readonly int[] SnoozeDays = [1, 7, 30];

    /// <summary>
    /// Due tasks and checklists (the car page's status, server UTC date) and expiring documents (client's today, user's lead days)
    /// of active cars, minus snoozed ones; most severe first, then fewest days left (none last), car nickname, name.
    /// </summary>
    public async Task<RemindersDto> GetAsync(Guid userId, DateOnly? today, CancellationToken ct = default)
    {
        var day = DateRules.ClientToday(today, InvalidDate);
        var utcToday = DateOnly.FromDateTime(DateTime.UtcNow);
        var leadDays = await LeadDaysAsync(db, userId, ct);

        var cars = await db.Vehicles.Where(v => v.UserId == userId && !v.IsArchived).ToDictionaryAsync(v => v.Id, ct);
        var tasks = await db.MaintenanceTasks.Where(t => t.Vehicle!.UserId == userId && !t.Vehicle.IsArchived && t.IsEnabled).ToListAsync(ct);
        var checklists = await VehicleChecklistService.QueryAsync(db,
            c => c.Vehicle!.UserId == userId && !c.Vehicle.IsArchived && c.IsEnabled, ct);
        var documents = await db.VehicleDocuments.Where(d => d.Vehicle!.UserId == userId && !d.Vehicle.IsArchived).ToListAsync(ct);
        var snoozed = (await db.Notifications.Where(n => n.UserId == userId && n.SnoozedUntil > day)
            .Select(n => new { n.Kind, n.RefId }).ToListAsync(ct)).Select(n => (n.Kind, n.RefId)).ToHashSet();

        // Items come from separate queries; one whose car was archived in between is skipped, not a KeyNotFoundException (500).
        var due = new List<ReminderDto>();
        foreach (var t in tasks)
        {
            if (!cars.TryGetValue(t.VehicleId, out var car))
            {
                continue;
            }

            var s = TaskStatusCalculator.Compute(t, car.CurrentOdometerKm, utcToday);
            if (s.Status is DueStatus.DueSoon or DueStatus.Overdue)
            {
                due.Add(new(NotificationKind.Task, t.Id, car.Id, car.Nickname, t.Name, null, s.Status.ToString()!, null, s.RemainingKm, s.RemainingDays));
            }
        }

        // Disabled and manual-only checklists have a null status, so they never match.
        due.AddRange(checklists.Where(c => cars.ContainsKey(c.VehicleId) && c.Status is DueStatus.DueSoon or DueStatus.Overdue)
            .Select(c => new ReminderDto(NotificationKind.Checklist, c.Id, c.VehicleId, cars[c.VehicleId].Nickname, c.Name, null,
                c.Status.ToString()!, null, c.RemainingKm, c.RemainingDays)));

        due.AddRange(documents.Where(d => cars.ContainsKey(d.VehicleId)).Select(d => VehicleDocumentService.ToDto(d, day, leadDays))
            .Where(d => d.Status != DocumentStatus.Ok)
            .Select(d => new ReminderDto(NotificationKind.Document, d.Id, d.VehicleId, cars[d.VehicleId].Nickname, null, d.Type,
                d.Status.ToString(), d.ExpiryDate, null, d.DaysLeft)));

        var items = due.Where(r => !snoozed.Contains((r.Kind, r.RefId)))
            .OrderByDescending(r => r.Status is nameof(DueStatus.Overdue) or nameof(DocumentStatus.Expired))
            .ThenBy(r => r.RemainingDays is null)
            .ThenBy(r => r.RemainingDays)
            .ThenBy(r => r.VehicleNickname, StringComparer.InvariantCulture)
            .ThenBy(r => r.Name ?? r.DocumentType.ToString(), StringComparer.InvariantCulture)
            .ToList();

        // Counts hidden reminders only, so a snooze of a done, deleted or archived item isn't counted.
        return new(leadDays, due.Count - items.Count, items);
    }

    /// <summary>Hides the item until today + days; snoozing again moves the date. The item must be the user's, on an active car.</summary>
    public async Task<SnoozeDto> SnoozeAsync(Guid userId, SnoozeRequest request, CancellationToken ct = default)
    {
        var day = DateRules.ClientToday(request.Today, InvalidDate);
        if (!SnoozeDays.Contains(request.Days))
        {
            throw new ValidationFailedException("reminder.invalidSnooze", "Snooze for 1, 7 or 30 days.");
        }

        var kind = ParseKind(request.Kind) ?? throw NotFound(request.RefId);
        var vehicleId = await ActiveItemVehicleAsync(userId, kind, request.RefId, ct) ?? throw NotFound(request.RefId);

        var until = day.AddDays(request.Days);
        var row = await FindAsync(userId, kind, request.RefId, ct);
        var added = row is null;
        if (row is null)
        {
            row = new Notification { UserId = userId, Kind = kind, RefId = request.RefId };
            db.Notifications.Add(row);
        }

        Set(row);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (added)
        {
            // A simultaneous first snooze of this item won the unique index: move its date instead, once.
            db.Notifications.Remove(row); // detaches the failed insert
            row = await FindAsync(userId, kind, request.RefId, ct);
            if (row is null)
            {
                throw;
            }

            Set(row);
            await db.SaveChangesAsync(ct);
        }

        return new(kind, row.RefId, until);

        void Set(Notification n)
        {
            n.VehicleId = vehicleId;
            n.SnoozedUntil = until;
            n.UpdatedAt = DateTimeOffset.UtcNow;
        }
    }

    /// <summary>Undo. No snooze (or an unknown kind) is a no-op.</summary>
    public async Task UnsnoozeAsync(Guid userId, string? kind, Guid refId, CancellationToken ct = default)
    {
        if (ParseKind(kind) is { } k && await FindAsync(userId, k, refId, ct) is { } row)
        {
            db.Notifications.Remove(row);
            await db.SaveChangesAsync(ct);
        }
    }

    /// <summary>The user's InApp lead days, 30 without a rule.</summary>
    internal static async Task<int> LeadDaysAsync(IAppDbContext db, Guid userId, CancellationToken ct) =>
        await db.NotificationRules.Where(r => r.UserId == userId && r.Channel == NotificationChannel.InApp)
            .Select(r => (int?)r.LeadDays).FirstOrDefaultAsync(ct) ?? NotificationRule.DefaultLeadDays;

    /// <summary>Removes the item's snooze row (on delete, or a document's renewal); the caller saves.</summary>
    internal static async Task RemoveSnoozeAsync(IAppDbContext db, Guid userId, NotificationKind kind, Guid refId, CancellationToken ct) =>
        db.Notifications.RemoveRange(await db.Notifications.Where(n => n.UserId == userId && n.Kind == kind && n.RefId == refId).ToListAsync(ct));

    private static NotFoundException NotFound(Guid refId) => new("Reminder", refId);

    // Exact names only, as for the other enums in requests.
    private static NotificationKind? ParseKind(string? kind) =>
        kind is not null && Enum.GetNames<NotificationKind>().Contains(kind) ? Enum.Parse<NotificationKind>(kind) : null;

    private Task<Notification?> FindAsync(Guid userId, NotificationKind kind, Guid refId, CancellationToken ct) =>
        db.Notifications.FirstOrDefaultAsync(n => n.UserId == userId && n.Kind == kind && n.RefId == refId, ct);

    private Task<Guid?> ActiveItemVehicleAsync(Guid userId, NotificationKind kind, Guid refId, CancellationToken ct) => kind switch
    {
        NotificationKind.Task => db.MaintenanceTasks.Where(t => t.Id == refId && t.Vehicle!.UserId == userId && !t.Vehicle.IsArchived)
            .Select(t => (Guid?)t.VehicleId).FirstOrDefaultAsync(ct),
        NotificationKind.Checklist => db.VehicleChecklists.Where(c => c.Id == refId && c.Vehicle!.UserId == userId && !c.Vehicle.IsArchived)
            .Select(c => (Guid?)c.VehicleId).FirstOrDefaultAsync(ct),
        _ => db.VehicleDocuments.Where(d => d.Id == refId && d.Vehicle!.UserId == userId && !d.Vehicle.IsArchived)
            .Select(d => (Guid?)d.VehicleId).FirstOrDefaultAsync(ct)
    };
}
