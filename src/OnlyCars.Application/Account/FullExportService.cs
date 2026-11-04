using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Account.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Application.Account;

/// <summary>
/// The full export as one ZIP (EXP-1a, decisions.md "Full export with files, EXP-1"): data.json, then every stored file, each read from
/// storage straight into the output one at a time, so memory doesn't grow with the files (Render's free plan has 512 MB).
/// </summary>
public class FullExportService(IAppDbContext db, ExportService exportService, ExportLinks links, IFileStorage? storage = null)
{
    public const int MaxNameLength = 80;

    /// <summary>A one-time link for <see cref="WriteZipAsync"/>; 503 <c>file.storageUnavailable</c> when there is no storage.</summary>
    public (string Token, DateTimeOffset ExpiresAt) CreateLink(Guid userId)
    {
        Storage();
        return links.Create(userId);
    }

    public async Task WriteZipAsync(Guid userId, Stream output, JsonSerializerOptions json, CancellationToken ct = default)
    {
        var files = Storage();
        var export = await exportService.ExportAsync(userId, ct);
        var photoKeys = await db.Vehicles.Where(v => v.UserId == userId && v.PhotoUrl != null).ToDictionaryAsync(v => v.Id, v => v.PhotoUrl!, ct);
        // The same filter as the export's file list.
        var fileKeys = await db.Attachments.Where(AttachmentFiles.OwnedBy(userId)).ToDictionaryAsync(a => a.Id, a => a.FileUrl, ct);

        // Every path first, since data.json (the first entry) lists them.
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase); // Windows and macOS see "Car" and "car" as one name
        var entries = new List<(string Path, string? Key)>();
        foreach (var car in export.Vehicles)
        {
            var name = SafeName(car.Nickname, false) ?? SafeName($"{car.Make} {car.Model}", false) ?? car.Id.ToString();
            var folder = Unique(used, "cars/", name, false) + "/";
            if (photoKeys.TryGetValue(car.Id, out var photo))
            {
                entries.Add((Unique(used, folder, SafeName("photo" + Path.GetExtension(photo), true)!, true), photo));
            }
            foreach (var record in car.ServiceRecords)
            {
                AddFiles(record.Attachments, $"{folder}services/{Folder(record.Date, record.Id)}/");
            }
            foreach (var run in car.Checklists.SelectMany(c => c.Runs))
            {
                AddFiles(run.Photos, $"{folder}checklist-runs/{Folder(run.RunAt, run.Id)}/");
            }
            foreach (var document in car.Documents)
            {
                AddFiles(document.Attachments, $"{folder}documents/{document.Type} {Folder(document.ExpiryDate, document.Id)}/");
            }
        }

        void AddFiles(List<ExportFileDto> list, string folder)
        {
            foreach (var file in list)
            {
                file.Path = Unique(used, folder, SafeName(file.FileName, true) ?? "file", true);
                entries.Add((file.Path, fileKeys.GetValueOrDefault(file.Id)));
            }
        }

        var missing = new StringBuilder();
        await using var zip = await ZipArchive.CreateAsync(output, ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: null, ct);
        await using (var data = await zip.CreateEntry("data.json").OpenAsync(ct))
        {
            await JsonSerializer.SerializeAsync(data, export, json, ct);
        }

        foreach (var (path, key) in entries)
        {
            Stream? source;
            try
            {
                // Only this user's keys, as the photo links check (VehicleService.SignedPhotoUrl).
                source = key is not null && key.StartsWith($"users/{userId}/", StringComparison.Ordinal) ? await files.OpenReadAsync(key, ct) : null;
            }
            // Only the user's own cancel stops the export; a storage timeout (TaskCanceledException) is just an unreadable file.
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                missing.AppendLine($"{path} - could not be read from storage");
                continue;
            }

            if (source is null)
            {
                missing.AppendLine($"{path} - not found in storage");
                continue;
            }

            await using (source)
            await using (var entry = await zip.CreateEntry(path, CompressionLevel.NoCompression).OpenAsync(ct)) // photos and PDFs are compressed already
            {
                await source.CopyToAsync(entry, ct);
            }
        }

        if (missing.Length > 0)
        {
            await using var entry = await zip.CreateEntry("missing-files.txt").OpenAsync(ct);
            await entry.WriteAsync(Encoding.UTF8.GetBytes(missing.ToString()), ct);
        }
    }

    private IFileStorage Storage() =>
        storage ?? throw new ServiceUnavailableException("file.storageUnavailable", "File storage is not configured.");

    private static string Folder(DateOnly date, Guid id) => $"{date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)} {id.ToString()[..8]}";

    /// <summary>
    /// A name every OS accepts, Hebrew kept: no <c>\ / : * ? " &lt; &gt; |</c>, control characters or <c>..</c>, no leading or trailing
    /// dot or space, at most <see cref="MaxNameLength"/> characters; null when nothing is left.
    /// </summary>
    public static string? SafeName(string? name, bool isFile)
    {
        var replaced = string.Concat((name ?? "").Select(c => char.IsControl(c) || @"\/:*?""<>|".Contains(c) ? '_' : c));
        var safe = Fit(Regex.Replace(replaced, @"\.{2,}", ".").Trim(' ', '.'), "", isFile);
        // Windows refuses CON, AUX, COM1... as a name or stem ("aux.pdf"), so they get a "_".
        safe = Regex.Replace(safe, @"^(CON|PRN|AUX|NUL|COM\d|LPT\d)(?=\.|$)", "$1_", RegexOptions.IgnoreCase);
        return safe.Length == 0 ? null : safe;
    }

    // " (2)", " (3)" for a name already in the folder, before a file's extension.
    private static string Unique(HashSet<string> used, string folder, string name, bool isFile)
    {
        var path = folder + name;
        for (var n = 2; !used.Add(path); n++)
        {
            path = folder + Fit(name, $" ({n})", isFile);
        }
        return path;
    }

    // Cuts the name, not a file's extension, so that the result with the suffix fits MaxNameLength.
    private static string Fit(string name, string suffix, bool isFile)
    {
        var extension = isFile && Path.GetExtension(name) is { Length: <= 10 } e ? e : "";
        var stem = name[..^extension.Length];
        var room = MaxNameLength - suffix.Length - extension.Length;
        if (stem.Length > room)
        {
            stem = stem[..(char.IsHighSurrogate(stem[room - 1]) ? room - 1 : room)].TrimEnd(' ', '.');
        }
        return stem + suffix + extension;
    }
}
