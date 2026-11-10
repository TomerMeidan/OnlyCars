using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Devices.Dtos;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Devices;

/// <summary>
/// Device tokens (OBD-1): made and revoked by the signed-in user in Settings, and accepted only by the device endpoints
/// (list cars, add an odometer reading). A token has no expiry, because the adapter app runs unattended; revoking ends it.
/// </summary>
public class DeviceTokenService(IAppDbContext db)
{
    public const int MaxPerUser = 5;
    public const int MaxNameLength = 60;
    /// <summary>Marks a device token, so it is never mistaken for a sign-in token (a JWT) and is easy to spot in a leak.</summary>
    public const string Prefix = "ocd_";

    // Last use is for the Settings list, so an hour's precision is enough and saves a write on most requests.
    private static readonly TimeSpan LastUsedStep = TimeSpan.FromHours(1);

    public async Task<List<DeviceTokenDto>> ListAsync(Guid userId, CancellationToken ct = default)
    {
        var tokens = await db.DeviceTokens.AsNoTracking().Where(t => t.UserId == userId).ToListAsync(ct);
        return tokens.OrderBy(t => t.CreatedAt).Select(t => new DeviceTokenDto(t.Id, t.Name, t.CreatedAt, t.LastUsedAt)).ToList();
    }

    public async Task<CreatedDeviceTokenDto> CreateAsync(Guid userId, CreateDeviceTokenRequest request, CancellationToken ct = default)
    {
        var name = request.Name?.Trim() ?? string.Empty;
        if (name.Length is 0 or > MaxNameLength)
        {
            throw new ValidationFailedException("deviceToken.invalidName", $"A device name is required, up to {MaxNameLength} characters.");
        }

        // shortcut: two simultaneous creates at the cap can both pass; harmless.
        if (await db.DeviceTokens.CountAsync(t => t.UserId == userId, ct) >= MaxPerUser)
        {
            throw new ValidationFailedException("deviceToken.tooMany", $"An account can have up to {MaxPerUser} devices. Remove one first.")
            {
                Extensions = { ["max"] = MaxPerUser }
            };
        }

        // 256 random bits: unguessable, so a plain SHA-256 is enough to store it (no salt or slow hash needed).
        var token = Prefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var entity = new DeviceToken { UserId = userId, Name = name, TokenHash = Hash(token) };
        db.DeviceTokens.Add(entity);
        await db.SaveChangesAsync(ct);

        return new CreatedDeviceTokenDto(entity.Id, entity.Name, entity.CreatedAt, token);
    }

    public async Task RevokeAsync(Guid userId, Guid tokenId, CancellationToken ct = default)
    {
        var token = await db.DeviceTokens.FirstOrDefaultAsync(t => t.Id == tokenId && t.UserId == userId, ct)
                    ?? throw new NotFoundException(nameof(DeviceToken), tokenId);
        db.DeviceTokens.Remove(token);
        await db.SaveChangesAsync(ct);
    }

    /// <summary>The user a device token belongs to, or null for anything else (a sign-in token, a revoked or made-up token).</summary>
    public async Task<Guid?> AuthenticateAsync(string? token, CancellationToken ct = default)
    {
        if (token is null || token.Length > 100 || !token.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return null;
        }

        var hash = Hash(token);
        var found = await db.DeviceTokens.FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (found is null)
        {
            return null;
        }

        var now = DateTimeOffset.UtcNow;
        if (found.LastUsedAt is null || now - found.LastUsedAt > LastUsedStep)
        {
            found.LastUsedAt = now;
            await db.SaveChangesAsync(ct);
        }

        return found.UserId;
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
