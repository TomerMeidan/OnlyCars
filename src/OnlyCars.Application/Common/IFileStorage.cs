namespace OnlyCars.Application.Common;

/// <summary>Private object storage (R2). Not registered when the R2 settings are missing; callers then answer 503 <c>file.storageUnavailable</c>.</summary>
public interface IFileStorage
{
    Task PutAsync(string key, byte[] content, string contentType, CancellationToken ct = default);

    /// <summary>A read stream of one stored object (EXP-1a), or null when no object has that key; the caller disposes it.</summary>
    Task<Stream?> OpenReadAsync(string key, CancellationToken ct = default);

    Task DeleteAsync(string key, CancellationToken ct = default);

    /// <summary>Deletes every object under <paramref name="prefix"/>, which must be exactly <c>users/{guid}/</c> (ACC-2); anything else throws <see cref="ArgumentException"/>.</summary>
    Task DeletePrefixAsync(string prefix, CancellationToken ct = default);

    /// <summary>Every top-level prefix that is exactly <c>users/{guid}/</c>; anything else under <c>users/</c> is left out (LOW-10 sweep).</summary>
    Task<IReadOnlyList<string>> ListUserPrefixesAsync(CancellationToken ct = default);

    /// <summary>The number of objects under <paramref name="prefix"/>, which must be exactly <c>users/{guid}/</c>.</summary>
    Task<int> CountObjectsAsync(string prefix, CancellationToken ct = default);

    /// <summary>
    /// A GET URL for <paramref name="key"/> that expires after <paramref name="validFor"/>; computed locally, no network call.
    /// When given, the response carries <paramref name="contentType"/> and <paramref name="contentDisposition"/> as its headers.
    /// </summary>
    string GetSignedUrl(string key, TimeSpan validFor, string? contentType = null, string? contentDisposition = null);
}
