using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;
using static OnlyCars.Domain.TirePosition;

namespace OnlyCars.Tests;

/// <summary>
/// TIRE-2a criterion 4: the TiresPerWheel migration on LocalDB with data seeded in the old tire tables before it.
/// shortcut: needs SQL Server LocalDB on the machine, as MaintenanceSchemaTests.
/// </summary>
public class TireMigrationTests : IAsyncLifetime
{
    private const string Before = "20261102185844_AddEmailDigest";
    internal static readonly string[] OldTables = ["TireSets", "TireMounts", "TireChecks", "TireMeasurements", "TireRotations"];
    private static readonly DateOnly Day = new(2025, 1, 1);

    private readonly AppDbContext db = new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer($@"Server=(localdb)\mssqllocaldb;Database=OnlyCars_Test_{Guid.NewGuid():N};Trusted_Connection=True;TrustServerCertificate=True")
        .Options);

    private IMigrator Migrator => db.GetService<IMigrator>();

    public async Task InitializeAsync() => await Migrator.MigrateAsync(Before);

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    /// <summary>Inserts a row with a new Id and CreatedAt/UpdatedAt into an old tire table, which is outside the EF model.</summary>
    internal static async Task<Guid> InsertAsync(AppDbContext db, string table, params (string Column, object? Value)[] values)
    {
        var id = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;
        var all = values.Prepend(("Id", id)).Append(("CreatedAt", now)).Append(("UpdatedAt", now)).ToList();
        // Table and column names are the test's own constants; the values go as parameters.
#pragma warning disable EF1002
        await db.Database.ExecuteSqlRawAsync(
            $"INSERT INTO [{table}] ({string.Join(", ", all.Select(v => $"[{v.Column}]"))}) VALUES ({string.Join(", ", all.Select((_, i) => $"@p{i}"))})",
            all.Select((v, i) => new SqlParameter($"@p{i}", v.Value switch
            {
                null => DBNull.Value,
                DateOnly d => d.ToDateTime(TimeOnly.MinValue),
                Enum e => Convert.ToInt32(e),
                var other => other
            })));
#pragma warning restore EF1002
        return id;
    }

    /// <summary>One row in each old tire table for the car (ACC-2's delete test seeds the Legacy_ ones).</summary>
    internal static async Task InsertOldTiresAsync(AppDbContext db, string prefix, Guid userId, Guid vehicleId)
    {
        var set = await InsertAsync(db, prefix + "TireSets", ("UserId", userId), ("Brand", "Old"), ("Season", 0));
        var mount = await InsertAsync(db, prefix + "TireMounts", ("TireSetId", set), ("VehicleId", vehicleId), ("MountedAt", Day), ("MountOdometerKm", 0m));
        var check = await InsertAsync(db, prefix + "TireChecks", ("TireMountId", mount), ("MeasuredAt", Day));
        await InsertAsync(db, prefix + "TireMeasurements", ("TireCheckId", check), ("Position", FL), ("PressureBar", 2.2m));
        await InsertAsync(db, prefix + "TireRotations", ("TireMountId", mount), ("Date", Day), ("OdometerKm", 0m));
    }

    // Every row of the five old tables, as JSON.
    private async Task<string> SnapshotAsync(string prefix)
    {
        var parts = new List<string?>();
        foreach (var table in OldTables)
        {
#pragma warning disable EF1002 // the table names are constants
            parts.Add(await db.Database.SqlQueryRaw<string?>($"SELECT (SELECT * FROM [{prefix}{table}] ORDER BY [Id] FOR JSON PATH) AS [Value]").SingleAsync());
#pragma warning restore EF1002
        }

        return string.Join("\n", parts);
    }

    private async Task<int?> ObjectIdAsync(string table) =>
        await db.Database.SqlQuery<int?>($"SELECT OBJECT_ID({table}) AS [Value]").SingleAsync();

    [Fact]
    public async Task Up_CopiesEveryMountCheckAndRotation_KeepsTheOldTablesAsLegacy_AndDownThenUpWorks()
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = "Car", CurrentOdometerKm = 70_000 };
        var other = new Vehicle { User = user, Nickname = "Other", CurrentOdometerKm = 5_000 };
        db.AddRange(car, other);
        await db.SaveChangesAsync();

        // Two sets one after the other on the car (winter, then summer still on), winter earlier on the other car, and a set never mounted.
        var winter = await InsertAsync(db, "TireSets", ("UserId", user.Id), ("Brand", "Nokian"), ("Model", "Hakka"), ("Size", "205/55 R16"),
            ("Season", 1), ("PurchaseDate", Day.AddYears(-1)), ("DotCode", "DOT 0124"), ("Notes", "Loft"));
        var summer = await InsertAsync(db, "TireSets", ("UserId", user.Id), ("Brand", "Michelin"), ("Model", "Primacy 4"), ("Season", 0));
        await InsertAsync(db, "TireSets", ("UserId", user.Id), ("Brand", "Never"), ("Season", 2));
        var onOther = await InsertAsync(db, "TireMounts", ("TireSetId", winter), ("VehicleId", other.Id), ("MountedAt", Day.AddDays(-200)),
            ("MountOdometerKm", 1_000m), ("UnmountedAt", Day.AddDays(-100)), ("UnmountOdometerKm", 3_000m));
        var closed = await InsertAsync(db, "TireMounts", ("TireSetId", winter), ("VehicleId", car.Id), ("MountedAt", Day),
            ("MountOdometerKm", 50_000m), ("UnmountedAt", Day.AddDays(90)), ("UnmountOdometerKm", 55_000m));
        var open = await InsertAsync(db, "TireMounts", ("TireSetId", summer), ("VehicleId", car.Id), ("MountedAt", Day.AddDays(90)), ("MountOdometerKm", 55_000m));
        var first = await InsertAsync(db, "TireChecks", ("TireMountId", open), ("MeasuredAt", Day.AddDays(100)));
        await InsertAsync(db, "TireMeasurements", ("TireCheckId", first), ("Position", FL), ("PressureBar", 2.2m), ("TreadDepthMm", 6.5m));
        await InsertAsync(db, "TireMeasurements", ("TireCheckId", first), ("Position", FR), ("PressureBar", 2.3m));
        await InsertAsync(db, "TireMeasurements", ("TireCheckId", first), ("Position", Spare), ("PressureBar", 3.5m));
        var second = await InsertAsync(db, "TireChecks", ("TireMountId", open), ("MeasuredAt", Day.AddDays(120)));
        await InsertAsync(db, "TireMeasurements", ("TireCheckId", second), ("Position", RR), ("TreadDepthMm", 5.0m));
        var otherCheck = await InsertAsync(db, "TireChecks", ("TireMountId", onOther), ("MeasuredAt", Day.AddDays(-150)));
        await InsertAsync(db, "TireMeasurements", ("TireCheckId", otherCheck), ("Position", FL), ("PressureBar", 2.0m));
        var rotation = await InsertAsync(db, "TireRotations", ("TireMountId", open), ("Date", Day.AddDays(110)), ("OdometerKm", 56_000m), ("Notes", "Front to back"));
        var oldRotation = await InsertAsync(db, "TireRotations", ("TireMountId", closed), ("Date", Day.AddDays(30)), ("OdometerKm", 52_000m));
        var before = await SnapshotAsync("");

        await Migrator.MigrateAsync();
        db.ChangeTracker.Clear();

        Assert.Equal(before, await SnapshotAsync("Legacy_"));
        Assert.Equal((13, 5, 2, 0), (await db.Tires.CountAsync(), await db.TireMeasurements.CountAsync(), await db.TireRotations.CountAsync(),
            await db.TireRotationMoves.CountAsync()));
        Assert.False(await db.Tires.AnyAsync(t => t.Brand == "Never" || t.ServiceRecordId != null));

        var vehicles = new VehicleService(db);
        var tires = new TireService(db, vehicles, new MaintenanceTaskService(db, vehicles));
        var view = await tires.GetVehicleTiresAsync(user.Id, car.Id);
        Assert.Equal([FL, FR, RL, RR, Spare], view.Current.Select(t => t.Position));
        Assert.All(view.Current, t => Assert.Equal(("Michelin", "Primacy 4", (string?)null, Domain.TireSeason.Summer, Day.AddDays(90), 55_000m, 15_000m),
            (t.Brand, t.Model, t.Size, t.Season, t.FittedAt, t.FittedOdometerKm, t.KmOnTire)));
        Assert.Equal([FL, FR, RL, RR], view.Removed.Select(t => t.Position).Order());
        Assert.All(view.Removed, t => Assert.Equal(("Nokian", "Hakka", "205/55 R16", Domain.TireSeason.Winter, "DOT 0124", Day.AddYears(-1), "Loft"),
            (t.Brand, t.Model, t.Size, t.Season, t.DotCode, t.PurchaseDate!.Value, t.Notes)));
        Assert.All(view.Removed, t => Assert.Equal((Day, 50_000m, Day.AddDays(90), 55_000m, 5_000m),
            (t.FittedAt, t.FittedOdometerKm, t.RemovedAt!.Value, t.RemovedOdometerKm!.Value, t.KmOnTire)));
        Assert.Equal(Day.AddDays(120), view.LastCheckDate);
        Assert.Equal(new LastTireRotationDto(rotation, Day.AddDays(110), 56_000, 14_000), view.LastRotation);

        var ids = view.Current.ToDictionary(t => t.Position, t => t.Id);
        var checks = await tires.ListChecksAsync(user.Id, car.Id);
        Assert.Equal([Day.AddDays(120), Day.AddDays(100)], checks.Select(c => c.MeasuredAt));
        Assert.Equal([new TireCheckItemDto(ids[RR], RR, null, 5.0m)], checks[0].Items);
        Assert.Equal([new TireCheckItemDto(ids[FL], FL, 2.2m, 6.5m), new TireCheckItemDto(ids[FR], FR, 2.3m, null), new TireCheckItemDto(ids[Spare], Spare, 3.5m, null)],
            checks[1].Items);
        var rotations = await tires.ListRotationsAsync(user.Id, car.Id);
        Assert.Equal([(rotation, "Front to back"), (oldRotation, (string?)null)], rotations.Select(r => (r.Id, r.Notes)));
        Assert.All(rotations, r => Assert.Empty(r.Moves)); // "Wheels not recorded"

        var otherView = await tires.GetVehicleTiresAsync(user.Id, other.Id);
        Assert.Empty(otherView.Current);
        Assert.All(otherView.Removed, t => Assert.Equal(("Nokian", 2_000m), (t.Brand, t.KmOnTire)));
        var otherItem = Assert.Single(Assert.Single(await tires.ListChecksAsync(user.Id, other.Id)).Items);
        Assert.Equal(otherView.Removed.Single(t => t.Position == FL).Id, otherItem.TireId);

        // Down drops the new tables and puts the old ones back as they were; Up runs again on them.
        await Migrator.MigrateAsync(Before);
        Assert.Equal(before, await SnapshotAsync(""));
        Assert.Equal((null, null), (await ObjectIdAsync("Tires"), await ObjectIdAsync("Legacy_TireSets")));

        await Migrator.MigrateAsync();
        Assert.Equal(before, await SnapshotAsync("Legacy_"));
        Assert.Equal((13, 5, 2), (await db.Tires.CountAsync(), await db.TireMeasurements.CountAsync(), await db.TireRotations.CountAsync()));
    }
}
