using System.Buffers.Text;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Application.Account;

/// <summary>
/// One-time download links for the ZIP export (EXP-1a): a random token bound to one user, valid for <see cref="ValidFor"/>, gone on first use.
/// </summary>
// shortcut: held in this process's memory (decisions.md EXP-1), fine for one instance; move to a shared store if the API scales out.
public sealed class ExportLinks(TimeProvider? time = null)
{
    public static readonly TimeSpan ValidFor = TimeSpan.FromSeconds(60);

    private readonly TimeProvider clock = time ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, (Guid UserId, DateTimeOffset ExpiresAt)> links = new();

    public (string Token, DateTimeOffset ExpiresAt) Create(Guid userId)
    {
        var now = clock.GetUtcNow();
        foreach (var (old, link) in links)
        {
            if (link.ExpiresAt <= now)
            {
                links.TryRemove(old, out _); // unused links don't pile up
            }
        }

        var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        links[token] = (userId, now + ValidFor);
        return (token, now + ValidFor);
    }

    /// <summary>The link's user without using it up (the rate limiter's partition), or null.</summary>
    public Guid? Peek(string token) => links.TryGetValue(token, out var link) && link.ExpiresAt > clock.GetUtcNow() ? link.UserId : null;

    /// <summary>Uses the link up and returns its user; an unknown, used or expired link is 404 <c>export.linkExpired</c>.</summary>
    public Guid Take(string token) =>
        links.TryRemove(token, out var link) && link.ExpiresAt > clock.GetUtcNow()
            ? link.UserId
            : throw new LinkExpiredException("export.linkExpired", "This download link has expired. Start the export again.");
}
