using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A stored file (receipt photo, PDF) of a service record. FileUrl holds the storage key; clients only get a signed URL.</summary>
public class Attachment : Entity
{
    public const int MaxFileNameLength = 255;
    public const int MaxPerServiceRecord = 10;

    /// <summary>Nullable as in Part 2 (ChecklistRunId comes with FILE-3); always set today.</summary>
    public Guid? ServiceRecordId { get; set; }
    public ServiceRecord? ServiceRecord { get; set; }

    public string FileUrl { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;

    /// <summary>The type detected from the content, never the request header.</summary>
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
}
