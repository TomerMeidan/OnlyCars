using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP5-D backend: tire sets, mounts and km per set. Criterion numbers refer to the ticket.</summary>
public class TireTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db;
    private readonly VehicleService vehicles;
    private readonly TireService tires;
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid otherUserId = Guid.NewGuid();

    public TireTests() : this(TestDbContextFactory.Create())
    {
    }

    private TireTests(AppDbContext context)
    {
        db = context;
        vehicles = new VehicleService(db);
        tires = new TireService(db, vehicles);
    }

    private async Task<Guid> CarAsync(Guid? owner = null, string nickname = "Mazda", decimal odometer = 50_000) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(nickname, null, null, null, null, null, null, null, null, null, odometer))).Id;

    private Task<TireSetDto> SetAsync(string brand = "Michelin", Guid? owner = null, TireSeason season = TireSeason.Summer) =>
        tires.CreateAsync(owner ?? userId, new TireSetRequest(brand, null, null, season, null, null, null));

    private Task<VehicleTiresDto> MountAsync(Guid car, Guid set, DateOnly date, decimal km) =>
        tires.MountAsync(userId, car, new MountTireSetRequest(set, date, km));

    private Task<VehicleTiresDto> UnmountAsync(Guid car, DateOnly date, decimal km) =>
        tires.UnmountAsync(userId, car, new UnmountTireSetRequest(date, km));

    private async Task SetOdometerAsync(Guid car, decimal km)
    {
        (await db.Vehicles.FindAsync(car))!.CurrentOdometerKm = km;
        await db.SaveChangesAsync();
    }

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    // --- Criterion 2: CRUD and validation ---

    [Fact]
    public async Task Create_BrandAndSeasonOnly_Saves_TrimsAndListsSorted()
    {
        await tires.CreateAsync(userId, new TireSetRequest("  Pirelli ", " ", "", TireSeason.Winter, null, null, null));
        await SetAsync("Michelin");
        var full = await tires.CreateAsync(userId, new TireSetRequest("Bridgestone", "Turanza", "205/55 R16", TireSeason.AllSeason,
            Today, "DOT 1234", "In the garage loft"));

        var list = await tires.ListAsync(userId);

        Assert.Equal(["Bridgestone", "Michelin", "Pirelli"], list.Select(s => s.Brand));
        Assert.Equal((null, null, TireSeason.Winter, 0m, null, 0), (list[2].Model, list[2].Size, list[2].Season, list[2].KmDriven, list[2].OpenMount, list[2].MountCount));
        Assert.Equal(("Turanza", "205/55 R16", Today, "DOT 1234", "In the garage loft"), (full.Model, full.Size, full.PurchaseDate, full.DotCode, full.Notes));
        Assert.Empty(await tires.ListAsync(otherUserId));
    }

    [Theory]
    [InlineData("", null, null, null, null, "tireSet.invalidBrand")]
    [InlineData("51", null, null, null, null, "tireSet.invalidBrand")]
    [InlineData("B", "51", null, null, null, "tireSet.invalidModel")]
    [InlineData("B", null, "31", null, null, "tireSet.invalidSize")]
    [InlineData("B", null, null, "21", null, "tireSet.invalidDotCode")]
    [InlineData("B", null, null, null, "1001", "tireSet.invalidNotes")]
    public async Task Create_FieldTooLongOrEmpty_HasItsCode(string brand, string? model, string? size, string? dot, string? notes, string code)
    {
        // A number stands for a string of that many characters.
        static string? S(string? v) => int.TryParse(v, out var n) ? new string('x', n) : v;

        Assert.Equal(code, await CodeAsync(() => tires.CreateAsync(userId, new TireSetRequest(S(brand), S(model), S(size), TireSeason.Summer, null, S(dot), S(notes)))));
        Assert.Empty(db.TireSets);
    }

    [Fact]
    public async Task Create_AtTheMaxLengths_Saves()
    {
        var s = await tires.CreateAsync(userId, new TireSetRequest(new string('b', 50), new string('m', 50), new string('s', 30), TireSeason.Summer,
            null, new string('d', 20), new string('n', 1000)));
        Assert.Equal(50, s.Brand.Length);
    }

    [Fact]
    public async Task Create_SeasonOrDate_Rules()
    {
        Assert.Equal("tireSet.invalidSeason", await CodeAsync(() => tires.CreateAsync(userId, new TireSetRequest("B", null, null, null, null, null, null))));
        Assert.Equal("tireSet.futureDate", await CodeAsync(() => tires.CreateAsync(userId, new TireSetRequest("B", null, null, TireSeason.Summer, Today.AddDays(2), null, null))));
        Assert.Equal("date.tooEarly", await CodeAsync(() => tires.CreateAsync(userId, new TireSetRequest("B", null, null, TireSeason.Summer, new DateOnly(1899, 12, 31), null, null))));
        await tires.CreateAsync(userId, new TireSetRequest("B", null, null, TireSeason.Summer, new DateOnly(1900, 1, 1), null, null));
    }

    [Fact]
    public async Task Create_51stSet_IsLimitReached_OtherUsersDontCount()
    {
        db.TireSets.AddRange(Enumerable.Range(0, TireSet.MaxPerUser).Select(n => new TireSet { UserId = userId, Brand = $"#{n}" }));
        await db.SaveChangesAsync();

        Assert.Equal("tireSet.limitReached", await CodeAsync(() => SetAsync()));
        await SetAsync(owner: otherUserId);
    }

    [Fact]
    public async Task Update_ChangesEveryField()
    {
        var s = await SetAsync();

        var updated = await tires.UpdateAsync(userId, s.Id, new TireSetRequest("Nokian", "Hakka", "195/65 R15", TireSeason.Winter, Today, "DOT", "Shelf"));

        Assert.Equal(("Nokian", "Hakka", "195/65 R15", TireSeason.Winter, Today, "DOT", "Shelf"),
            (updated.Brand, updated.Model, updated.Size, updated.Season, updated.PurchaseDate, updated.DotCode, updated.Notes));
        Assert.Equal("tireSet.invalidBrand", await CodeAsync(() => tires.UpdateAsync(userId, s.Id, new TireSetRequest(" ", null, null, TireSeason.Summer, null, null, null))));
    }

    // --- Criterion 1: caller scoping on every endpoint ---

    [Fact]
    public async Task AnotherUsersSetMountOrCar_IsNotFound()
    {
        var myCar = await CarAsync();
        var mySet = await SetAsync();
        var theirCar = await CarAsync(otherUserId);
        var theirSet = await SetAsync(owner: otherUserId);
        await tires.MountAsync(otherUserId, theirCar, new MountTireSetRequest(theirSet.Id, Today, 50_000));
        var theirMount = (await tires.GetVehicleTiresAsync(otherUserId, theirCar)).Current!.Id;
        var req = new TireSetRequest("B", null, null, TireSeason.Summer, null, null, null);

        Assert.Equal("tireSet.notFound", await CodeAsync(() => tires.UpdateAsync(userId, theirSet.Id, req)));
        Assert.Equal("tireSet.notFound", await CodeAsync(() => tires.DeleteAsync(userId, theirSet.Id)));
        Assert.Equal("tireSet.notFound", await CodeAsync(() => tires.ListMountsAsync(userId, theirSet.Id)));
        Assert.Equal("tireSet.notFound", await CodeAsync(() => MountAsync(myCar, theirSet.Id, Today, 50_000)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => MountAsync(theirCar, mySet.Id, Today, 50_000)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => tires.GetVehicleTiresAsync(userId, theirCar)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => UnmountAsync(theirCar, Today, 50_000)));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.DeleteMountAsync(userId, theirMount)));
        Assert.Single(db.TireMounts);
        Assert.Equal("Michelin", Assert.Single(await tires.ListAsync(otherUserId)).Brand);
    }

    // --- Criterion 3: mount, swap, unmount and their rules ---

    [Fact]
    public async Task Mount_Swap_Unmount()
    {
        var car = await CarAsync();
        var summer = await SetAsync("Summer set");
        var winter = await SetAsync("Winter set", season: TireSeason.Winter);

        var mounted = await MountAsync(car, summer.Id, Today.AddDays(-30), 49_000);
        Assert.Equal((summer.Id, "Mazda", 1_000m), (mounted.Current!.TireSetId, mounted.Current.VehicleNickname, mounted.Current.KmDriven));
        Assert.Empty(mounted.Past);

        var swapped = await MountAsync(car, winter.Id, Today.AddDays(-10), 49_600);
        Assert.Equal((winter.Id, Today.AddDays(-10), 49_600m), (swapped.Current!.TireSetId, swapped.Current.MountedAt, swapped.Current.MountOdometerKm));
        var closed = Assert.Single(swapped.Past);
        Assert.Equal((summer.Id, Today.AddDays(-10), 49_600m, 600m), (closed.TireSetId, closed.UnmountedAt, closed.UnmountOdometerKm, closed.KmDriven));

        var sets = await tires.ListAsync(userId);
        Assert.Null(sets.Single(s => s.Id == summer.Id).OpenMount);
        Assert.Equal(new TireSetOpenMountDto(car, "Mazda", Today.AddDays(-10), 49_600), sets.Single(s => s.Id == winter.Id).OpenMount);

        var unmounted = await UnmountAsync(car, Today, 50_000);
        Assert.Null(unmounted.Current);
        Assert.Equal([winter.Id, summer.Id], unmounted.Past.Select(m => m.TireSetId));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => UnmountAsync(car, Today, 50_000)));
    }

    [Fact]
    public async Task Mount_SameDaySwap_IsAllowed_AndNewestFirst()
    {
        var car = await CarAsync();
        var a = await SetAsync("A");
        var b = await SetAsync("B");
        await MountAsync(car, a.Id, Today, 50_000);

        var swapped = await MountAsync(car, b.Id, Today, 50_000);

        Assert.Equal(b.Id, swapped.Current!.TireSetId);
        Assert.Equal(a.Id, Assert.Single(swapped.Past).TireSetId);
    }

    [Fact]
    public async Task Mount_SetOnAnotherCar_IsSetMounted409()
    {
        var car1 = await CarAsync(nickname: "One");
        var car2 = await CarAsync(nickname: "Two");
        var s = await SetAsync();
        await MountAsync(car1, s.Id, Today, 50_000);

        var error = await Assert.ThrowsAsync<ConflictException>(() => MountAsync(car2, s.Id, Today, 50_000));
        Assert.Equal("tireMount.setMounted", error.Code);
        Assert.Equal("tireMount.setMounted", await CodeAsync(() => MountAsync(car1, s.Id, Today, 50_000)));
        Assert.Single(db.TireMounts);
    }

    [Fact]
    public async Task Mount_Overlaps_AreRejected()
    {
        var car = await CarAsync();
        var other = await CarAsync(nickname: "Other");
        var a = await SetAsync("A");
        var b = await SetAsync("B");
        await MountAsync(car, a.Id, Today.AddDays(-10), 50_000);

        // Before the open mount's start on this car.
        Assert.Equal("tireMount.overlap", await CodeAsync(() => MountAsync(car, b.Id, Today.AddDays(-11), 50_000)));

        // Before the latest unmount of the car.
        await UnmountAsync(car, Today.AddDays(-5), 50_000);
        Assert.Equal("tireMount.overlap", await CodeAsync(() => MountAsync(car, b.Id, Today.AddDays(-6), 50_000)));

        // Before the latest unmount of the set, on another car.
        Assert.Equal("tireMount.overlap", await CodeAsync(() => MountAsync(other, a.Id, Today.AddDays(-6), 50_000)));
        await MountAsync(other, a.Id, Today.AddDays(-5), 50_000);

        // Unmount before the mount's start.
        Assert.Equal("tireMount.overlap", await CodeAsync(() => UnmountAsync(other, Today.AddDays(-6), 50_000)));
        Assert.Equal(2, db.TireMounts.Count());
    }

    [Fact]
    public async Task Mount_DateAndOdometerRules()
    {
        var car = await CarAsync();
        var a = await SetAsync("A");
        var b = await SetAsync("B");

        Assert.Equal("tireMount.futureDate", await CodeAsync(() => MountAsync(car, a.Id, Today.AddDays(2), 50_000)));
        Assert.Equal("date.tooEarly", await CodeAsync(() => MountAsync(car, a.Id, new DateOnly(1899, 12, 31), 50_000)));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => MountAsync(car, a.Id, Today, -1)));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => MountAsync(car, a.Id, Today, 10_000_001)));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => tires.MountAsync(userId, car, new MountTireSetRequest(a.Id, Today, null))));

        // A null date is today.
        var mounted = await tires.MountAsync(userId, car, new MountTireSetRequest(a.Id, null, 50_000));
        Assert.Equal(Today, mounted.Current!.MountedAt);

        var swapError = await Assert.ThrowsAsync<ValidationFailedException>(() => MountAsync(car, b.Id, Today, 49_999));
        Assert.Equal(("tireMount.odometerBeforeMount", 50_000m), (swapError.Code, swapError.Extensions["mountOdometerKm"]));
        Assert.Equal("tireMount.odometerBeforeMount", await CodeAsync(() => UnmountAsync(car, Today, 49_999)));
        Assert.Equal("tireMount.futureDate", await CodeAsync(() => UnmountAsync(car, Today.AddDays(2), 50_000)));
    }

    [Fact]
    public async Task ArchivedCar_MountRejected_UnmountAllowed()
    {
        var car = await CarAsync();
        var a = await SetAsync("A");
        var b = await SetAsync("B");
        await MountAsync(car, a.Id, Today, 50_000);
        await vehicles.ArchiveAsync(userId, car, true);

        Assert.Equal("tireMount.vehicleArchived", await CodeAsync(() => MountAsync(car, b.Id, Today, 50_000)));
        var unmounted = await UnmountAsync(car, Today, 50_100);
        Assert.Null(unmounted.Current);
    }

    [Fact]
    public async Task Mount_SimultaneousMount_IsConcurrencyConflictNotA500()
    {
        var root = new Microsoft.EntityFrameworkCore.Storage.InMemoryDatabaseRoot();
        var name = Guid.NewGuid().ToString();
        var t = new TireTests(new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root)
            .AddInterceptors(new UniqueIndexInterceptor()).Options));
        var car = await t.CarAsync();
        var s = await t.SetAsync();

        var error = await Assert.ThrowsAsync<ConflictException>(() => t.MountAsync(car, s.Id, Today, 50_000));

        Assert.Equal("concurrency.conflict", error.Code);
    }

    [Fact]
    public async Task Mount_501stOfASet_IsLimitReached()
    {
        var car = await CarAsync();
        var s = await SetAsync();
        db.TireMounts.AddRange(Enumerable.Range(0, TireSet.MaxMounts).Select(n => new TireMount
        {
            TireSetId = s.Id, VehicleId = car, MountedAt = Today.AddDays(-1000 + n), MountOdometerKm = 0,
            UnmountedAt = Today.AddDays(-1000 + n), UnmountOdometerKm = 0
        }));
        await db.SaveChangesAsync();

        Assert.Equal("tireMount.limitReached", await CodeAsync(() => MountAsync(car, s.Id, Today, 50_000)));
    }

    // --- Criterion 4: km per set ---

    [Fact]
    public async Task KmDriven_TwoClosedAndOneOpen_AndAnOpenMountAboveTheCarsOdometerAddsZero()
    {
        var car = await CarAsync(odometer: 10_000);
        var other = await CarAsync(nickname: "Other", odometer: 0);
        var s = await SetAsync();
        await MountAsync(car, s.Id, Today.AddDays(-100), 10_000);
        await UnmountAsync(car, Today.AddDays(-90), 11_000);           // 1,000
        await MountAsync(other, s.Id, Today.AddDays(-80), 2_000);
        await UnmountAsync(other, Today.AddDays(-70), 2_500.5m);       // 500.5
        await MountAsync(car, s.Id, Today.AddDays(-60), 12_000);
        await SetOdometerAsync(car, 12_300);                          // open: 300

        var set = Assert.Single(await tires.ListAsync(userId));
        Assert.Equal((1_800.5m, 3), (set.KmDriven, set.MountCount));
        var mounts = await tires.ListMountsAsync(userId, s.Id);
        Assert.Equal([300m, 500.5m, 1_000m], mounts.Select(m => m.KmDriven));
        Assert.Equal(["Mazda", "Other", "Mazda"], mounts.Select(m => m.VehicleNickname));

        await SetOdometerAsync(car, 11_900);
        Assert.Equal(1_500.5m, Assert.Single(await tires.ListAsync(userId)).KmDriven);
        Assert.Equal(0m, (await tires.GetVehicleTiresAsync(userId, car)).Current!.KmDriven);
    }

    // --- Criterion 5: deletes, and no odometer readings ---

    [Fact]
    public async Task DeleteSet_DeletesItsMounts()
    {
        var car = await CarAsync();
        var s = await SetAsync();
        await MountAsync(car, s.Id, Today.AddDays(-1), 50_000);
        await UnmountAsync(car, Today.AddDays(-1), 50_000);
        await MountAsync(car, s.Id, Today, 50_000);

        await tires.DeleteAsync(userId, s.Id);

        Assert.Empty(db.TireSets);
        Assert.Empty(db.TireMounts);
        Assert.Null((await tires.GetVehicleTiresAsync(userId, car)).Current);
    }

    [Fact]
    public async Task DeleteMount_OpenOneLeavesTheCarWithNoSet_PastOneGoes()
    {
        var car = await CarAsync();
        var a = await SetAsync("A");
        var b = await SetAsync("B");
        await MountAsync(car, a.Id, Today.AddDays(-5), 50_000);
        var state = await MountAsync(car, b.Id, Today, 50_000);

        await tires.DeleteMountAsync(userId, state.Current!.Id);
        var after = await tires.GetVehicleTiresAsync(userId, car);
        Assert.Null(after.Current);
        Assert.Single(after.Past);

        await tires.DeleteMountAsync(userId, after.Past[0].Id);
        Assert.Empty((await tires.GetVehicleTiresAsync(userId, car)).Past);
        Assert.Equal(2, db.TireSets.Count());
    }

    [Fact]
    public async Task MountAndUnmount_AddNoOdometerReading()
    {
        var car = await CarAsync();
        var s = await SetAsync();
        var before = db.OdometerReadings.Count();

        await MountAsync(car, s.Id, Today, 50_100);
        await UnmountAsync(car, Today, 50_200);

        Assert.Equal(before, db.OdometerReadings.Count());
        Assert.Equal(50_000m, (await db.Vehicles.FindAsync(car))!.CurrentOdometerKm);
    }

    [Fact]
    public async Task VehicleTires_PastIsCappedAtTheNewest100()
    {
        var car = await CarAsync();
        var s = await SetAsync();
        db.TireMounts.AddRange(Enumerable.Range(0, TireService.MaxPastMountsListed + 1).Select(n => new TireMount
        {
            TireSetId = s.Id, VehicleId = car, MountedAt = Today.AddDays(-n), MountOdometerKm = 0, UnmountedAt = Today.AddDays(-n), UnmountOdometerKm = 0
        }));
        await db.SaveChangesAsync();

        var past = (await tires.GetVehicleTiresAsync(userId, car)).Past;

        Assert.Equal(100, past.Count);
        Assert.Equal((Today, Today.AddDays(-99)), (past[0].MountedAt, past[^1].MountedAt));
    }

    /// <summary>Fails the save like the open-mount unique index after another request mounted first.</summary>
    private sealed class UniqueIndexInterceptor : SaveChangesInterceptor
    {
        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default) =>
            eventData.Context!.ChangeTracker.Entries<TireMount>().Any(e => e.State == EntityState.Added)
                ? throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.TireMounts' with unique index 'IX_TireMounts_VehicleId_Open'.")
                : ValueTask.FromResult(result);
    }
}
