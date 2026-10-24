using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>PRED-1: predictedDueDate on the task list and the dashboard, from the car's average and the client's today.</summary>
public class PredictedDueDateTests
{
    private static readonly DateOnly Utc = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public PredictedDueDateTests()
    {
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    // A car at 50,000 km with the given average and a 5,000 km task done at 49,000 (4,000 km left).
    private async Task<Guid> CarWithTaskAsync(decimal? avg)
    {
        var car = (await vehicles.CreateAsync(userId, new CreateVehicleRequest(
            "Car", "Mazda", "3", 2018, null, null, null, null, null, null, 50_000))).Id;
        await tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", 5_000, null, 49_000, Utc));
        (await db.Vehicles.FindAsync(car))!.AvgKmPerDay = avg;
        await db.SaveChangesAsync();
        return car;
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    public async Task ListAndDashboard_ReturnTheDate_FromTheClientsToday(int offset)
    {
        var car = await CarWithTaskAsync(30m);
        var today = Utc.AddDays(offset);
        var expected = today.AddDays(134); // 4,000 / 30 = 133.3, rounded up

        Assert.Equal(expected, Assert.Single(await tasks.ListAsync(userId, car, today)).PredictedDueDate);
        var card = Assert.Single((await tasks.DashboardAsync(userId, today)).Vehicles);
        Assert.Equal(expected, Assert.Single(card.Tasks).PredictedDueDate);
    }

    [Fact]
    public async Task NoAverage_IsNull_OnBothEndpoints()
    {
        var car = await CarWithTaskAsync(null);

        Assert.Null(Assert.Single(await tasks.ListAsync(userId, car, Utc)).PredictedDueDate);
        Assert.Null(Assert.Single(Assert.Single((await tasks.DashboardAsync(userId, Utc)).Vehicles).Tasks).PredictedDueDate);
    }

    [Fact]
    public async Task AnotherUsersCar_Is404()
    {
        var car = await CarWithTaskAsync(30m);

        await Assert.ThrowsAsync<NotFoundException>(() => tasks.ListAsync(Guid.NewGuid(), car, Utc));
    }
}
