using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>
/// A stored file of a service record (receipt photo, PDF) or of a checklist run (photo); exactly one parent is set (a check constraint).
/// FileUrl holds the storage key; clients only get a signed URL.
/// </summary>
public class Attachment : Entity
{
    public const int MaxFileNameLength = 255;
    public const int MaxPerParent = 10;

    public Guid? ServiceRecordId { get; set; }
    public ServiceRecord? ServiceRecord { get; set; }

    public Guid? ChecklistRunId { get; set; }
    public ChecklistRun? ChecklistRun { get; set; }

    public string FileUrl { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;

    /// <summary>The type detected from the content, never the request header.</summary>
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
}
