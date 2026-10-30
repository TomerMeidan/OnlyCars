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

        await using (var transaction = await db.Database.BeginTransactionAsync(ct))
        {
            // X-locks the user's runs first, so a racing run-photo save waits for the commit, then fails its run key or token: 409 (L173).
            // A save that inserted its row before blocking deadlocks with the deletes below; it, not the delete, is the victim (also 409).
            // The pool resets the priority when the connection is reused.
            await db.Database.ExecuteSqlRawAsync("SET DEADLOCK_PRIORITY HIGH", ct);
            await db.ChecklistRuns.Where(r => r.VehicleChecklist!.Vehicle!.UserId == userId)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.UpdatedAt, DateTimeOffset.UtcNow), ct);
            // Run photos next: their ChecklistRunId is NoAction, so the user's cascade would stop at them.
            await db.Attachments.Where(a => a.ChecklistRun!.VehicleChecklist!.Vehicle!.UserId == userId).ExecuteDeleteAsync(ct);
            await db.Users.Where(u => u.Id == userId).ExecuteDeleteAsync(ct);
            await transaction.CommitAsync(ct);
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
