using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Reminders;

/// <summary>A car's expiring documents (NOT-1, decisions.md "Reminders, NOT-1") and their files (SCAN-2a).</summary>
public class VehicleDocumentService(IAppDbContext db, VehicleService vehicleService, IOptions<StorageOptions>? storageOptions = null)
{
    private const string InvalidDate = "vehicleDocument.invalidDate";
    private readonly AttachmentFiles attachmentFiles = new(db, vehicleService, storageOptions);

    /// <summary>Sorted by expiry date, then type. Allowed on an archived car.</summary>
    public async Task<List<VehicleDocumentDto>> ListAsync(Guid userId, Guid vehicleId, DateOnly? today, CancellationToken ct = default)
    {
        var day = DateRules.ClientToday(today, InvalidDate);
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var leadDays = await ReminderService.LeadDaysAsync(db, userId, ct);
        var documents = await db.VehicleDocuments.Include(d => d.Attachments).Where(d => d.VehicleId == vehicleId)
            .OrderBy(d => d.ExpiryDate).ThenBy(d => d.Type).AsSplitQuery().ToListAsync(ct);
        return documents.Select(d => ToDto(d, day, leadDays, userId)).ToList();
    }

    public async Task<VehicleDocumentDto> CreateAsync(Guid userId, Guid vehicleId, VehicleDocumentRequest request, DateOnly? today,
        CancellationToken ct = default)
    {
        var day = DateRules.ClientToday(today, InvalidDate);
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        EnsureActive(vehicle);
        var document = new VehicleDocument { VehicleId = vehicle.Id };
        Apply(document, request);

        // shortcut: two simultaneous creates at 49 can both pass and make 51; harmless, add a lock if the limit ever matters.
        if (await db.VehicleDocuments.CountAsync(d => d.VehicleId == vehicle.Id, ct) >= VehicleDocument.MaxPerVehicle)
        {
            throw new ValidationFailedException("vehicleDocument.tooMany", $"A car can have up to {VehicleDocument.MaxPerVehicle} documents.")
            {
                Extensions = { ["max"] = VehicleDocument.MaxPerVehicle }
            };
        }

        db.VehicleDocuments.Add(document);
        await db.SaveChangesAsync(ct);
        return ToDto(document, day, await ReminderService.LeadDaysAsync(db, userId, ct), userId);
    }

