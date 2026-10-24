using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;

namespace OnlyCars.Infrastructure.Storage;

/// <summary>
/// The owner's <c>sweep-orphans</c> command: files of users that no longer exist (decisions.md, "Orphan R2 sweep, LOW-10").
/// A dry run unless <c>--delete</c>; returns the process exit code and deletes nothing on any error.
/// </summary>
public static class OrphanSweep
{
    public static async Task<int> RunAsync(IFileStorage? storage, IAppDbContext db, string[] args, TextWriter output,
        CancellationToken ct = default)
    {
        if (args.Except(["--delete", "--force"]).FirstOrDefault() is { } unknown)
        {
            return Fail(output, $"unknown option '{unknown}'. Options: --delete, --force.");
        }

        if (storage is null)
        {
            return Fail(output, "file storage is not configured (R2 settings missing).");
        }

        // Prefixes before users: a user who signs up during the run is then in the user list, never an orphan.
        List<string> prefixes;
        try
        {
            prefixes = (await storage.ListUserPrefixesAsync(ct)).Where(R2FileStorage.IsUserPrefix).Distinct().ToList();
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // e.Message is printed here and below because the sweep writes to the owner's own console, not to app logs (L210).
            return Fail(output, $"storage can't be listed ({e.GetType().Name}: {e.Message}).");
        }

        HashSet<Guid> users;
        try
        {
            users = (await db.Users.Select(u => u.Id).ToListAsync(ct)).ToHashSet();
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return Fail(output, $"the database can't be reached ({e.GetType().Name}: {e.Message}).");
        }

        if (users.Count == 0)
        {
            return Fail(output, "the database has 0 users. Is the connection string right?");
        }

        var orphans = prefixes.Where(p => !users.Contains(Guid.Parse(p[6..42]))).ToList();
        if (orphans.Count * 2 > prefixes.Count && !args.Contains("--force"))
        {
            return Fail(output, $"{orphans.Count} of {prefixes.Count} prefixes are orphans, more than half. " +
                "Check the connection string, then run again with --force.");
        }

        var objects = 0;
        try
        {
            foreach (var orphan in orphans)
            {
                var count = await storage.CountObjectsAsync(orphan, ct);
                objects += count;
                output.WriteLine($"{orphan}  {count} objects");
            }
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return Fail(output, $"storage can't be counted ({e.GetType().Name}: {e.Message}).");
        }

        output.WriteLine($"{orphans.Count} orphan prefixes of {prefixes.Count}, {objects} objects, {users.Count} users.");
        if (!args.Contains("--delete"))
        {
            output.WriteLine("Dry run: nothing deleted. Run again with --delete to delete them.");
            return 0;
        }

        var deleted = 0;
        foreach (var orphan in orphans)
        {
            try
            {
                await storage.DeletePrefixAsync(orphan, ct);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Not Fail: some prefixes may already be gone, so "nothing deleted" would be false.
                output.WriteLine($"sweep-orphans stopped after deleting {deleted} of {orphans.Count} prefixes: " +
                    $"{orphan} failed ({e.GetType().Name}: {e.Message}). Run again to retry the rest.");
                return 1;
            }

            deleted++;
            output.WriteLine($"Deleted {orphan}");
        }

        output.WriteLine($"Deleted {orphans.Count} orphan prefixes.");
        return 0;
    }

    private static int Fail(TextWriter output, string message)
    {
        output.WriteLine($"sweep-orphans stopped, nothing deleted: {message}");
        return 1;
    }
}
