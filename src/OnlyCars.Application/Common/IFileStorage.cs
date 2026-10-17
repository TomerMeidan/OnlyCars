namespace OnlyCars.Application.Common;

/// <summary>Private object storage (R2). Not registered when the R2 settings are missing; callers then answer 503 <c>file.storageUnavailable</c>.</summary>
public interface IFileStorage
{
    Task PutAsync(string key, byte[] content, string contentType, CancellationToken ct = default);

    Task DeleteAsync(string key, CancellationToken ct = default);

    /// <summary>A GET URL for <paramref name="key"/> that expires after <paramref name="validFor"/>; computed locally, no network call.</summary>
    string GetSignedUrl(string key, TimeSpan validFor);
}
