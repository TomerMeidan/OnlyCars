using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Reports;
using OnlyCars.Application.Reports.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>RPT-1: GET /api/reports/costs.</summary>
public class CostReportTests
{
    private const int Year = 2025;
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly ReportService reports;
    private readonly Guid userId = Guid.NewGuid();

    public CostReportTests()
    {
        vehicles = new VehicleService(db);
        reports = new ReportService(db);
    }

    // Starts at 50,000 km (its first reading).
    private async Task<Guid> CarAsync(string nickname, decimal? purchasePrice = null, Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            nickname, null, null, null, null, null, null, null, purchasePrice, null, 50_000, new DateOnly(2024, 1, 1)))).Id;

    private async Task RecordAsync(Guid car, DateOnly date, decimal? cost, bool voided = false, params TaskCategory[] categories)
    {
        var record = new ServiceRecord { VehicleId = car, Date = date, OdometerKm = 50_000, TotalCost = cost, IsVoided = voided };
        foreach (var c in categories)
        {
            var task = new MaintenanceTask { VehicleId = car, Name = c.ToString(), Category = c, LastDoneDate = date };
            record.Tasks.Add(new ServiceRecordTask { MaintenanceTask = task });
        }
        db.ServiceRecords.Add(record);
        await db.SaveChangesAsync();
    }

    private Task<CostReportDto> CostsAsync(Guid? vehicleId = null, Guid? owner = null, string year = "2025") =>
        reports.CostsAsync(owner ?? userId, year, vehicleId);

    private static void AssertSumsMatch(CostReportDto r)
    {
        Assert.Equal(12, r.ByMonth.Count);
        Assert.Equal(r.Total, r.ByMonth.Sum(m => m.Total));
        Assert.Equal(r.RecordCount, r.ByMonth.Sum(m => m.RecordCount));
        Assert.Equal(r.Total, r.ByCategory.Sum(c => c.Total));
        Assert.Equal(r.Total, r.ByVehicle.Sum(v => v.Total));
    }

    [Fact]
    public async Task OneRecordOnTwoCategories_IsSplitEqually()
    {
        var car = await CarAsync("A");
        await RecordAsync(car, new DateOnly(Year, 3, 5), 300, false, TaskCategory.Oil, TaskCategory.Brakes);

        var r = await CostsAsync();

        Assert.Equal([(TaskCategory?)TaskCategory.Brakes, TaskCategory.Oil], r.ByCategory.Select(c => c.Category).OrderBy(c => c.ToString()));
        Assert.All(r.ByCategory, c => Assert.Equal(150m, c.Total));
        AssertSumsMatch(r);
    }

    [Fact]
    public async Task Split_OneCategory_NoTasks_DuplicateCategories_AndTheRemainderOnTheFirstByName()
    {
        var car = await CarAsync("A");
        await RecordAsync(car, new DateOnly(Year, 1, 1), 50, false, TaskCategory.Fluids);
        await RecordAsync(car, new DateOnly(Year, 1, 2), 40);
        // Two Oil tasks are one category; 100 over Tires, Oil and Battery is 33.33 each with the extra cent on Battery.
        await RecordAsync(car, new DateOnly(Year, 2, 1), 100, false, TaskCategory.Tires, TaskCategory.Oil, TaskCategory.Oil, TaskCategory.Battery);

        var r = await CostsAsync();

        var byCat = r.ByCategory.ToDictionary(c => c.Category?.ToString() ?? "none", c => c.Total);
        Assert.Equal(new Dictionary<string, decimal>
        {
            ["Fluids"] = 50, ["none"] = 40, ["Battery"] = 33.34m, ["Oil"] = 33.33m, ["Tires"] = 33.33m
        }, byCat);
        Assert.Equal([50m, 40m, 33.34m, 33.33m, 33.33m], r.ByCategory.Select(c => c.Total));
        Assert.Equal(190m, r.Total);
        AssertSumsMatch(r);
    }

    [Fact]
    public async Task VoidedNeverCount_UnpricedCountAsZero_ArchivedCarsCount()
    {
        var a = await CarAsync("A");
        var archived = await CarAsync("Old");
        await RecordAsync(a, new DateOnly(Year, 4, 1), 100, false, TaskCategory.Oil);
        await RecordAsync(a, new DateOnly(Year, 4, 2), 999, voided: true, TaskCategory.Oil);
        await RecordAsync(a, new DateOnly(2024, 4, 2), 999, voided: true);
        await RecordAsync(a, new DateOnly(Year, 4, 3), null, false, TaskCategory.Brakes);
        await RecordAsync(archived, new DateOnly(Year, 5, 1), 60);
        await vehicles.ArchiveAsync(userId, archived, true);

        var r = await CostsAsync();

        Assert.Equal((160m, 3, 1), (r.Total, r.RecordCount, r.UnpricedCount));
        Assert.Equal([new CostYearDto(Year, 160, 3)], r.Years);
        Assert.Equal((100m, 2), (r.ByMonth[3].Total, r.ByMonth[3].RecordCount));
        // The unpriced Brakes record adds 0, so Brakes is left out.
        Assert.DoesNotContain(r.ByCategory, c => c.Category == TaskCategory.Brakes);
        Assert.Equal([(archived, true, 60m), (a, false, 100m)],
            r.ByVehicle.Select(v => (v.VehicleId, v.IsArchived, v.Total)).OrderBy(v => v.Total));
        Assert.Equal(60m, r.Cars.Single(c => c.VehicleId == archived).ServiceTotal);
        AssertSumsMatch(r);
    }

    [Fact]
    public async Task AYearWithNoRecords_HasTwelveZeroMonths_AndYearsAreNewestFirst()
    {
        var car = await CarAsync("A");
        await RecordAsync(car, new DateOnly(2023, 6, 1), 10);
        await RecordAsync(car, new DateOnly(2024, 6, 1), 20);
        await RecordAsync(car, new DateOnly(2024, 7, 1), 5);

        var r = await CostsAsync();

        Assert.Equal(Enumerable.Range(1, 12), r.ByMonth.Select(m => m.Month));
        Assert.All(r.ByMonth, m => Assert.Equal((0m, 0), (m.Total, m.RecordCount)));
        Assert.Equal((0m, 0, 0), (r.Total, r.RecordCount, r.UnpricedCount));
        Assert.Empty(r.ByCategory);
        Assert.Empty(r.ByVehicle);
        Assert.Equal([new CostYearDto(2024, 25, 2), new CostYearDto(2023, 10, 1)], r.Years);
        // Cars is all time.
        Assert.Equal(35m, r.Cars.Single().ServiceTotal);
    }

    [Fact]
    public async Task Cars_KmDrivenFromTheFirstReading_CostPerKm_AndTco()
    {
        var a = await CarAsync("A", purchasePrice: 20_000);
        var b = await CarAsync("B");
        // An earlier-dated reading saved later is the first one.
        db.OdometerReadings.Add(new OdometerReading { VehicleId = a, ValueKm = 40_000, ReadingDate = new DateOnly(2023, 1, 1) });
        var car = await db.Vehicles.FindAsync(a);
        car!.CurrentOdometerKm = 60_000;
        await db.SaveChangesAsync();
        await RecordAsync(a, new DateOnly(2023, 6, 1), 500);
        await RecordAsync(a, new DateOnly(Year, 6, 1), 1_000);
        await RecordAsync(b, new DateOnly(Year, 6, 1), 300);

        var r = await CostsAsync();

        var ca = r.Cars.Single(c => c.VehicleId == a);
        Assert.Equal((1_500m, 20_000m, (decimal?)0.075m, (decimal?)20_000m, (decimal?)21_500m),
            (ca.ServiceTotal, ca.KmDriven, ca.CostPerKm, ca.PurchasePrice, ca.TotalCostOfOwnership));
        var cb = r.Cars.Single(c => c.VehicleId == b);
        Assert.Equal((300m, 0m, (decimal?)null, (decimal?)null, (decimal?)null),
            (cb.ServiceTotal, cb.KmDriven, cb.CostPerKm, cb.PurchasePrice, cb.TotalCostOfOwnership));
    }

    [Fact]
    public async Task WithAVehicle_EveryBlockHoldsThatCarOnly()
    {
        var a = await CarAsync("A");
        var b = await CarAsync("B");
        await RecordAsync(a, new DateOnly(Year, 1, 1), 100, false, TaskCategory.Oil);
        await RecordAsync(b, new DateOnly(Year, 1, 1), 70, false, TaskCategory.Brakes);
        await RecordAsync(b, new DateOnly(2024, 1, 1), 7);

        var r = await CostsAsync(vehicleId: a);

        Assert.Equal([new CostYearDto(Year, 100, 1)], r.Years);
        Assert.Equal(100m, r.Total);
        Assert.Equal([new CostCategoryDto(TaskCategory.Oil, 100)], r.ByCategory);
        Assert.Equal([a], r.ByVehicle.Select(v => v.VehicleId));
        Assert.Equal([a], r.Cars.Select(c => c.VehicleId));
        AssertSumsMatch(r);
    }

    [Fact]
    public async Task AnotherUsersCar_Is404_AndTheirRecordsNeverCount()
    {
        var mine = await CarAsync("Mine");
        var theirs = await CarAsync("Theirs", owner: Guid.NewGuid());
        await RecordAsync(mine, new DateOnly(Year, 1, 1), 10);
        await RecordAsync(theirs, new DateOnly(Year, 1, 1), 500, false, TaskCategory.Oil);
        await RecordAsync(theirs, new DateOnly(2024, 1, 1), 500);

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => CostsAsync(vehicleId: theirs))).Code);
        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => CostsAsync(vehicleId: Guid.NewGuid()))).Code);

        var r = await CostsAsync();
        Assert.Equal([new CostYearDto(Year, 10, 1)], r.Years);
        Assert.Equal(10m, r.Total);
        Assert.Equal([(TaskCategory?)null], r.ByCategory.Select(c => c.Category));
        Assert.Equal([mine], r.ByVehicle.Select(v => v.VehicleId));
        Assert.Equal([mine], r.Cars.Select(c => c.VehicleId));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("2025.5")]
    [InlineData("-2025")]
    [InlineData(" 2025")]
    [InlineData("1899")]
    [InlineData("99999999999")]
    public async Task ABadYear_IsInvalidYear(string? year)
    {
        await CarAsync("A");
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => reports.CostsAsync(userId, year, null));
        Assert.Equal("report.invalidYear", ex.Code);
    }

    [Fact]
    public async Task TheYearBounds_1900AndThisYear_AreValid_TheYearAfterTomorrowsIsNot()
    {
        var thisYear = DateTime.UtcNow.Year;
        Assert.Equal(1900, (await CostsAsync(year: "1900")).Year);
        Assert.Equal(thisYear, (await CostsAsync(year: thisYear.ToString())).Year);
        // A day of slack past UTC: next year is valid only on Dec 31 UTC.
        var tomorrowYear = DateTime.UtcNow.AddDays(1).Year;
        await Assert.ThrowsAsync<ValidationFailedException>(() => CostsAsync(year: (tomorrowYear + 1).ToString()));
    }

    [Fact]
    public async Task NoCars_IsEmpty()
    {
        var r = await CostsAsync();
        Assert.Empty(r.Years);
        Assert.Empty(r.Cars);
        Assert.Equal(12, r.ByMonth.Count);
    }
}
