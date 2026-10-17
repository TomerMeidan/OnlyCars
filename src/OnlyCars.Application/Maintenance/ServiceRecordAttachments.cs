using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Maintenance;

/// <summary>Receipt files of service records (FILE-2, decisions.md "Attachments, FILE-2"), on the storage FILE-1 built.</summary>
public partial class MaintenanceTaskService
{
    public const int MaxAttachmentBytes = 10 * 1024 * 1024;

    private static readonly Dictionary<string, string> TypeByExtension = new()
    {
        ["jpg"] = "image/jpeg", ["png"] = "image/png", ["webp"] = "image/webp", ["pdf"] = "application/pdf"
    };

    public static PayloadTooLargeException AttachmentTooLarge() =>
        new("file.tooLarge", "The file must be 10 MB or smaller.") { Extensions = { ["maxBytes"] = MaxAttachmentBytes } };

    /// <summary>
    /// Stores the file (images without metadata, PDFs as sent) under the record's prefix, then adds the row; if the row can't
    /// be saved (a concurrency conflict included) the object is deleted. Checks in the order of the FILE-2 contract. Returns the record with its attachments.
    /// </summary>
    public async Task<ServiceRecordDto> AddAttachmentAsync(Guid userId, Guid vehicleId, Guid recordId, byte[]? content, string? fileName,
        CancellationToken ct = default)
    {
        var files = vehicleService.Storage();
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var record = await db.ServiceRecords
            .Include(r => r.Tasks).ThenInclude(j => j.MaintenanceTask)
            .Include(r => r.Items)
            .Include(r => r.Attachments)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == recordId && r.VehicleId == vehicle.Id && !r.IsVoided, ct)
            ?? throw new NotFoundException(nameof(ServiceRecord), recordId);

        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("attachment.vehicleArchived", "This car is archived.");
        }

        if (record.Attachments.Count >= Attachment.MaxPerServiceRecord)
        {
            throw new ValidationFailedException("attachment.tooMany", $"A service can have up to {Attachment.MaxPerServiceRecord} files.")
            {
                Extensions = { ["maxCount"] = Attachment.MaxPerServiceRecord }
            };
        }

        if (content is not { Length: > 0 })
        {
            throw new ValidationFailedException("file.required", "Choose a file to upload.");
        }

        if (content.Length > MaxAttachmentBytes)
        {
            throw AttachmentTooLarge();
        }

        var (stored, extension, contentType) = StoredFile(content);

        // Voided records' rows are deleted with the void, so every row counts.
        // shortcut: two simultaneous uploads to different records can both pass just under the quota (at most 2 x 10 MB over); fine for a cost guard.
        var quota = storageOptions?.Value.UserQuotaBytes ?? new StorageOptions().UserQuotaBytes;
        var used = await db.Attachments.Where(a => a.ServiceRecord!.Vehicle!.UserId == userId).SumAsync(a => a.SizeBytes, ct);
        if (used + stored.Length > quota)
        {
            throw new ValidationFailedException("file.quotaExceeded", "Your files have used all the storage space. Delete some to add more.")
            {
                Extensions = { ["maxBytes"] = quota }
            };
        }

        var key = $"users/{userId}/vehicles/{vehicle.Id}/service-records/{record.Id}/{Guid.NewGuid():N}.{extension}";
        await files.PutAsync(key, stored, contentType, ct);

        db.Attachments.Add(new Attachment
        {
            ServiceRecord = record,
            FileUrl = key,
            FileName = CleanFileName(fileName, extension),
            ContentType = contentType,
            SizeBytes = stored.Length
        });
        // UpdatedAt is the record's concurrency token: a void or another upload that saved since the read makes this save fail
        // (409 concurrency.conflict), so a voided record gets no file and the 10-file count holds.
        record.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            await vehicleService.DeleteQuietlyAsync(key);
            throw;
        }

        return ToDto(record, userId);
    }

    /// <summary>Deletes the row, then the object (a failed object delete is logged). Allowed on an archived car.</summary>
    public async Task DeleteAttachmentAsync(Guid userId, Guid vehicleId, Guid recordId, Guid attachmentId, CancellationToken ct = default)
    {
        vehicleService.Storage();
        // One scoped lookup: another user's car or record, or a mismatched path, is the same 404.
        var attachment = await db.Attachments.FirstOrDefaultAsync(a => a.Id == attachmentId && a.ServiceRecordId == recordId
                             && a.ServiceRecord!.VehicleId == vehicleId && a.ServiceRecord.Vehicle!.UserId == userId, ct)
                         ?? throw new NotFoundException(nameof(Attachment), attachmentId);

        db.Attachments.Remove(attachment);
        await db.SaveChangesAsync(ct);
        await vehicleService.DeleteQuietlyAsync(AttachmentKey(attachment, userId, vehicleId));
    }

    /// <summary>JPEG, PNG and WebP without metadata, or a PDF (by its <c>%PDF-</c> header) as sent; anything else 400 <c>file.unsupportedType</c>.</summary>
    private static (byte[] Content, string Extension, string ContentType) StoredFile(byte[] content)
    {
        if (content.AsSpan().StartsWith("%PDF-"u8))
        {
            return (content, "pdf", "application/pdf");
        }

        try
        {
            var image = ImageFiles.Clean(content);
            return (image.Content, image.Extension, image.ContentType);
        }
        catch (ValidationFailedException)
        {
            throw new ValidationFailedException("file.unsupportedType", "The file must be a JPEG, PNG or WebP image, or a PDF.");
        }
    }

    // Control (Cc) and format (Cf: bidi, zero-width, U+FEFF) characters, which could make "gpj.exe" look like "exe.jpg",
    // plus the line and paragraph separators.
    private static readonly Regex Unsafe = new(@"[\p{Cc}\p{Cf}\u2028\u2029]");

    /// <summary>
    /// The last path segment without control or format characters (bidi, zero-width, U+FEFF) or line separators, trimmed, cut to 255 characters keeping its extension;
    /// <c>receipt.{extension}</c> when nothing is left.
    /// </summary>
    public static string CleanFileName(string? name, string extension)
    {
        var clean = Unsafe.Replace(name ?? "", "");
        clean = clean[(clean.LastIndexOfAny(['/', '\\']) + 1)..].Trim();
        if (clean.Length == 0)
        {
            return $"receipt.{extension}";
        }

        if (clean.Length <= Attachment.MaxFileNameLength)
        {
            return clean;
        }

        var ext = Path.GetExtension(clean);
        if (ext.Length >= Attachment.MaxFileNameLength / 2)
        {
            ext = "";
        }

        var cut = Attachment.MaxFileNameLength - ext.Length;
        if (char.IsHighSurrogate(clean[cut - 1]))
        {
            cut--; // don't split a surrogate pair
        }

        return clean[..cut].TrimEnd() + ext;
    }

    private AttachmentDto ToDto(Attachment a, Guid userId, Guid vehicleId) =>
        new(a.Id, a.FileName, a.ContentType, a.SizeBytes, SignedUrl(a, userId, vehicleId));

    // Inline, with the stored name (RFC 6266 filename*) and the type its checked key implies.
    private string? SignedUrl(Attachment a, Guid userId, Guid vehicleId) =>
        AttachmentKey(a, userId, vehicleId) is { } key && vehicleService.Files is { } files
            ? files.GetSignedUrl(key, TimeSpan.FromHours(1), TypeByExtension[Path.GetExtension(key)[1..]],
                $"inline; filename*=UTF-8''{Uri.EscapeDataString(a.FileName)}")
            : null;

    /// <summary>The stored key, or null unless it is one AddAttachmentAsync writes for this record, so a bad row never signs or deletes another object.</summary>
    private static string? AttachmentKey(Attachment a, Guid userId, Guid vehicleId)
    {
        var prefix = $"users/{userId}/vehicles/{vehicleId}/service-records/{a.ServiceRecordId}/";
        return a.ServiceRecordId is not null && a.FileUrl.StartsWith(prefix, StringComparison.Ordinal)
                                             && Regex.IsMatch(a.FileUrl.AsSpan(prefix.Length), @"^[0-9a-f]{32}\.(jpg|png|webp|pdf)\z")
            ? a.FileUrl
            : null;
    }
}
