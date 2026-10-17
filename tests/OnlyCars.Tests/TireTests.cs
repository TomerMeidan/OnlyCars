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
            .AddInterceptors(new UniqueIndexInterceptor<TireMount>()).Options));
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

    // ===== MVP5-E: checks and rotations. Criterion numbers below refer to the MVP5-E ticket. =====

    private async Task<(Guid Car, Guid Set, Guid Mount)> MountedAsync(decimal odometer = 50_000, int daysAgo = 30)
    {
        var car = await CarAsync(odometer: odometer);
        var set = await SetAsync();
        var state = await MountAsync(car, set.Id, Today.AddDays(-daysAgo), odometer);
        return (car, set.Id, state.Current!.Id);
    }

    private static TireCheckItemRequest Wheel(TirePosition? position, decimal? bar = null, decimal? mm = null) => new(position, bar, mm);

    private Task<TireCheckDto> CheckAsync(Guid mount, DateOnly date, params TireCheckItemRequest[] items) =>
        tires.AddCheckAsync(userId, mount, new TireCheckRequest(date, [.. items]));

    private Task<TireRotationDto> RotateAsync(Guid mount, DateOnly date, decimal km, string? notes = null) =>
        tires.AddRotationAsync(userId, mount, new TireRotationRequest(date, km, notes));

    // --- Criterion 1: scoping ---

    [Fact]
    public async Task ChecksAndRotations_AnotherUsersMountOrRotation_IsNotFound()
    {
        var (_, _, mount) = await MountedAsync();
        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 2.4m));
        var rotation = await RotateAsync(mount, Today, 50_000);
        var other = otherUserId;

        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.ListChecksAsync(other, mount)));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.AddCheckAsync(other, mount, new TireCheckRequest(Today.AddDays(-1), [Wheel(TirePosition.FL, 2)]))));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.DeleteCheckAsync(other, mount, Today)));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.ListRotationsAsync(other, mount)));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.AddRotationAsync(other, mount, new TireRotationRequest(Today, 50_000, null))));
        Assert.Equal("tireRotation.notFound", await CodeAsync(() => tires.DeleteRotationAsync(other, rotation.Id)));
        Assert.Equal("tireMount.notFound", await CodeAsync(() => tires.ListChecksAsync(userId, Guid.NewGuid())));
        Assert.Equal((1, 1), (db.TireMeasurements.Count(), db.TireRotations.Count()));
    }

    // --- Criterion 2: checks ---

    [Fact]
    public async Task AddCheck_OnlyFrontLeftPressure_Saves_ItemsInWheelOrder_AndShowsAsLastCheck()
    {
        var (car, _, mount) = await MountedAsync();

        var one = await CheckAsync(mount, Today.AddDays(-2), Wheel(TirePosition.FL, 2.4m));
        var full = await CheckAsync(mount, Today, Wheel(TirePosition.Spare, mm: 8), Wheel(TirePosition.RR, 2.25m, 6.5m), Wheel(TirePosition.FL, 2.3m));

        Assert.Equal(new TireCheckItemDto(TirePosition.FL, 2.4m, null), Assert.Single(one.Items));
        Assert.Equal([TirePosition.FL, TirePosition.RR, TirePosition.Spare], full.Items.Select(i => i.Position));
        var list = await tires.ListChecksAsync(userId, mount);
        Assert.Equal([Today, Today.AddDays(-2)], list.Select(c => c.MeasuredAt));
        Assert.Equal(full.Items, list[0].Items);
        var lastCheck = (await tires.GetVehicleTiresAsync(userId, car)).Current!.LastCheck!;
        Assert.Equal(Today, lastCheck.MeasuredAt);
        Assert.Equal(full.Items, lastCheck.Items);
    }

    [Theory]
    [InlineData(0.49, null, "tireMeasurement.invalidPressure")]
    [InlineData(6.01, null, "tireMeasurement.invalidPressure")]
    [InlineData(2.255, null, "tireMeasurement.invalidPressure")]
    [InlineData(null, -0.1, "tireMeasurement.invalidTread")]
    [InlineData(null, 20.1, "tireMeasurement.invalidTread")]
    [InlineData(null, 6.55, "tireMeasurement.invalidTread")]
    [InlineData(null, null, "tireMeasurement.empty")]
    public async Task AddCheck_BadSecondItem_HasItsCodeAndIndex(double? bar, double? mm, string code)
    {
        var (_, _, mount) = await MountedAsync();

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            CheckAsync(mount, Today, Wheel(TirePosition.FL, 2.4m), Wheel(TirePosition.FR, (decimal?)bar, (decimal?)mm)));

        Assert.Equal((code, 1), (error.Code, error.Extensions["index"]));
        Assert.Empty(db.TireMeasurements);
    }

    [Fact]
    public async Task AddCheck_BoundsSave_AndShapeErrorsHaveTheirCodes()
    {
        var (_, _, mount) = await MountedAsync();

        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 0.5m, 0), Wheel(TirePosition.FR, 6.0m, 20));

        var day = Today.AddDays(-1);
        var duplicate = await Assert.ThrowsAsync<ValidationFailedException>(() => CheckAsync(mount, day, Wheel(TirePosition.RL, 2), Wheel(TirePosition.RL, 2)));
        Assert.Equal(("tireMeasurement.duplicatePosition", 1), (duplicate.Code, duplicate.Extensions["index"]));
        Assert.Equal("tireMeasurement.invalidPosition", await CodeAsync(() => CheckAsync(mount, day, Wheel(null, 2))));
        Assert.Equal("tireMeasurement.empty", await CodeAsync(() => CheckAsync(mount, day)));
        Assert.Equal("tireMeasurement.empty", await CodeAsync(() => tires.AddCheckAsync(userId, mount, new TireCheckRequest(day, null))));
    }

    [Fact]
    public async Task AddCheck_DateBeforeMountFutureOrBefore1900_HasItsCode_NullIsToday()
    {
        var (_, _, mount) = await MountedAsync(daysAgo: 10);

        var before = await Assert.ThrowsAsync<ValidationFailedException>(() => CheckAsync(mount, Today.AddDays(-11), Wheel(TirePosition.FL, 2)));
        Assert.Equal(("tireMount.dateBeforeMount", Today.AddDays(-10)), (before.Code, before.Extensions["mountedAt"]));
        Assert.Equal("tireMount.futureDate", await CodeAsync(() => CheckAsync(mount, Today.AddDays(2), Wheel(TirePosition.FL, 2))));
        Assert.Equal("date.tooEarly", await CodeAsync(() => CheckAsync(mount, new DateOnly(1899, 12, 31), Wheel(TirePosition.FL, 2))));

        await CheckAsync(mount, Today.AddDays(-10), Wheel(TirePosition.FL, 2));
        Assert.Equal(Today, (await tires.AddCheckAsync(userId, mount, new TireCheckRequest(null, [Wheel(TirePosition.FL, 2)]))).MeasuredAt);
    }

    [Fact]
    public async Task AddCheck_SameDateAgain_Is409EvenWithOtherWheels()
    {
        var (_, _, mount) = await MountedAsync();
        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 2.4m));

        var error = await Assert.ThrowsAsync<ConflictException>(() => CheckAsync(mount, Today, Wheel(TirePosition.RR, 2.4m)));

        Assert.Equal(("tireMeasurement.duplicate", Today), (error.Code, error.Extensions["measuredAt"]));
        Assert.Single(db.TireMeasurements);
    }

    [Fact]
    public async Task AddCheck_SimultaneousCheckOfOtherWheelsOnTheSameDate_Is409NotA500()
    {
        // Two requests: `first` saves an FR check while `second`, past its "already a check" query, is saving an FL one.
        var root = new Microsoft.EntityFrameworkCore.Storage.InMemoryDatabaseRoot();
        var name = Guid.NewGuid().ToString();
        var first = new TireTests(new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root).Options));
        var (_, _, mount) = await first.MountedAsync();
        var second = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root)
            .AddInterceptors(new UniqueIndexInterceptor<TireCheck>(() => first.CheckAsync(mount, Today, Wheel(TirePosition.FR, 2.2m)))).Options);

        var error = await Assert.ThrowsAsync<ConflictException>(() => new TireService(second, new VehicleService(second))
            .AddCheckAsync(first.userId, mount, new TireCheckRequest(Today, [Wheel(TirePosition.FL, 2.4m)])));

        Assert.Equal(("tireMeasurement.duplicate", Today), (error.Code, error.Extensions["measuredAt"]));
        Assert.Equal(TirePosition.FR, Assert.Single(Assert.Single(await first.tires.ListChecksAsync(first.userId, mount)).Items).Position);
    }

    [Fact]
    public async Task AddCheck_SaveFailureWithNoCheckOnThatDate_IsRethrownNotA409()
    {
        var t = new TireTests(new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString())
            .AddInterceptors(new UniqueIndexInterceptor<TireCheck>()).Options));
        var (_, _, mount) = await t.MountedAsync();

        await Assert.ThrowsAsync<DbUpdateException>(() => t.CheckAsync(mount, Today, Wheel(TirePosition.FL, 2)));
    }

    [Fact]
    public async Task ClosedMountOrArchivedCar_CreateRejected_DeleteAllowed()
    {
        var (car, _, mount) = await MountedAsync();
        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 2));
        var rotation = await RotateAsync(mount, Today, 50_000);
        await CheckAsync(mount, Today.AddDays(-1), Wheel(TirePosition.FL, 2));
        var rotation2 = await RotateAsync(mount, Today.AddDays(-1), 50_000);

        await vehicles.ArchiveAsync(userId, car, true);
        Assert.Equal("tireMount.vehicleArchived", await CodeAsync(() => CheckAsync(mount, Today.AddDays(-2), Wheel(TirePosition.FL, 2))));
        Assert.Equal("tireMount.vehicleArchived", await CodeAsync(() => RotateAsync(mount, Today, 50_000)));
        await tires.DeleteCheckAsync(userId, mount, Today);
        await tires.DeleteRotationAsync(userId, rotation.Id);

        await vehicles.ArchiveAsync(userId, car, false);
        await UnmountAsync(car, Today, 50_000);
        Assert.Equal("tireMount.notOpen", await CodeAsync(() => CheckAsync(mount, Today.AddDays(-2), Wheel(TirePosition.FL, 2))));
        Assert.Equal("tireMount.notOpen", await CodeAsync(() => RotateAsync(mount, Today, 50_000)));
        await tires.DeleteCheckAsync(userId, mount, Today.AddDays(-1));
        await tires.DeleteRotationAsync(userId, rotation2.Id);

        Assert.Equal((0, 0, 0), (db.TireChecks.Count(), db.TireMeasurements.Count(), db.TireRotations.Count()));
        Assert.Equal("tireMeasurement.notFound", await CodeAsync(() => tires.DeleteCheckAsync(userId, mount, Today)));
        Assert.Equal("tireRotation.notFound", await CodeAsync(() => tires.DeleteRotationAsync(userId, rotation.Id)));
    }

    [Fact]
    public async Task ListChecksAndRotations_OnArchivedCarAndClosedMount_ListNormally_WithoutLoadingTheCar()
    {
        // LOW-4 L82 and L81.
        var (car, _, mount) = await MountedAsync();
        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 2));
        var rotation = await RotateAsync(mount, Today, 50_000);

        async Task AssertListsAsync()
        {
            db.ChangeTracker.Clear();
            Assert.Equal(Today, Assert.Single(await tires.ListChecksAsync(userId, mount)).MeasuredAt);
            Assert.Equal(rotation.Id, Assert.Single(await tires.ListRotationsAsync(userId, mount)).Id);
            Assert.Empty(db.ChangeTracker.Entries<Vehicle>()); // L81: list paths don't join the car
        }

        await vehicles.ArchiveAsync(userId, car, true);
        await AssertListsAsync();

        await vehicles.ArchiveAsync(userId, car, false);
        await UnmountAsync(car, Today, 50_000);
        await AssertListsAsync();

        // The delete path doesn't join it either; the create path does, for the archived rule.
        await tires.DeleteRotationAsync(userId, rotation.Id);
        await tires.DeleteCheckAsync(userId, mount, Today);
        Assert.Empty(db.ChangeTracker.Entries<Vehicle>());
        await CodeAsync(() => RotateAsync(mount, Today, 50_000));
        Assert.Single(db.ChangeTracker.Entries<Vehicle>());
    }

    [Fact]
    public async Task DeleteCheck_RemovesEveryWheelOfThatDateOnly()
    {
        var (_, _, mount) = await MountedAsync();
        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 2), Wheel(TirePosition.FR, 2), Wheel(TirePosition.Spare, mm: 7));
        await CheckAsync(mount, Today.AddDays(-1), Wheel(TirePosition.FL, 2));

        await tires.DeleteCheckAsync(userId, mount, Today);

        Assert.Equal(Today.AddDays(-1), Assert.Single(await tires.ListChecksAsync(userId, mount)).MeasuredAt);
    }

    [Fact]
    public async Task Checks_201stDateIsLimitReached_AndTheListIsTheNewest50Dates()
    {
        var (car, _, mount) = await MountedAsync(daysAgo: 1000);
        db.TireChecks.AddRange(Enumerable.Range(1, TireCheck.MaxPerMount).Select(n => new TireCheck
        {
            TireMountId = mount, MeasuredAt = Today.AddDays(-n),
            Measurements = [new() { Position = TirePosition.RR, PressureBar = 2 }, new() { Position = TirePosition.FL, PressureBar = 2 }]
        }));
        await db.SaveChangesAsync();

        Assert.Equal("tireMeasurement.limitReached", await CodeAsync(() => CheckAsync(mount, Today, Wheel(TirePosition.FL, 2))));
        var list = await tires.ListChecksAsync(userId, mount);
        Assert.Equal(TireService.MaxCheckDatesListed, list.Count);
        Assert.Equal((Today.AddDays(-1), Today.AddDays(-50)), (list[0].MeasuredAt, list[^1].MeasuredAt));
        Assert.All(list, c => Assert.Equal([TirePosition.FL, TirePosition.RR], c.Items.Select(i => i.Position)));
        Assert.Equal(Today.AddDays(-1), (await tires.GetVehicleTiresAsync(userId, car)).Current!.LastCheck!.MeasuredAt);
    }

    // --- Criterion 3: rotations ---

    [Fact]
    public async Task AddRotation_Saves_ListsNewestFirst_AddsNoReading_AndShowsAsLastRotation()
    {
        var (car, _, mount) = await MountedAsync(odometer: 50_000);
        var readings = db.OdometerReadings.Count();

        var older = await RotateAsync(mount, Today.AddDays(-5), 50_500, "  Front to back ");
        var sameDayLow = await RotateAsync(mount, Today, 51_000);
        var newest = await RotateAsync(mount, Today, 51_200, " ");
        await SetOdometerAsync(car, 52_000);

        Assert.Equal((Today.AddDays(-5), 50_500m, "Front to back"), (older.Date, older.OdometerKm, older.Notes));
        Assert.Null(newest.Notes);
        Assert.Equal([newest.Id, sameDayLow.Id, older.Id], (await tires.ListRotationsAsync(userId, mount)).Select(r => r.Id));
        Assert.Equal(readings, db.OdometerReadings.Count());
        Assert.Equal(new LastTireRotationDto(Today, 51_200m, 800m), (await tires.GetVehicleTiresAsync(userId, car)).Current!.LastRotation);
    }

    [Fact]
    public async Task LastRotation_KmSinceIsZeroWhenTheCarsOdometerIsLower_AndNullsWithoutAny()
    {
        var (car, _, mount) = await MountedAsync(odometer: 50_000);
        var current = (await tires.GetVehicleTiresAsync(userId, car)).Current!;
        Assert.Equal((null, null), (current.LastCheck, current.LastRotation));

        await RotateAsync(mount, Today, 60_000);

        Assert.Equal(0m, (await tires.GetVehicleTiresAsync(userId, car)).Current!.LastRotation!.KmSince);
    }

    [Fact]
    public async Task AddRotation_InvalidValues_HaveTheirCodes()
    {
        var (_, _, mount) = await MountedAsync(odometer: 50_000, daysAgo: 10);

        var below = await Assert.ThrowsAsync<ValidationFailedException>(() => RotateAsync(mount, Today, 49_999.99m));
        Assert.Equal(("tireMount.odometerBeforeMount", 50_000m), (below.Code, below.Extensions["mountOdometerKm"]));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => RotateAsync(mount, Today, 10_000_001)));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => tires.AddRotationAsync(userId, mount, new TireRotationRequest(Today, null, null))));
        Assert.Equal("tireMount.dateBeforeMount", await CodeAsync(() => RotateAsync(mount, Today.AddDays(-11), 50_000)));
        Assert.Equal("tireMount.futureDate", await CodeAsync(() => RotateAsync(mount, Today.AddDays(2), 50_000)));
        Assert.Equal("date.tooEarly", await CodeAsync(() => RotateAsync(mount, new DateOnly(1899, 1, 1), 50_000)));
        Assert.Equal("tireRotation.invalidNotes", await CodeAsync(() => RotateAsync(mount, Today, 50_000, new string('n', TireRotation.MaxNotesLength + 1))));
        await RotateAsync(mount, Today, 50_000, new string('n', TireRotation.MaxNotesLength));
        Assert.Single(db.TireRotations);
    }

    [Fact]
    public async Task AddRotation_101stIsLimitReached()
    {
        var (_, _, mount) = await MountedAsync();
        db.TireRotations.AddRange(Enumerable.Range(0, TireRotation.MaxPerMount).Select(_ => new TireRotation { TireMountId = mount, Date = Today, OdometerKm = 50_000 }));
        await db.SaveChangesAsync();

        Assert.Equal("tireRotation.limitReached", await CodeAsync(() => RotateAsync(mount, Today, 50_000)));
    }

    // --- Criterion 4: cascade ---

    [Fact]
    public async Task DeleteMountOrSet_DeletesItsChecksAndRotations()
    {
        var (car, set, mount) = await MountedAsync();
        await CheckAsync(mount, Today, Wheel(TirePosition.FL, 2));
        await RotateAsync(mount, Today, 50_000);
        await tires.DeleteMountAsync(userId, mount);
        Assert.Equal((0, 0, 0), (db.TireChecks.Count(), db.TireMeasurements.Count(), db.TireRotations.Count()));

        var again = (await MountAsync(car, set, Today, 50_000)).Current!.Id;
        await CheckAsync(again, Today, Wheel(TirePosition.FL, 2));
        await RotateAsync(again, Today, 50_000);
        await tires.DeleteAsync(userId, set);
        Assert.Equal((0, 0, 0), (db.TireChecks.Count(), db.TireMeasurements.Count(), db.TireRotations.Count()));
    }

    /// <summary>Fails the save of a new T like a unique index after a simultaneous request saved first.</summary>
    /// <remarks><paramref name="winner"/>, if given, is the simultaneous request's save, run just before the failure.</remarks>
    private sealed class UniqueIndexInterceptor<T>(Func<Task>? winner = null) : SaveChangesInterceptor where T : class
    {
        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!eventData.Context!.ChangeTracker.Entries<T>().Any(e => e.State == EntityState.Added))
            {
                return result;
            }

            if (winner is not null)
            {
                await winner();
            }

            throw new DbUpdateException("Cannot insert duplicate key row with unique index.");
        }
    }
}
