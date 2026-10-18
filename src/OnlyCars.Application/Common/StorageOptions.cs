namespace OnlyCars.Application.Common;

/// <summary>Bound from the "Storage" config section. Defaults are the production limits (decisions.md, FILE-2).</summary>
public class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>Total stored bytes of one user's service record files and run photos (1 GiB); an upload past it is 400 <c>file.quotaExceeded</c>.</summary>
    public long UserQuotaBytes { get; set; } = 1L << 30;
}
