using System.Linq.Expressions;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Common;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Common;

/// <summary>
/// The files of service records (FILE-2), checklist runs (FILE-3) and vehicle documents (SCAN-2a), on the storage FILE-1 built: upload checks, the per-user quota,
/// keys, signed URLs and deletes. Each parent's service finds the caller's parent; this does the rest.
/// </summary>
public class AttachmentFiles(IAppDbContext db, VehicleService vehicleService, IOptions<StorageOptions>? storageOptions = null)
{
    public const int MaxBytes = 10 * 1024 * 1024;

    private static readonly Dictionary<string, string> TypeByExtension = new()
    {
        ["jpg"] = "image/jpeg", ["png"] = "image/png", ["webp"] = "image/webp", ["pdf"] = "application/pdf"
    };

    public static PayloadTooLargeException TooLarge() =>
        new("file.tooLarge", "The file must be 10 MB or smaller.") { Extensions = { ["maxBytes"] = MaxBytes } };

    public static string ServiceRecordPrefix(Guid userId, Guid vehicleId, Guid recordId) =>
        $"users/{userId}/vehicles/{vehicleId}/service-records/{recordId}/";

    public static string RunPrefix(Guid userId, Guid vehicleId, Guid runId) => $"users/{userId}/vehicles/{vehicleId}/checklist-runs/{runId}/";

    public static string DocumentPrefix(Guid userId, Guid vehicleId, Guid documentId) =>
        $"users/{userId}/vehicles/{vehicleId}/documents/{documentId}/";

    /// <summary>The user's files through any parent: the one filter of the quota, the export and the ZIP, so none misses a parent.</summary>
    public static Expression<Func<Attachment, bool>> OwnedBy(Guid userId) => a =>
        a.ServiceRecord!.Vehicle!.UserId == userId || a.ChecklistRun!.VehicleChecklist!.Vehicle!.UserId == userId
        || a.VehicleDocument!.Vehicle!.UserId == userId;

    /// <summary>
    /// Checks in the order of the FILE-2 contract (archived, count, file, size, type, quota), stores the file under <paramref name="prefix"/>,
    /// then saves the row in <paramref name="attachments"/> with the parent's UpdatedAt moved; that is the parent's concurrency token, so a
    /// delete or another upload that saved since the parent was read fails this save (409 concurrency.conflict). Any failed save deletes the object.
    /// </summary>
    public async Task AddAsync(Guid userId, Vehicle vehicle, Entity parent, ICollection<Attachment> attachments, string prefix,
        byte[]? content, string? fileName, bool photosOnly, CancellationToken ct, string? fallbackName = null)
    {
        var files = vehicleService.Storage();
        if (vehicle.IsArchived)
        {
            throw new ValidationFailedException("attachment.vehicleArchived", "This car is archived.");
        }

        if (attachments.Count >= Attachment.MaxPerParent)
        {
            throw new ValidationFailedException("attachment.tooMany", $"Up to {Attachment.MaxPerParent} files can be added here.")
            {
                Extensions = { ["maxCount"] = Attachment.MaxPerParent }
            };
        }

        if (content is not { Length: > 0 })
        {
            throw new ValidationFailedException("file.required", "Choose a file to upload.");
        }

        if (content.Length > MaxBytes)
        {
            throw TooLarge();
        }

        var (stored, extension, contentType) = StoredFile(content, photosOnly);

        // shortcut: two simultaneous uploads to different parents can both pass just under the quota (at most 2 x 10 MB over); fine for a cost guard.
        var quota = storageOptions?.Value.UserQuotaBytes ?? new StorageOptions().UserQuotaBytes;
        if (await UsedBytesAsync(userId, ct) + stored.Length > quota)
        {
            throw new ValidationFailedException("file.quotaExceeded", "Your files have used all the storage space. Delete some to add more.")
            {
                Extensions = { ["maxBytes"] = quota }
            };
        }

        var key = $"{prefix}{Guid.NewGuid():N}.{extension}";
        await files.PutAsync(key, stored, contentType, ct);

        var row = new Attachment
        {
            FileUrl = key,
            FileName = CleanFileName(fileName, extension, fallbackName ?? (photosOnly ? "photo" : "receipt")),
            ContentType = contentType,
            SizeBytes = stored.Length
        };
        attachments.Add(row);
        db.Attachments.Add(row); // explicitly Added: a client-generated Guid found only through the navigation would be taken as an existing row
        parent.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (Exception e)
        {
            await vehicleService.DeleteQuietlyAsync(key);
            // A run or document deleted meanwhile fails the new row's foreign key before the token check: the same 409 concurrency.conflict.
            // (Service records are voided, not deleted, so theirs is always the token check.)
            // A save that lost a deadlock (to the account delete, L173) is a conflict too; any other save error stays a 500 (L183).
            if (IsLockConflict(e)
                || e is DbUpdateException and not DbUpdateConcurrencyException && parent switch
                {
                    ChecklistRun => !await db.ChecklistRuns.AnyAsync(r => r.Id == parent.Id, CancellationToken.None),
                    VehicleDocument => !await db.VehicleDocuments.AnyAsync(d => d.Id == parent.Id, CancellationToken.None),
                    _ => false
                })
            {
                throw new DbUpdateConcurrencyException("The parent was deleted during the upload.", e);
            }

            throw;
        }
    }

