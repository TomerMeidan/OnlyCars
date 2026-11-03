using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Reports;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;
using static OnlyCars.Domain.TirePosition;

namespace OnlyCars.Tests;

/// <summary>TIRE-2a backend: tires per wheel, Replace, checks and rotations. Criterion numbers refer to the ticket.</summary>
public class TireTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db;
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
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
        tasks = new MaintenanceTaskService(db, vehicles);
        tires = new TireService(db, vehicles, tasks);
    }

    private static DateOnly Ago(int days) => Today.AddDays(-days);

    // The first reading is 400 days back, so the tests' Replace records can sit anywhere after it.
    private async Task<Guid> CarAsync(Guid? owner = null, decimal odometer = 10_000) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest("Mazda", null, null, null, null, null, null, null, null, null, odometer, Ago(400)))).Id;

    private static ReplaceTiresRequest Request(TirePosition[] positions, DateOnly date, decimal km, string brand = "Michelin", decimal? cost = null,
        string? shop = null, string? notes = null, bool confirm = false) =>
        new([.. positions], date, km, brand, "Primacy 4", "205/55 R16", TireSeason.Summer, "DOT AB12 3419", Ago(500), cost, shop, notes, confirm);

    private Task<VehicleTiresDto> ReplaceAsync(Guid car, TirePosition[] positions, DateOnly date, decimal km, string brand = "Michelin",
        decimal? cost = null, string? shop = null) =>
        tires.ReplaceAsync(userId, car, Request(positions, date, km, brand, cost, shop));

    private async Task<Guid> FittedCarAsync(bool spare = false)
    {
        var car = await CarAsync();
        await ReplaceAsync(car, [FL, FR, RL, RR], Ago(300), 12_000);
        if (spare) await ReplaceAsync(car, [Spare], Ago(300), 12_000);
        return car;
    }

    private async Task SetOdometerAsync(Guid car, decimal km)
    {
        (await db.Vehicles.FindAsync(car))!.CurrentOdometerKm = km;
        await db.SaveChangesAsync();
    }

    private Task<TireCheckDto> CheckAsync(Guid car, DateOnly date, params TireCheckItemRequest[] items) =>
        tires.AddCheckAsync(userId, car, new TireCheckRequest(date, [.. items]));

    private static TireCheckItemRequest Wheel(TirePosition p, decimal? bar = null, decimal? mm = null) => new(p, bar, mm);

    private Task<TireRotationDto> RotateAsync(Guid car, DateOnly date, decimal km, params (TirePosition From, TirePosition To)[] moves) =>
        tires.AddRotationAsync(userId, car, new TireRotationRequest(date, km, null, moves.Select(m => new TireRotationMoveRequest(m.From, m.To)).ToList()));

    private static readonly (TirePosition, TirePosition)[] FrontToBack = [(FL, RL), (RL, FL), (FR, RR), (RR, FR)];

    private async Task<Dictionary<TirePosition, Guid>> OnCarAsync(Guid car) =>
        (await tires.GetVehicleTiresAsync(userId, car)).Current.ToDictionary(t => t.Position, t => t.Id);

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    // --- Criterion 2: Replace ---

    [Fact]
    public async Task Replace_EmptyCar_WithoutCostOrShop_FitsTheTires_AndRecordsNoService()
    {
        var car = await CarAsync();

        var result = await ReplaceAsync(car, [FL, FR, RL, RR], Ago(10), 12_000);

        Assert.Equal([FL, FR, RL, RR], result.Current.Select(t => t.Position));
        var fl = result.Current[0];
        Assert.Equal(("Michelin", "Primacy 4", "205/55 R16", TireSeason.Summer, "DOT AB12 3419", Ago(500)),
            (fl.Brand, fl.Model, fl.Size, fl.Season, fl.DotCode, fl.PurchaseDate));
        Assert.Equal((Ago(10), 12_000m, (DateOnly?)null, (decimal?)null, (Guid?)null), (fl.FittedAt, fl.FittedOdometerKm, fl.RemovedAt, fl.RemovedOdometerKm, fl.ServiceRecordId));
        Assert.Equal(0m, fl.KmOnTire); // the car's odometer (10,000) is below the fitted km: zero, not negative
        Assert.Empty(result.Removed);
        Assert.Empty(db.ServiceRecords);
        Assert.Single(db.OdometerReadings); // only the car's first reading
    }

    [Theory]
    [InlineData(new[] { FL })]
    [InlineData(new[] { FR, FL })]
    [InlineData(new[] { RL, RR })]
    [InlineData(new[] { RR, FL, RL, FR })]
    [InlineData(new[] { Spare })]
    public async Task Replace_OneAPairTheFourOrTheSpare_ClosesTheOldOnes_FitsNew_AndCreatesOneRecord(TirePosition[] positions)
    {
        var car = await FittedCarAsync(spare: true);

        var result = await tires.ReplaceAsync(userId, car, Request(positions, Ago(20), 30_000, "Pirelli", 800.5m, " Tire shop ", "Receipt in the glovebox"));

        var record = Assert.Single(await tasks.ListRecordsAsync(userId, car));
        Assert.Equal((Ago(20), 30_000m, "Tire shop", 800.5m, "Receipt in the glovebox"), (record.Date, record.OdometerKm, record.ShopName, record.TotalCost, record.Notes));
        Assert.Empty(record.Tasks);
        Assert.Contains(db.OdometerReadings, r => r.ServiceRecordId == record.Id && r.ValueKm == 30_000);

        Assert.Equal([FL, FR, RL, RR, Spare], result.Current.Select(t => t.Position));
        foreach (var t in result.Current)
        {
            var replaced = positions.Contains(t.Position);
            Assert.Equal(replaced ? "Pirelli" : "Michelin", t.Brand);
            Assert.Equal(replaced ? record.Id : null, t.ServiceRecordId);
            Assert.Equal(replaced ? 0m : 18_000m, t.KmOnTire); // current 30,000 - fitted 12,000 for the old ones
        }

        Assert.Equal(positions.Order(), result.Removed.Select(t => t.Position).Order());
        Assert.All(result.Removed, t => Assert.Equal(("Michelin", Ago(20), 30_000m, 18_000m), (t.Brand, t.RemovedAt, t.RemovedOdometerKm, t.KmOnTire)));
    }

    [Fact]
    public async Task Replace_RecordCountsUnderTiresInReports_AndShowsInHistory()
    {
        var car = await FittedCarAsync();
        await ReplaceAsync(car, [FL, FR], Today, 30_000, cost: 500);

        var report = await new ReportService(db).CostsAsync(userId, Today.Year.ToString(), null);
        var history = await tasks.SearchRecordsAsync(userId, null, null, null, null, null, 0, 10);

        Assert.Equal(((TaskCategory?)TaskCategory.Tires, 500m), (Assert.Single(report.ByCategory).Category, report.ByCategory[0].Total));
        Assert.Equal((1, 500m), (history.TotalCount, history.TotalCost));
    }

    [Fact]
    public async Task Replace_EmptyWheelsWithACostOrAShop_RecordsAService()
    {
        var car = await CarAsync();
        await ReplaceAsync(car, [FL, FR], Ago(20), 12_000, cost: 0);
        await ReplaceAsync(car, [RL, RR], Ago(20), 12_000, shop: "Shop");

        Assert.Equal(2, db.ServiceRecords.Count());
        Assert.All((await tires.GetVehicleTiresAsync(userId, car)).Current, t => Assert.NotNull(t.ServiceRecordId));
    }

    [Fact]
    public async Task KmOnTire_PastAndPresent_FollowTheRemovalOrTheCarsOdometer()
    {
        var car = await CarAsync();
        await ReplaceAsync(car, [FL], Ago(300), 12_000);
        await ReplaceAsync(car, [FL], Ago(200), 20_500);
        await ReplaceAsync(car, [FL], Ago(100), 31_000);
        await SetOdometerAsync(car, 40_000);

        var result = await tires.GetVehicleTiresAsync(userId, car);

        Assert.Equal(9_000m, Assert.Single(result.Current).KmOnTire);
        Assert.Equal([10_500m, 8_500m], result.Removed.Select(t => t.KmOnTire)); // newest removal first
        Assert.Equal([Ago(100), Ago(200)], result.Removed.Select(t => t.RemovedAt!.Value));
    }

    [Theory]
    [InlineData(new TirePosition[0])]
    [InlineData(new[] { FL, RL })]
    [InlineData(new[] { FR, RR })]
    [InlineData(new[] { FL, FL })]
    [InlineData(new[] { FL, FR, Spare })]
    [InlineData(new[] { FL, FR, RL, RR, Spare })]
    [InlineData(new[] { FL, FR, RL })]
    [InlineData(new[] { (TirePosition)7 })]
    public async Task Replace_AnyOtherMix_IsInvalidPositions(TirePosition[] positions)
    {
        var car = await CarAsync();
        Assert.Equal("tire.invalidPositions", await CodeAsync(() => ReplaceAsync(car, positions, Ago(1), 12_000)));
        Assert.Equal("tire.invalidPositions", await CodeAsync(() => tires.ReplaceAsync(userId, car, Request([FL], Ago(1), 1) with { Positions = null })));
        Assert.Empty(db.Tires);
    }

    [Theory]
    [InlineData("", null, null, null, null, "tire.invalidBrand")]
    [InlineData("51", null, null, null, null, "tire.invalidBrand")]
    [InlineData("B", "51", null, null, null, "tire.invalidModel")]
    [InlineData("B", null, "31", null, null, "tire.invalidSize")]
    [InlineData("B", null, null, "21", null, "tire.invalidDotCode")]
    [InlineData("B", null, null, null, "1001", "tire.invalidNotes")]
    public async Task Replace_FieldTooLongOrEmpty_HasItsCode(string brand, string? model, string? size, string? dot, string? notes, string code)
    {
        // A number stands for a string of that many characters.
        static string? S(string? v) => int.TryParse(v, out var n) ? new string('x', n) : v;
        var car = await CarAsync();

        Assert.Equal(code, await CodeAsync(() => tires.ReplaceAsync(userId, car,
            new ReplaceTiresRequest([FL], Ago(1), 12_000, S(brand), S(model), S(size), TireSeason.Summer, S(dot), null, null, null, S(notes)))));
        Assert.Empty(db.Tires);
    }

    [Fact]
    public async Task Replace_AtTheMaxLengths_TrimsAndSaves_SeasonAndDatesHaveTheirCodes()
    {
        var car = await CarAsync();
        var r = new ReplaceTiresRequest([FL], Ago(1), 12_000, " " + new string('b', 50), new string('m', 50), new string('s', 30), TireSeason.AllSeason,
            new string('d', 20), null, null, " ", new string('n', 1000));

        var t = Assert.Single((await tires.ReplaceAsync(userId, car, r)).Current);

        Assert.Equal((50, (DateOnly?)null, (Guid?)null), (t.Brand.Length, t.PurchaseDate, t.ServiceRecordId)); // a blank shop is no shop
        Assert.Equal("tire.invalidSeason", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { Season = null })));
        Assert.Equal("tire.futurePurchaseDate", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { PurchaseDate = Today.AddDays(2) })));
        Assert.Equal("date.tooEarly", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { PurchaseDate = new DateOnly(1899, 12, 31) })));
        Assert.Equal("tire.futureDate", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { Date = Today.AddDays(2) })));
        Assert.Equal("date.tooEarly", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { Date = new DateOnly(1899, 12, 31) })));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { OdometerKm = null })));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { OdometerKm = -1 })));
        Assert.Equal("serviceRecord.invalidCost", await CodeAsync(() => tires.ReplaceAsync(userId, car, r with { Positions = [FR], Cost = 1.001m })));
        Assert.Single(db.Tires);
    }

    [Fact]
    public async Task Replace_DateOrderRules_BeforeTheOldTire_OrAgainstTheReadings_SaveNothing()
    {
        var car = await FittedCarAsync();
        var before = await tires.GetVehicleTiresAsync(userId, car);

        var date = await Assert.ThrowsAsync<ValidationFailedException>(() => ReplaceAsync(car, [FL, FR], Ago(301), 12_000));
        var km = await Assert.ThrowsAsync<ValidationFailedException>(() => ReplaceAsync(car, [RL, RR], Ago(300), 11_999));

        Assert.Equal(("tire.dateBeforeFitted", Ago(300), "FL"), (date.Code, date.Extensions["fittedAt"], date.Extensions["position"]));
        Assert.Equal(("tire.odometerBeforeFitted", 12_000m, "RL"), (km.Code, km.Extensions["fittedOdometerKm"], km.Extensions["position"]));

        // The service record's reading follows the odometer rules, with the same confirmCorrection escape.
        await ReplaceAsync(car, [FL], Ago(100), 30_000);
        var lower = await Assert.ThrowsAsync<ValidationFailedException>(() => ReplaceAsync(car, [FR], Ago(50), 20_000));
        Assert.Equal("odometer.lowerThanPrevious", lower.Code);
        Assert.Single(db.ServiceRecords);
        await tires.ReplaceAsync(userId, car, Request([FR], Ago(50), 20_000, confirm: true));
        Assert.Equal(2, db.ServiceRecords.Count());
        Assert.Equal(before.Current.Count + 2, db.Tires.Count());
    }

    [Fact]
    public async Task Replace_BeforeTheLastRotationThatMovedItsTires_IsDateBeforeRotation_SavesNothing_OtherTiresRotationsDontCount()
    {
        var car = await FittedCarAsync();
        await RotateAsync(car, Ago(30), 15_000, (FL, RL), (RL, FL));
        await RotateAsync(car, Ago(20), 16_000, (FR, RR), (RR, FR));

        // The FL tire came from RL on day -30, so it can't come off FL on day -60.
        var one = await Assert.ThrowsAsync<ValidationFailedException>(() => ReplaceAsync(car, [FL], Ago(60), 14_000));
        var four = await Assert.ThrowsAsync<ValidationFailedException>(() => ReplaceAsync(car, [FL, FR, RL, RR], Ago(25), 15_500));

        Assert.Equal(("tire.dateBeforeRotation", Ago(30)), (one.Code, one.Extensions["latestDate"]));
        Assert.Equal(("tire.dateBeforeRotation", Ago(20)), (four.Code, four.Extensions["latestDate"])); // the newest rotation of the four
        Assert.Equal(4, db.Tires.Count());
        Assert.Empty(db.ServiceRecords);

        // On the rotation's date it saves, and a later rotation of other tires doesn't count.
        await ReplaceAsync(car, [RL], Ago(30), 15_000);
        await ReplaceAsync(car, [FL], Ago(25), 15_500);
        Assert.Equal(6, db.Tires.Count());
    }

    [Fact]
    public async Task Replace_ArchivedCar_IsRejected_ReadsEditsAndDeletesStillWork()
    {
        var car = await FittedCarAsync();
        var fl = (await OnCarAsync(car))[FL];
        await vehicles.ArchiveAsync(userId, car, true);

        Assert.Equal("tire.vehicleArchived", await CodeAsync(() => ReplaceAsync(car, [FL], Ago(1), 20_000)));
        Assert.Equal("tire.vehicleArchived", await CodeAsync(() => CheckAsync(car, Ago(1), Wheel(FL, 2))));
        Assert.Equal("tire.vehicleArchived", await CodeAsync(() => RotateAsync(car, Ago(1), 20_000, FrontToBack)));
        Assert.Equal(4, (await tires.GetVehicleTiresAsync(userId, car)).Current.Count);
        await tires.UpdateAsync(userId, fl, new UpdateTireRequest("Edited", null, null, TireSeason.Winter, null, null, null));
        await tires.DeleteAsync(userId, fl);
        Assert.Equal(3, db.Tires.Count());
    }

    [Fact]
    public async Task Replace_PastTheLimitOf100TiresPerCar_IsLimitReached_RemovedOnesCount()
    {
        var car = await CarAsync();
        db.Tires.AddRange(Enumerable.Range(0, Tire.MaxPerVehicle - 1).Select(_ => new Tire
        {
            VehicleId = car, Brand = "Old", FittedAt = Ago(399), FittedOdometerKm = 0, RemovedAt = Ago(399), RemovedOdometerKm = 0
        }));
        await db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => ReplaceAsync(car, [FL, FR], Ago(1), 12_000));

        Assert.Equal(("tire.limitReached", 100), (error.Code, error.Extensions["max"]));
        await ReplaceAsync(car, [FL], Ago(1), 12_000);
    }

    [Fact]
    public async Task Replace_SimultaneousReplace_IsConcurrencyConflictNotA500()
    {
        var t = new TireTests(new AppDbContext(TestDbContextFactory.Options(Guid.NewGuid().ToString())
            .AddInterceptors(new UniqueIndexInterceptor<Tire>()).Options));
        var car = await t.CarAsync();

        Assert.Equal("concurrency.conflict", await CodeAsync(() => t.ReplaceAsync(car, [FL], Ago(1), 12_000)));
    }

    [Fact]
    public async Task AnotherUsersCarTireOrRotation_IsNotFound()
    {
        var theirs = await CarAsync(otherUserId);
        await tires.ReplaceAsync(otherUserId, theirs, Request([FL, FR, RL, RR], Ago(10), 12_000));
        var tire = (await tires.GetVehicleTiresAsync(otherUserId, theirs)).Current[0].Id;
        var rotation = await tires.AddRotationAsync(otherUserId, theirs, new TireRotationRequest(Ago(5), 12_100, null, [new(FL, FR), new(FR, FL)]));
        await tires.AddCheckAsync(otherUserId, theirs, new TireCheckRequest(Ago(5), [Wheel(FL, 2)]));

        Assert.Equal("vehicle.notFound", await CodeAsync(() => tires.GetVehicleTiresAsync(userId, theirs)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => ReplaceAsync(theirs, [FL], Ago(1), 20_000)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => tires.ListChecksAsync(userId, theirs)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => CheckAsync(theirs, Ago(1), Wheel(FL, 2))));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => tires.DeleteCheckAsync(userId, theirs, Ago(5))));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => tires.ListRotationsAsync(userId, theirs)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => RotateAsync(theirs, Ago(1), 20_000, FrontToBack)));
        Assert.Equal("tire.notFound", await CodeAsync(() => tires.UpdateAsync(userId, tire, new UpdateTireRequest("X", null, null, TireSeason.Summer, null, null, null))));
        Assert.Equal("tire.notFound", await CodeAsync(() => tires.DeleteAsync(userId, tire)));
        Assert.Equal("tireRotation.notFound", await CodeAsync(() => tires.DeleteRotationAsync(userId, rotation.Id)));
        Assert.Equal((4, 1, 1), (db.Tires.Count(), db.TireRotations.Count(), db.TireMeasurements.Count()));
    }

    // --- PUT and DELETE /api/tires/{id} ---

    [Fact]
    public async Task Update_ChangesTheDetailsOnly_OnARemovedTireToo()
    {
        var car = await FittedCarAsync();
        var old = (await OnCarAsync(car))[FL];
        await ReplaceAsync(car, [FL], Ago(100), 20_000);

        var t = await tires.UpdateAsync(userId, old, new UpdateTireRequest(" Nokian ", "Hakka", "195/65 R15", TireSeason.Winter, "DOT 0122", Ago(450), "Old notes"));

        Assert.Equal(("Nokian", "Hakka", "195/65 R15", TireSeason.Winter, "DOT 0122", Ago(450), "Old notes"), (t.Brand, t.Model, t.Size, t.Season, t.DotCode, t.PurchaseDate, t.Notes));
        Assert.Equal((FL, Ago(300), Ago(100), 8_000m, new DateOnly(2022, 1, 3)), (t.Position, t.FittedAt, t.RemovedAt!.Value, t.KmOnTire, t.DotDate!.Value));
        Assert.Equal("tire.invalidBrand", await CodeAsync(() => tires.UpdateAsync(userId, old, new UpdateTireRequest(" ", null, null, TireSeason.Summer, null, null, null))));
    }

    [Fact]
    public async Task Delete_RemovesTheTireAndItsMeasurements_KeepsItsRecord_AndARotatedTireIs409()
    {
        var car = await FittedCarAsync();
        await ReplaceAsync(car, [FL, FR], Ago(100), 20_000, cost: 300);
        var ids = await OnCarAsync(car);
        await CheckAsync(car, Ago(50), Wheel(FL, 2.2m), Wheel(FR, 2.3m));
        await RotateAsync(car, Ago(40), 21_000, (RL, RR), (RR, RL));

        await tires.DeleteAsync(userId, ids[FL]);

        Assert.DoesNotContain(db.Tires, t => t.Id == ids[FL]);
        Assert.Equal(FR, Assert.Single(db.TireMeasurements).Position);
        Assert.Single(db.ServiceRecords);
        Assert.Equal([FR, RL, RR], (await tires.GetVehicleTiresAsync(userId, car)).Current.Select(t => t.Position));
        Assert.Equal("tire.rotated", await CodeAsync(() => tires.DeleteAsync(userId, ids[RL])));
    }

    [Fact]
    public async Task VoidingTheRecord_KeepsItsTires_WithoutTheLink()
    {
        var car = await FittedCarAsync();
        await ReplaceAsync(car, [FL, FR], Ago(100), 20_000, cost: 300);
        var record = Assert.Single(db.ServiceRecords).Id;

        await tasks.VoidAsync(userId, car, record);

        var current = (await tires.GetVehicleTiresAsync(userId, car)).Current;
        Assert.Equal(4, current.Count);
        Assert.All(current, t => Assert.Null(t.ServiceRecordId));
    }

    [Theory]
    [InlineData("DOT AB12 3419", "2019-08-19")]
    [InlineData("0101", "2001-01-01")]
    [InlineData("5320", "2020-12-28")]
    [InlineData("0024", null)]
    [InlineData("5424", null)]
    [InlineData("419", null)]
    [InlineData("DOT 12X4", null)]
    [InlineData(null, null)]
    public void DotDate_IsTheMondayOfTheDotWeek(string? dot, string? expected) =>
        Assert.Equal(expected is null ? null : DateOnly.Parse(expected), TireService.DotDate(dot));

    // --- Criterion 3: checks ---

    [Fact]
    public async Task AddCheck_AttachesEachMeasurementToTheTireOnThatWheel_AndShowsAsLatest()
    {
        var car = await FittedCarAsync(spare: true);
        var ids = await OnCarAsync(car);

        var check = await CheckAsync(car, Ago(5), Wheel(Spare, 3.5m), Wheel(FL, 2.25m), Wheel(RR, null, 6.5m));

        Assert.Equal(Ago(5), check.MeasuredAt);
        Assert.Equal([new TireCheckItemDto(ids[FL], FL, 2.25m, null), new TireCheckItemDto(ids[RR], RR, null, 6.5m), new TireCheckItemDto(ids[Spare], Spare, 3.5m, null)],
            check.Items);
        var result = await tires.GetVehicleTiresAsync(userId, car);
        Assert.Equal(Ago(5), result.LastCheckDate);
        Assert.Equal(new TireMeasurementDto(Ago(5), FL, 2.25m, null), result.Current[0].LatestMeasurement);
        Assert.Null(result.Current[1].LatestMeasurement);

        // Another wheel on the same date joins that date's check.
        var joined = await CheckAsync(car, Ago(5), Wheel(FR, 2.3m));
        Assert.Equal([FL, FR, RR, Spare], joined.Items.Select(i => i.Position));
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
        var car = await FittedCarAsync();

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => CheckAsync(car, Ago(1), Wheel(FL, 2), Wheel(FR, (decimal?)bar, (decimal?)mm)));

        Assert.Equal((code, 1), (error.Code, error.Extensions["index"]));
        Assert.Empty(db.TireMeasurements);
    }

    [Fact]
    public async Task AddCheck_BoundsSave_AndShapeAndWheelErrorsHaveTheirCodes()
    {
        var car = await FittedCarAsync();
        await CheckAsync(car, Ago(1), Wheel(FL, 0.5m, 0), Wheel(FR, 6.0m, 20));

        Assert.Equal("tireMeasurement.empty", await CodeAsync(() => tires.AddCheckAsync(userId, car, new TireCheckRequest(Ago(2), null))));
        Assert.Equal("tireMeasurement.empty", await CodeAsync(() => tires.AddCheckAsync(userId, car, new TireCheckRequest(Ago(2), []))));
        Assert.Equal("tireMeasurement.invalidPosition", await CodeAsync(() => CheckAsync(car, Ago(2), new TireCheckItemRequest(null, 2, null))));
        Assert.Equal("tireMeasurement.duplicatePosition", await CodeAsync(() => CheckAsync(car, Ago(2), Wheel(FL, 2), Wheel(FL, 2.1m))));
        var noTire = await Assert.ThrowsAsync<ValidationFailedException>(() => CheckAsync(car, Ago(2), Wheel(FL, 2), Wheel(Spare, 2)));
        Assert.Equal(("tireMeasurement.noTire", 1, "Spare"), (noTire.Code, noTire.Extensions["index"], noTire.Extensions["position"]));
        var early = await Assert.ThrowsAsync<ValidationFailedException>(() => CheckAsync(car, Ago(301), Wheel(FL, 2)));
        Assert.Equal(("tire.dateBeforeFitted", Ago(300), 0), (early.Code, early.Extensions["fittedAt"], early.Extensions["index"]));
        Assert.Equal("tire.futureDate", await CodeAsync(() => CheckAsync(car, Today.AddDays(2), Wheel(FL, 2))));
        Assert.Equal("date.tooEarly", await CodeAsync(() => CheckAsync(car, new DateOnly(1899, 12, 31), Wheel(FL, 2))));
        Assert.Equal(Today, (await tires.AddCheckAsync(userId, car, new TireCheckRequest(null, [Wheel(FL, 2)]))).MeasuredAt);
        Assert.Equal(3, db.TireMeasurements.Count());
    }

    [Fact]
    public async Task AddCheck_ATireAlreadyMeasuredThatDate_Is409_ANewTireOnTheWheelIsNot()
    {
        var car = await FittedCarAsync();
        await CheckAsync(car, Ago(5), Wheel(FL, 2));

        var error = await Assert.ThrowsAsync<ConflictException>(() => CheckAsync(car, Ago(5), Wheel(FR, 2), Wheel(FL, 2.1m)));

        Assert.Equal(("tireMeasurement.duplicate", Ago(5)), (error.Code, error.Extensions["measuredAt"]));
        await ReplaceAsync(car, [FL], Ago(5), 20_000);
        var check = await CheckAsync(car, Ago(5), Wheel(FL, 2.4m));
        Assert.Equal(2, check.Items.Count(i => i.Position == FL)); // the removed tire's and the new one's
    }

    [Fact]
    public async Task AddCheck_SimultaneousCheckOfTheSameTire_Is409NotA500()
    {
        // Two requests: `first` saves an FL check while `second`, past its "already measured" query, is saving its own.
        var root = new Microsoft.EntityFrameworkCore.Storage.InMemoryDatabaseRoot();
        var name = Guid.NewGuid().ToString();
        var first = new TireTests(new AppDbContext(TestDbContextFactory.Options(name, root).Options));
        var car = await first.FittedCarAsync();
        var second = new AppDbContext(TestDbContextFactory.Options(name, root)
            .AddInterceptors(new UniqueIndexInterceptor<TireMeasurement>(() => first.CheckAsync(car, Today, Wheel(FL, 2.2m)))).Options);
        var service = new TireService(second, new VehicleService(second), new MaintenanceTaskService(second, new VehicleService(second)));

        var error = await Assert.ThrowsAsync<ConflictException>(() => service.AddCheckAsync(first.userId, car, new TireCheckRequest(Today, [Wheel(FL, 2.4m)])));

        Assert.Equal(("tireMeasurement.duplicate", Today), (error.Code, error.Extensions["measuredAt"]));
        Assert.Equal(2.2m, Assert.Single(Assert.Single(await first.tires.ListChecksAsync(first.userId, car)).Items).PressureBar);
    }

    [Fact]
    public async Task AddCheck_SaveFailureWithNoMeasurementOnThatDate_IsRethrownNotA409()
    {
        var t = new TireTests(new AppDbContext(TestDbContextFactory.Options(Guid.NewGuid().ToString())
            .AddInterceptors(new UniqueIndexInterceptor<TireMeasurement>()).Options));
        var car = await t.FittedCarAsync();

        await Assert.ThrowsAsync<DbUpdateException>(() => t.CheckAsync(car, Today, Wheel(FL, 2)));
    }

    [Fact]
    public async Task DeleteCheck_RemovesEveryMeasurementOfThatDate_RemovedTiresToo_AndNothingElse()
    {
        var car = await FittedCarAsync();
        await CheckAsync(car, Ago(10), Wheel(FL, 2), Wheel(FR, 2));
        await ReplaceAsync(car, [FL], Ago(10), 20_000);
        await CheckAsync(car, Ago(10), Wheel(FL, 2.5m));
        await CheckAsync(car, Ago(9), Wheel(FL, 2.4m));

        await tires.DeleteCheckAsync(userId, car, Ago(10));

        Assert.Equal(Ago(9), Assert.Single(await tires.ListChecksAsync(userId, car)).MeasuredAt);
        Assert.Equal("tireMeasurement.notFound", await CodeAsync(() => tires.DeleteCheckAsync(userId, car, Ago(10))));
    }

    [Fact]
    public async Task Checks_1001stOfATireIsLimitReached_AndTheListIsTheNewest50Dates()
    {
        var car = await FittedCarAsync();
        var fl = (await OnCarAsync(car))[FL];
        db.TireMeasurements.AddRange(Enumerable.Range(1, TireMeasurement.MaxPerTire)
            .Select(n => new TireMeasurement { TireId = fl, Position = FL, MeasuredAt = Today.AddDays(-n - 1000), PressureBar = 2 }));
        await db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => CheckAsync(car, Ago(1), Wheel(FR, 2), Wheel(FL, 2)));

        Assert.Equal(("tireMeasurement.limitReached", 1000), (error.Code, error.Extensions["max"]));
        await CheckAsync(car, Ago(1), Wheel(FR, 2));
        var list = await tires.ListChecksAsync(userId, car);
        Assert.Equal(TireService.MaxCheckDatesListed, list.Count);
        Assert.Equal(Ago(1), list[0].MeasuredAt);
        Assert.Equal(Today.AddDays(-1049), list[^1].MeasuredAt);
    }

    // --- Criterion 3: rotations ---

    [Fact]
    public async Task AddRotation_MovesTheTires_ListsNewestFirstWithMoves_AddsNoReading_AndShowsAsLast()
    {
        var car = await FittedCarAsync();
        var ids = await OnCarAsync(car);
        var readings = db.OdometerReadings.Count();

        var rotation = await tires.AddRotationAsync(userId, car, new TireRotationRequest(Ago(30), 15_000, " At home ",
            FrontToBack.Select(m => new TireRotationMoveRequest(m.Item1, m.Item2)).ToList()));
        await SetOdometerAsync(car, 16_000);

        Assert.Equal(("At home", 4), (rotation.Notes, rotation.Moves.Count));
        Assert.Equal(new TireRotationMoveDto(ids[FL], FL, RL), rotation.Moves[0]);
        var now = await OnCarAsync(car);
        Assert.Equal((ids[RL], ids[FL], ids[RR], ids[FR]), (now[FL], now[RL], now[FR], now[RR]));
        var result = await tires.GetVehicleTiresAsync(userId, car);
        Assert.Equal(new LastTireRotationDto(rotation.Id, Ago(30), 15_000, 1_000), result.LastRotation);
        Assert.Equal(readings, db.OdometerReadings.Count());

        var cross = await RotateAsync(car, Ago(30), 15_100, (FL, RR), (RR, FL));
        Assert.Equal([cross.Id, rotation.Id], (await tires.ListRotationsAsync(userId, car)).Select(r => r.Id)); // same date: the later first
    }

    [Fact]
    public async Task AddRotation_TheSpareMaySwapIn()
    {
        var car = await FittedCarAsync(spare: true);
        var ids = await OnCarAsync(car);

        await RotateAsync(car, Ago(30), 15_000, (FL, Spare), (Spare, FL));

        var now = await OnCarAsync(car);
        Assert.Equal((ids[Spare], ids[FL]), (now[FL], now[Spare]));
    }

    public static TheoryData<TirePosition?[]> BadMoves => new()
    {
        new TirePosition?[0],
        new TirePosition?[] { FL, RL }, // RL left empty
        new TirePosition?[] { FL, RL, FR, RL }, // RL twice as a to
        new TirePosition?[] { FL, RL, FL, FR, RL, FL }, // FL twice as a from
        new TirePosition?[] { FL, FL }, // a tire to its own wheel
        new TirePosition?[] { FL, RL, RL, FL, FR, FR }, // a swap and a tire left in place
        new TirePosition?[] { null, RL, RL, FL },
        new TirePosition?[] { FL, (TirePosition)9, (TirePosition)9, FL },
    };

    [Theory]
    [MemberData(nameof(BadMoves))]
    public async Task AddRotation_NotAPermutation_IsInvalidMoves(TirePosition?[] pairs)
    {
        var car = await FittedCarAsync();
        var moves = pairs.Chunk(2).Select(p => new TireRotationMoveRequest(p[0], p[1])).ToList();

        Assert.Equal("tireRotation.invalidMoves", await CodeAsync(() => tires.AddRotationAsync(userId, car, new TireRotationRequest(Ago(1), 20_000, null, moves))));
        Assert.Equal("tireRotation.invalidMoves", await CodeAsync(() => tires.AddRotationAsync(userId, car, new TireRotationRequest(Ago(1), 20_000, null, null))));
        Assert.Empty(db.TireRotations);
    }

    [Fact]
    public async Task AddRotation_AWheelWithoutATire_DateAndValueRules_HaveTheirCodes()
    {
        var car = await FittedCarAsync();

        var noTire = await Assert.ThrowsAsync<ValidationFailedException>(() => RotateAsync(car, Ago(1), 20_000, (FL, Spare), (Spare, FL)));
        Assert.Equal(("tireRotation.noTire", 1, "Spare"), (noTire.Code, noTire.Extensions["index"], noTire.Extensions["position"]));
        Assert.Equal("tire.dateBeforeFitted", await CodeAsync(() => RotateAsync(car, Ago(301), 20_000, FrontToBack)));
        Assert.Equal("tire.futureDate", await CodeAsync(() => RotateAsync(car, Today.AddDays(2), 20_000, FrontToBack)));
        Assert.Equal("odometer.invalidValue", await CodeAsync(() => tires.AddRotationAsync(userId, car, new TireRotationRequest(Ago(1), null, null, [new(FL, FR), new(FR, FL)]))));
        Assert.Equal("tireRotation.invalidNotes", await CodeAsync(() => tires.AddRotationAsync(userId, car,
            new TireRotationRequest(Ago(1), 20_000, new string('n', 501), [new(FL, FR), new(FR, FL)]))));

        await RotateAsync(car, Ago(10), 20_000, FrontToBack);
        var before = await Assert.ThrowsAsync<ValidationFailedException>(() => RotateAsync(car, Ago(11), 20_000, FrontToBack));
        Assert.Equal(("tireRotation.beforeLatest", Ago(10)), (before.Code, before.Extensions["latestDate"]));
        Assert.Single(db.TireRotations);
    }

    [Fact]
    public async Task AddRotation_201stIsLimitReached()
    {
        var car = await FittedCarAsync();
        db.TireRotations.AddRange(Enumerable.Range(0, TireRotation.MaxPerVehicle).Select(_ => new TireRotation { VehicleId = car, Date = Ago(200), OdometerKm = 0 }));
        await db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => RotateAsync(car, Ago(1), 20_000, FrontToBack));

        Assert.Equal(("tireRotation.limitReached", 200), (error.Code, error.Extensions["max"]));
    }

    [Fact]
    public async Task DeleteRotation_OnlyTheNewest_PutsTheTiresBack()
    {
        var car = await FittedCarAsync();
        var ids = await OnCarAsync(car);
        var first = await RotateAsync(car, Ago(30), 15_000, FrontToBack);
        var second = await RotateAsync(car, Ago(20), 16_000, (FL, FR), (FR, FL));

        Assert.Equal("tireRotation.notLatest", await CodeAsync(() => tires.DeleteRotationAsync(userId, first.Id)));
        await tires.DeleteRotationAsync(userId, second.Id);
        var afterFirst = await OnCarAsync(car);
        Assert.Equal((ids[RL], ids[FL]), (afterFirst[FL], afterFirst[RL]));
        await tires.DeleteRotationAsync(userId, first.Id);

        Assert.Equal(ids, await OnCarAsync(car));
        Assert.Empty(db.TireRotations);
        Assert.Empty(db.TireRotationMoves);
        Assert.Null((await tires.GetVehicleTiresAsync(userId, car)).LastRotation);
    }

    [Fact]
    public async Task DeleteRotation_WhoseTireWasRemovedSince_Is409_AWithoutMovesOneJustGoes()
    {
        var car = await FittedCarAsync();
        var rotation = await RotateAsync(car, Ago(30), 15_000, FrontToBack);
        await ReplaceAsync(car, [FL], Ago(20), 16_000);

        Assert.Equal("tireRotation.tireRemoved", await CodeAsync(() => tires.DeleteRotationAsync(userId, rotation.Id)));

        // A migrated rotation ("Wheels not recorded") has no moves.
        var migrated = new TireRotation { VehicleId = car, Date = Ago(10), OdometerKm = 17_000 };
        db.TireRotations.Add(migrated);
        await db.SaveChangesAsync();
        Assert.Empty(Assert.Single(await tires.ListRotationsAsync(userId, car), r => r.Id == migrated.Id).Moves);
        await tires.DeleteRotationAsync(userId, migrated.Id);
        Assert.Equal(rotation.Id, Assert.Single(db.TireRotations).Id);
    }

    [Fact]
    public async Task LastRotation_KmSinceIsZeroWhenTheCarsOdometerIsLower()
    {
        var car = await FittedCarAsync();
        await RotateAsync(car, Ago(30), 50_000, FrontToBack);

        Assert.Equal(0m, (await tires.GetVehicleTiresAsync(userId, car)).LastRotation!.KmSince);
    }

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