    public async Task<VehicleDocumentDto> UpdateAsync(Guid userId, Guid vehicleId, Guid id, VehicleDocumentRequest request, DateOnly? today,
        CancellationToken ct = default)
    {
        var day = DateRules.ClientToday(today, InvalidDate);
        var document = await FindOwnedAsync(userId, vehicleId, id, ct);
        var oldExpiry = document.ExpiryDate;
        Apply(document, request);
        if (document.ExpiryDate != oldExpiry)
        {
            // A renewal: an old snooze must not hide the new expiry.
            await ReminderService.RemoveSnoozeAsync(db, userId, NotificationKind.Document, id, ct);
        }

        document.UpdatedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);
        return ToDto(document, day, await ReminderService.LeadDaysAsync(db, userId, ct), userId);
    }

    /// <summary>
    /// Also deletes the document's snooze row and its file rows in the same save, then the stored objects (a failed object delete is logged).
    /// The token makes a file saved since the read a 409, so no file row is left without its document.
    /// </summary>
    public async Task DeleteAsync(Guid userId, Guid vehicleId, Guid id, CancellationToken ct = default)
    {
        var document = await FindOwnedAsync(userId, vehicleId, id, ct);
        await ReminderService.RemoveSnoozeAsync(db, userId, NotificationKind.Document, id, ct);
        var files = document.Attachments.ToList();
        db.Attachments.RemoveRange(files);
        db.VehicleDocuments.Remove(document);
        await db.SaveChangesAsync(ct);
        await attachmentFiles.DeleteObjectsAsync(files, AttachmentFiles.DocumentPrefix(userId, vehicleId, id));
    }

    /// <summary>
    /// Stores the file under the document's prefix and adds the row (FILE-2's checks, order and codes, with vehicleDocument.notFound);
    /// refused on an archived car (attachment.vehicleArchived). Returns the document with its files.
    /// </summary>
    public async Task<VehicleDocumentDto> AddAttachmentAsync(Guid userId, Guid vehicleId, Guid id, byte[]? content, string? fileName, DateOnly? today,
        CancellationToken ct = default)
    {
        var day = DateRules.ClientToday(today, InvalidDate);
        vehicleService.Storage(); // keeps 503 file.storageUnavailable ahead of 404
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var document = await db.VehicleDocuments.Include(d => d.Attachments).FirstOrDefaultAsync(d => d.Id == id && d.VehicleId == vehicle.Id, ct)
                       ?? throw new NotFoundException(nameof(VehicleDocument), id);

        await attachmentFiles.AddAsync(userId, vehicle, document, document.Attachments, AttachmentFiles.DocumentPrefix(userId, vehicle.Id, document.Id),
            content, fileName, photosOnly: false, ct, fallbackName: "document");
        return ToDto(document, day, await ReminderService.LeadDaysAsync(db, userId, ct), userId);
    }

    /// <summary>Deletes the row, then the object (a failed object delete is logged). Allowed on an archived car.</summary>
    public async Task DeleteAttachmentAsync(Guid userId, Guid vehicleId, Guid id, Guid attachmentId, CancellationToken ct = default)
    {
        vehicleService.Storage(); // keeps 503 file.storageUnavailable ahead of 404
        // One scoped lookup: another user's car or document, or a mismatched path, is the same 404.
        var attachment = await db.Attachments.FirstOrDefaultAsync(a => a.Id == attachmentId && a.VehicleDocumentId == id
                             && a.VehicleDocument!.VehicleId == vehicleId && a.VehicleDocument.Vehicle!.UserId == userId, ct)
                         ?? throw new NotFoundException(nameof(Attachment), attachmentId);

        db.Attachments.Remove(attachment);
        await db.SaveChangesAsync(ct);
        await attachmentFiles.DeleteObjectsAsync([attachment], AttachmentFiles.DocumentPrefix(userId, vehicleId, id));
    }

    /// <summary>Expired before today; Expiring from today up to today + leadDays; else Ok.</summary>
    internal static DocumentStatus StatusOf(DateOnly expiryDate, DateOnly today, int leadDays) =>
        expiryDate < today ? DocumentStatus.Expired
        : expiryDate.DayNumber - today.DayNumber <= leadDays ? DocumentStatus.Expiring
        : DocumentStatus.Ok;

    // Without the files (the reminders list, which shows none) the attachments are empty.
    internal static VehicleDocumentDto ToDto(VehicleDocument d, DateOnly today, int leadDays, List<AttachmentDto>? attachments = null) =>
        new(d.Id, d.VehicleId, d.Type, d.ExpiryDate, d.Cost, d.Notes, StatusOf(d.ExpiryDate, today, leadDays), d.ExpiryDate.DayNumber - today.DayNumber,
            attachments ?? []);

    private VehicleDocumentDto ToDto(VehicleDocument d, DateOnly today, int leadDays, Guid userId) =>
        ToDto(d, today, leadDays, attachmentFiles.ToDtos(d.Attachments, AttachmentFiles.DocumentPrefix(userId, d.VehicleId, d.Id)));

    // Validates every field before writing any, so one bad field changes nothing.
    private static void Apply(VehicleDocument document, VehicleDocumentRequest request)
    {
        var type = EnumRules.Parse<VehicleDocumentType>(request.Type, "vehicleDocument.invalidType")
            ?? throw new ValidationFailedException("vehicleDocument.invalidType", "Choose a document type.");

        if (request.ExpiryDate is not { } expiry)
        {
            throw new ValidationFailedException("vehicleDocument.invalidExpiryDate", "The expiry date is required.");
        }

        DateRules.RejectTooEarly(expiry);
        DateRules.RejectTooLate(expiry);

        if (request.Cost is { } c && (c < 0 || c > ServiceRecord.MaxCost || decimal.Round(c, 2) != c))
        {
            throw new ValidationFailedException("vehicleDocument.invalidCost", $"The cost must be 0 to {ServiceRecord.MaxCost} with at most 2 decimals.");
        }

        var notes = request.Notes?.Trim() is { Length: > 0 } n ? n : null;
        if (notes?.Length > VehicleDocument.MaxNotesLength)
        {
            throw new ValidationFailedException("vehicleDocument.invalidNotes", $"Notes can be up to {VehicleDocument.MaxNotesLength} characters.");
        }

        (document.Type, document.ExpiryDate, document.Cost, document.Notes) = (type, expiry, request.Cost, notes);
    }

    private static void EnsureActive(Vehicle vehicle)
    {
        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("vehicleDocument.vehicleArchived", "This car is archived.");
        }
    }

    // The car first (vehicle.notFound for another user's car), then the document on that car; archived cars are read-only.
    private async Task<VehicleDocument> FindOwnedAsync(Guid userId, Guid vehicleId, Guid id, CancellationToken ct)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var document = await db.VehicleDocuments.Include(d => d.Attachments).FirstOrDefaultAsync(d => d.Id == id && d.VehicleId == vehicle.Id, ct)
            ?? throw new NotFoundException(nameof(VehicleDocument), id);
        EnsureActive(vehicle);
        return document;
    }
}