    /// <summary>SQL Server 1205 (deadlock victim) or 1222 (lock time-out) at the root of the save error, however EF wrapped it.</summary>
    // The number is read by name so Application needs no SqlClient reference.
    private static bool IsLockConflict(Exception e) =>
        e.GetBaseException() is System.Data.Common.DbException sql && sql.GetType().GetProperty("Number")?.GetValue(sql) is 1205 or 1222;

    /// <summary>Every stored attachment of the user, through any parent (deleted parents' rows go with them, so every row counts).</summary>
    private Task<long> UsedBytesAsync(Guid userId, CancellationToken ct) => db.Attachments.Where(OwnedBy(userId)).SumAsync(a => a.SizeBytes, ct);

    /// <summary>Deletes the objects of rows already deleted (a failed object delete is logged).</summary>
    public async Task DeleteObjectsAsync(IEnumerable<Attachment> deleted, string prefix)
    {
        foreach (var a in deleted)
        {
            await vehicleService.DeleteQuietlyAsync(Key(a, prefix));
        }
    }

    /// <summary>Oldest first (upload order).</summary>
    public List<AttachmentDto> ToDtos(IEnumerable<Attachment> attachments, string prefix) =>
        attachments.OrderBy(a => a.CreatedAt).ThenBy(a => a.Id).Select(a => new AttachmentDto(a.Id, a.FileName, a.ContentType, a.SizeBytes, SignedUrl(a, prefix))).ToList();

    // Inline, with the stored name (RFC 6266 filename*) and the type its checked key implies.
    private string? SignedUrl(Attachment a, string prefix) =>
        Key(a, prefix) is { } key && vehicleService.Files is { } files
            ? files.GetSignedUrl(key, TimeSpan.FromHours(1), TypeByExtension[Path.GetExtension(key)[1..]],
                $"inline; filename*=UTF-8''{Uri.EscapeDataString(a.FileName)}")
            : null;

    /// <summary>The stored key, or null unless it is one AddAsync writes under <paramref name="prefix"/>, so a bad row never signs or deletes another object.</summary>
    private static string? Key(Attachment a, string prefix) =>
        a.FileUrl.StartsWith(prefix, StringComparison.Ordinal)
        && Regex.IsMatch(a.FileUrl.AsSpan(prefix.Length), @"^[0-9a-f]{32}\.(jpg|png|webp|pdf)\z")
            ? a.FileUrl
            : null;

    /// <summary>
    /// JPEG, PNG and WebP without metadata, or (unless <paramref name="photosOnly"/>) a PDF by its <c>%PDF-</c> header as sent;
    /// anything else 400 <c>file.unsupportedType</c>.
    /// </summary>
    private static (byte[] Content, string Extension, string ContentType) StoredFile(byte[] content, bool photosOnly)
    {
        if (!photosOnly && content.AsSpan().StartsWith("%PDF-"u8))
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
            throw new ValidationFailedException("file.unsupportedType",
                photosOnly ? "The photo must be a JPEG, PNG or WebP image." : "The file must be a JPEG, PNG or WebP image, or a PDF.");
        }
    }

    // Control (Cc) and format (Cf: bidi, zero-width, U+FEFF) characters, which could make "gpj.exe" look like "exe.jpg",
    // plus the line and paragraph separators.
    private static readonly Regex Unsafe = new(@"[\p{Cc}\p{Cf}\u2028\u2029]");

    /// <summary>
    /// The last path segment without control or format characters (bidi, zero-width, U+FEFF) or line separators, trimmed, cut to 255 characters keeping its extension;
    /// <c>{fallback}.{extension}</c> when nothing is left.
    /// </summary>
    public static string CleanFileName(string? name, string extension, string fallback = "receipt")
    {
        var clean = Unsafe.Replace(name ?? "", "");
        clean = clean[(clean.LastIndexOfAny(['/', '\\']) + 1)..].Trim();
        if (clean.Length == 0)
        {
            return $"{fallback}.{extension}";
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
}
