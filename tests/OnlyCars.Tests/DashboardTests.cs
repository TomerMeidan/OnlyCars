using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP4-A B1: GET /api/dashboard.</summary>
public class DashboardTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly MonthStart = new(Today.Year, Today.Month, 1);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public DashboardTests()
    {
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    // Starts at 50,000 km.
    private async Task<Guid> CarAsync(string nickname, Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            nickname, "Mazda", "3", 2018, null, null, null, null, null, null, 50_000))).Id;

    // 5,000 km interval, no time interval, default due soon at 10% (500 km) left; the car is at 50,000.
    private async Task<MaintenanceTaskDto> TaskAsync(Guid car, string name, decimal lastKm, Guid? owner = null) =>
        await tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(null, name, "Oil", 5_000, null, lastKm, Today));

    private Task<MaintenanceTaskDto> OverdueAsync(Guid car, string name, decimal usedKm = 6_000) => TaskAsync(car, name, 50_000 - usedKm);
    private Task<MaintenanceTaskDto> DueSoonAsync(Guid car, string name, decimal usedKm = 4_700) => TaskAsync(car, name, 50_000 - usedKm);
    private Task<MaintenanceTaskDto> OkAsync(Guid car, string name, decimal usedKm = 1_000) => TaskAsync(car, name, 50_000 - usedKm);

    private async Task SeedRecordAsync(Guid car, DateOnly date, decimal? cost, bool voided = false)
    {
        db.ServiceRecords.Add(new ServiceRecord { VehicleId = car, Date = date, OdometerKm = 45_000, TotalCost = cost, IsVoided = voided });
        await db.SaveChangesAsync();
    }

    private Task<DashboardDto> DashboardAsync(DateOnly? today = null, Guid? owner = null) => tasks.DashboardAsync(owner ?? userId, today);

    [Fact]
    public async Task Counts_MatchTheTaskListOfEachCar_AndDisabledTasksNeverCount()
    {
        var a = await CarAsync("A");
        await OverdueAsync(a, "Oil");
        await DueSoonAsync(a, "Brakes");
        await OkAsync(a, "Tires");
        var b = await CarAsync("B");
        await OverdueAsync(b, "Oil");
        var disabled = await OverdueAsync(b, "Coolant");
        await tasks.UpdateAsync(userId, b, disabled.Id, new UpdateMaintenanceTaskRequest(
            "Coolant", "Oil", 5_000, null, 44_000, Today, IsEnabled: false));

        var dash = await DashboardAsync();

        Assert.Equal((2, 1), (dash.OverdueCount, dash.DueSoonCount));
        foreach (var card in dash.Vehicles)
        {
            var list = (await tasks.ListAsync(userId, card.Id)).Where(t => t.IsEnabled).ToList();
            Assert.Equal(list.Count(t => t.Status == DueStatus.Overdue), card.OverdueCount);
            Assert.Equal(list.Count(t => t.Status == DueStatus.DueSoon), card.DueSoonCount);
            Assert.Equal(list.Select(t => t.Id).Order(), card.Tasks.Select(t => t.Id).Order());
        }
        Assert.DoesNotContain(dash.Vehicles.SelectMany(v => v.Tasks), t => t.Id == disabled.Id);
    }

    [Fact]
    public async Task Tasks_AreInUrgencyOrder_ThenProgress_ThenName()
    {
        var car = await CarAsync("Car");
        var ok = await OkAsync(car, "A ok");
        var dueSoon = await DueSoonAsync(car, "B soon");
        var overdueLess = await OverdueAsync(car, "C late", usedKm: 5_500);
        var overdueMore = await OverdueAsync(car, "D later", usedKm: 7_000);
        var tieZ = await OkAsync(car, "Z tie");
        var tieM = await OkAsync(car, "M tie");

        var card = Assert.Single((await DashboardAsync()).Vehicles);

        Assert.Equal([overdueMore.Id, overdueLess.Id, dueSoon.Id, ok.Id, tieM.Id, tieZ.Id], card.Tasks.Select(t => t.Id));
        Assert.Equal(("Car", "Mazda", "3", 2018, 50_000m), (card.Nickname, card.Make, card.Model, card.Year, card.CurrentOdometerKm));
    }

    [Fact]
    public async Task Vehicles_AreOrderedByTheirFirstTask_ThenNickname_AndCarsWithoutTasksComeLast()
    {
        var empty = await CarAsync("Aaa empty");
        var okCar = await CarAsync("Bbb ok");
        await OkAsync(okCar, "Oil");
        var soonCar = await CarAsync("Ccc soon");
        await DueSoonAsync(soonCar, "Oil");
        var lateZ = await CarAsync("Zed late");
        await OverdueAsync(lateZ, "Oil");
        var lateY = await CarAsync("Yak late");
        await OverdueAsync(lateY, "Oil");
        var lateMost = await CarAsync("Xen later");
        await OverdueAsync(lateMost, "Oil", usedKm: 9_000);

        var dash = await DashboardAsync();

        Assert.Equal([lateMost, lateY, lateZ, soonCar, okCar, empty], dash.Vehicles.Select(v => v.Id));
        Assert.Empty(dash.Vehicles[^1].Tasks);
    }

    [Fact]
    public async Task ArchivedCar_IsLeftOutOfCountsAndVehicles_ButItsRecordsAreInTheSpend()
    {
        var active = await CarAsync("Active");
        await OverdueAsync(active, "Oil");
        var archived = await CarAsync("Archived");
        await OverdueAsync(archived, "Oil");
        await DueSoonAsync(archived, "Brakes");
        await SeedRecordAsync(active, Today, 100.50m);
        await SeedRecordAsync(archived, Today, 200m);
        await vehicles.ArchiveAsync(userId, archived, true);

        var dash = await DashboardAsync();

        Assert.Equal((1, 0), (dash.OverdueCount, dash.DueSoonCount));
        Assert.Equal([active], dash.Vehicles.Select(v => v.Id));
        Assert.Equal((300.50m, 2), (dash.MonthTotalCost, dash.MonthServiceCount));
    }

    [Fact]
    public async Task Spend_LeavesOutVoidedAndOtherMonths_CountsNullCostAsZero_AndMatchesTheHistorySearch()
    {
        var car = await CarAsync("Car");
        await SeedRecordAsync(car, MonthStart, 10m);              // first of the month: in
        await SeedRecordAsync(car, Today, null);                  // no cost: counted, adds 0
        await SeedRecordAsync(car, Today, 1_000m, voided: true);  // voided: out
        await SeedRecordAsync(car, MonthStart.AddDays(-1), 20m);  // last day of the previous month: out
        await SeedRecordAsync(car, Today.AddDays(1), 40m);        // after today: out

        var dash = await DashboardAsync(Today);
        var history = await tasks.SearchRecordsAsync(userId, null, null, MonthStart, Today, null, 0, 50);

        Assert.Equal(Today.ToString("yyyy-MM"), dash.Month);
        Assert.Equal((10m, 2), (dash.MonthTotalCost, dash.MonthServiceCount));
        Assert.Equal((history.TotalCost, history.TotalCount), (dash.MonthTotalCost, dash.MonthServiceCount));
    }

    [Fact]
    public async Task Today_SetsTheSpendMonth_AndDefaultsToUtcToday()
    {
        var car = await CarAsync("Car");
        var yesterday = Today.AddDays(-1);
        await SeedRecordAsync(car, yesterday, 5m);

        var asYesterday = await DashboardAsync(yesterday);
        Assert.Equal(yesterday.ToString("yyyy-MM"), asYesterday.Month);
        Assert.Equal(5m, asYesterday.MonthTotalCost);

        var byDefault = await DashboardAsync();
        Assert.Equal(Today.ToString("yyyy-MM"), byDefault.Month);
        // On the first of a month, yesterday is in the previous month and drops out.
        Assert.Equal(Today.Day == 1 ? 0m : 5m, byDefault.MonthTotalCost);
    }

    [Theory]
    [InlineData(-2)]
    [InlineData(2)]
    public async Task Today_OutsideUtcPlusOrMinusOneDay_Is400(int days)
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => DashboardAsync(Today.AddDays(days)));
        Assert.Equal("dashboard.invalidDate", ex.Code);
    }

    [Fact]
    public async Task AnotherUsersData_NeverAppears()
    {
        var other = Guid.NewGuid();
        var theirs = await CarAsync("Theirs", other);
        await TaskAsync(theirs, "Oil", 40_000, other);
        await SeedRecordAsync(theirs, Today, 500m);
        var mine = await CarAsync("Mine");

        var dash = await DashboardAsync();

        Assert.Equal([mine], dash.Vehicles.Select(v => v.Id));
        Assert.Equal((0, 0, 0m, 0), (dash.OverdueCount, dash.DueSoonCount, dash.MonthTotalCost, dash.MonthServiceCount));
    }

    [Fact]
    public async Task NoCars_ReturnsZerosAndAnEmptyList()
    {
        var dash = await DashboardAsync();

        Assert.Equal((0, 0, 0m, 0), (dash.OverdueCount, dash.DueSoonCount, dash.MonthTotalCost, dash.MonthServiceCount));
        Assert.Empty(dash.Vehicles);
    }
}
