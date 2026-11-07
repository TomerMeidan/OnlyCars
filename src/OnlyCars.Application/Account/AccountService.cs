using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Account;

/// <summary>Deletes an account for good (ACC-2, decisions.md "Delete account, ACC-2").</summary>
public class AccountService(IAppDbContext db, AuthService auth, IFileStorage? storage = null,
    ILogger<AccountService>? logger = null)
{
    public async Task DeleteAsync(Guid userId, string? password, CancellationToken ct = default, string? googleIdToken = null)
    {
        var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId, ct)
                   ?? throw new NotFoundException(nameof(User), userId);
        if (user.PasswordHash == string.Empty)
        {
            // An account made with Google has no password to confirm with: a fresh Google sign-in confirms instead.
            await auth.ConfirmWithGoogleAsync(user, googleIdToken, ct);
        }
        else if (string.IsNullOrEmpty(password))
        {
            throw new ValidationFailedException("auth.credentialsRequired", "Password is required.");
        }
        // Counts toward the login lockout (429 once locked out, ACC-2 security review); 400, not 401: the client signs out on 401.
        else if (!auth.VerifyPassword(user, password))
        {
            throw new ValidationFailedException("auth.invalidCredentials", "The password is not correct.");
        }

        try
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            // Locks the user's runs first, so a racing run-photo save waits at its foreign key for the commit, then fails it: 409 (L173).
            // FOR UPDATE, not an UPDATE: a plain update's lock lets that key check through, and the save and the delete would then deadlock.
            await db.Database.ExecuteSqlAsync($"""
                SELECT 1 FROM onlycars."ChecklistRuns" r
                JOIN onlycars."VehicleChecklists" c ON c."Id" = r."VehicleChecklistId"
                JOIN onlycars."Vehicles" v ON v."Id" = c."VehicleId"
                WHERE v."UserId" = {userId} FOR UPDATE OF r
                """, ct);
            // The documents too, for a racing document-file save (SCAN-2a).
            await db.Database.ExecuteSqlAsync($"""
                SELECT 1 FROM onlycars."VehicleDocuments" d
                JOIN onlycars."Vehicles" v ON v."Id" = d."VehicleId"
                WHERE v."UserId" = {userId} FOR UPDATE OF d
                """, ct);
            // Run photos and document files next: their parent links are NoAction, so the user's cascade would stop at them.
            await db.Attachments.Where(a => a.ChecklistRun!.VehicleChecklist!.Vehicle!.UserId == userId || a.VehicleDocument!.Vehicle!.UserId == userId)
                .ExecuteDeleteAsync(ct);
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync(ct);
            await transaction.CommitAsync(ct);
        }
        catch (Exception e) when (AttachmentFiles.IsLockConflict(e))
        {
            // Postgres has no deadlock priority, so the delete can be the victim. The whole transaction is gone, so asking again is safe.
            throw new ConflictException("concurrency.conflict", "This was changed at the same time somewhere else. Reload and try again.");
        }

        // Listed by prefix, so files the database never recorded (an upload cut off midway) go too.
        var prefix = $"users/{userId}/";
        if (storage is null)
        {
            logger?.LogWarning("Account {UserId} deleted without file storage configured; objects under {Prefix} are left for a later sweep.",
                userId, prefix);
            return;
        }

        try
        {
            await storage.DeletePrefixAsync(prefix, CancellationToken.None); // the account is gone: finish even if the client left
        }
        catch (Exception ex)
        {
            // The type only: storage messages may name object keys.
            logger?.LogError("Account {UserId} deleted but its files were not ({Error}); objects under {Prefix} are left for a later sweep.",
                userId, ex.GetType().Name, prefix);
        }
    }
}
