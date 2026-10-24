using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;
using OnlyCars.Infrastructure.Storage;

namespace OnlyCars.Tests;

/// <summary>LOW-10 orphan sweep, on a fake storage only: no test or agent runs it against R2.</summary>
public class OrphanSweepTests
{
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly FakeFileStorage storage = new();
    private readonly StringWriter output = new();

    private static string Prefix(Guid id) => $"users/{id}/";

    private Guid AddUser()
    {
        var user = new User { Email = $"{Guid.NewGuid()}@onlycars.test", PasswordHash = "x" };
        db.Users.Add(user);
        db.SaveChanges();
        return user.Id;
    }

    private void AddFiles(string prefix, int count)
    {
        for (var i = 0; i < count; i++)
        {
            storage.Objects[$"{prefix}file-{i}.jpg"] = ([1], "image/jpeg");
        }
    }

    private Task<int> RunAsync(params string[] args) => OrphanSweep.RunAsync(storage, db, args, output);

    /// <summary>Two live users with files, one orphan with 3 files.</summary>
    private string Seed()
    {
        AddFiles(Prefix(AddUser()), 2);
        AddFiles(Prefix(AddUser()), 1);
        var orphan = Prefix(Guid.NewGuid());
        AddFiles(orphan, 3);
        return orphan;
    }

    [Fact]
    public async Task DryRun_ListsOrphansWithCountsAndTotals_DeletesNothing()
    {
        var orphan = Seed();

        Assert.Equal(0, await RunAsync());

        Assert.Contains($"{orphan}  3 objects", output.ToString());
        Assert.Contains("1 orphan prefixes of 3, 3 objects, 2 users.", output.ToString());
        Assert.Contains("Dry run: nothing deleted.", output.ToString());
        Assert.Empty(storage.DeletedPrefixes);
        Assert.Equal(6, storage.Objects.Count);
    }

    [Fact]
    public async Task Delete_DeletesOnlyTheListedOrphans()
    {
        var orphan = Seed();

        Assert.Equal(0, await RunAsync("--delete"));

        Assert.Equal([orphan], storage.DeletedPrefixes);
        Assert.Equal(3, storage.Objects.Count);
        Assert.DoesNotContain(storage.Objects.Keys, k => k.StartsWith(orphan, StringComparison.Ordinal));
    }

    [Fact]
    public async Task ListsPrefixesBeforeUsers_ASignupDuringTheRunIsNotAnOrphan()
    {
        Seed();
        var late = new User { Email = "late@onlycars.test", PasswordHash = "x" };
        AddFiles(Prefix(late.Id), 1);
        storage.OnList = async () => { db.Users.Add(late); await db.SaveChangesAsync(); };

        Assert.Equal(0, await RunAsync("--delete"));

        Assert.DoesNotContain(Prefix(late.Id), storage.DeletedPrefixes);
        Assert.Contains("1 orphan prefixes of 4", output.ToString());
    }

    [Theory]
    [InlineData("users/not-a-guid/")]
    [InlineData("users/0F8FAD5B-D9CB-469F-A165-70867728950E/")]
    [InlineData("users/0f8fad5bd9cb469fa16570867728950e/")]
    [InlineData("other/0f8fad5b-d9cb-469f-a165-70867728950e/")]
    public async Task SkipsAnythingButExactlyUsersGuid(string prefix)
    {
        Seed();
        AddFiles(prefix, 1);

        Assert.Equal(0, await RunAsync("--delete", "--force"));

        Assert.True(storage.Objects.ContainsKey($"{prefix}file-0.jpg"));
        Assert.Contains("1 orphan prefixes of 3", output.ToString());
    }

    [Fact]
    public async Task StorageNotConfigured_Stops()
    {
        Assert.Equal(1, await OrphanSweep.RunAsync(null, db, ["--delete"], output));
        Assert.Contains("nothing deleted: file storage is not configured", output.ToString());
    }

    [Fact]
    public async Task DatabaseUnreachable_Stops_DeletesNothing()
    {
        Seed();
        await db.DisposeAsync();

        Assert.Equal(1, await RunAsync("--delete", "--force"));

        Assert.Contains("nothing deleted: the database can't be reached", output.ToString());
        Assert.Empty(storage.DeletedPrefixes);
    }

    [Fact]
    public async Task ZeroUsers_Stops_EvenWithForce()
    {
        AddFiles(Prefix(Guid.NewGuid()), 1);

        Assert.Equal(1, await RunAsync("--delete", "--force"));

        Assert.Contains("the database has 0 users", output.ToString());
        Assert.Empty(storage.DeletedPrefixes);
    }

    [Fact]
    public async Task MoreThanHalfOrphans_NeedsForce()
    {
        AddFiles(Prefix(AddUser()), 1);
        var orphans = new[] { Prefix(Guid.NewGuid()), Prefix(Guid.NewGuid()) };
        foreach (var o in orphans)
        {
            AddFiles(o, 1);
        }

        Assert.Equal(1, await RunAsync("--delete"));
        Assert.Contains("2 of 3 prefixes are orphans, more than half", output.ToString());
        Assert.Empty(storage.DeletedPrefixes);

        Assert.Equal(0, await RunAsync("--delete", "--force"));
        Assert.Equal(orphans.Order(), storage.DeletedPrefixes.Order());
    }

    [Fact]
    public async Task ExactlyHalfOrphans_RunsWithoutForce()
    {
        AddFiles(Prefix(AddUser()), 1);
        AddFiles(Prefix(Guid.NewGuid()), 1);

        Assert.Equal(0, await RunAsync("--delete"));
        Assert.Single(storage.DeletedPrefixes);
    }

    [Fact]
    public async Task StorageListFails_Stops_DeletesNothing()
    {
        Seed();
        storage.OnList = () => throw new IOException("storage down");

        Assert.Equal(1, await RunAsync("--delete"));

        Assert.Contains("nothing deleted: storage can't be listed (IOException: storage down)", output.ToString());
        Assert.Empty(storage.DeletedPrefixes);
    }

    [Fact]
    public async Task DeleteFails_StopsWithHowManyWereDeleted()
    {
        Seed();
        storage.FailDeletes = true;

        Assert.Equal(1, await RunAsync("--delete"));

        Assert.Contains("stopped after deleting 0 of 1 prefixes", output.ToString());
        Assert.DoesNotContain("nothing deleted", output.ToString());
        Assert.Equal(6, storage.Objects.Count);
    }

    [Fact]
    public async Task UnknownOption_Stops()
    {
        Seed();

        Assert.Equal(1, await RunAsync("--delet"));

        Assert.Contains("unknown option '--delet'", output.ToString());
        Assert.Empty(storage.DeletedPrefixes);
    }
}
