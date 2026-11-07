using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Issues;
using OnlyCars.Application.Issues.Dtos;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>LOW-4 backend on InMemory: L66 (the rethrow path), L67, L70. The races on Postgres are in MaintenanceSchemaTests.</summary>
public class LowFourTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly TooEarly = new(1899, 12, 31);
    private readonly FailSave fail = new();
    private readonly AppDbContext db;
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly IssueService issues;
    private readonly Guid userId = Guid.NewGuid();

    public LowFourTests()
    {
        db = new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(fail).Options);
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
        issues = new IssueService(db, vehicles);
    }

    private async Task<Guid> CarAsync(string? vin = null) =>
        (await vehicles.CreateAsync(userId, new CreateVehicleRequest("Mazda", null, null, null, vin, null, null, null, null, null, 50_000))).Id;

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    // --- L66 ---

    [Fact]
    public async Task VinSaveFailure_WithoutACompetingCar_IsRethrown()
    {
        fail.Next = true;
        await Assert.ThrowsAsync<DbUpdateException>(() => CarAsync("VIN1"));
    }

    // --- L67 ---

    [Fact]
    public async Task IssueDoneDate_Before1900_IsTooEarly_1900To1999StaysInvalidDate()
    {
        var car = await CarAsync();
        var issue = await issues.CreateAsync(userId, car, new CreateIssueRequest("Wipers", null, null));
        UpdateIssueRequest Done(DateOnly date) => new("Wipers", null, IssueStatus.Done, date);

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => issues.UpdateAsync(userId, issue.Id, Done(TooEarly)));
        Assert.Equal(("date.tooEarly", (object?)new DateOnly(1900, 1, 1)), (error.Code, error.Extensions["minDate"]));
        Assert.Equal("issue.invalidDate", await CodeAsync(() => issues.UpdateAsync(userId, issue.Id, Done(new DateOnly(1900, 1, 1)))));
    }

    [Fact]
    public async Task TaskLastDoneDate_Before1900_IsTooEarly_OnCreateAndOnEditWhenChanged()
    {
        var car = await CarAsync();
        CreateMaintenanceTaskRequest Create(DateOnly date) => new(null, "Oil", "Oil", 5_000, null, 40_000, date);
        UpdateMaintenanceTaskRequest Edit(DateOnly date, string name = "Oil") => new(name, "Oil", 5_000, null, 40_000, date, null);

        Assert.Equal("date.tooEarly", await CodeAsync(() => tasks.CreateAsync(userId, car, Create(TooEarly))));
        var task = await tasks.CreateAsync(userId, car, Create(new DateOnly(1900, 1, 1)));
        Assert.Equal("date.tooEarly", await CodeAsync(() => tasks.UpdateAsync(userId, car, task.Id, Edit(TooEarly))));

        // A stored date from before this rule doesn't block an edit that keeps it.
        (await db.MaintenanceTasks.SingleAsync()).LastDoneDate = TooEarly;
        await db.SaveChangesAsync();
        Assert.Equal("Oil 2", (await tasks.UpdateAsync(userId, car, task.Id, Edit(TooEarly, "Oil 2"))).Name);
    }

    // --- L70 ---

    [Fact]
    public async Task ServiceRecordEdit_NoOp_DoesNotSave_AndAVoidAfterItSucceeds_AnyChangeStillSaves()
    {
        var car = await CarAsync();
        var oil = (await tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", 5_000, null, 40_000, Today))).Id;
        var air = (await tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Air", "Filters", 5_000, null, 40_000, Today))).Id;
        List<ServiceItemRequest> items = [new("Oil", "Mobil", null, 4.5m, 10m), new("Labour", null, null, 1, 100m, true)];
        var record = (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Today, 50_000, "Shop", null, "n", [oil, air], Items: items))).Record;
        async Task<DateTimeOffset> StampAsync() => (await db.ServiceRecords.AsNoTracking().SingleAsync(r => r.Id == record.Id)).UpdatedAt;
        var before = await StampAsync();

        // Same values, trimmed text, same tasks in another order, and the date and odometer sent unchanged: no save.
        var same = await tasks.UpdateRecordAsync(userId, car, record.Id, new UpdateServiceRecordRequest(" Shop ", null, "n ",
            [new("Oil ", "Mobil", "", 4.50m, 10m), new("Labour", null, null, 1, 100m, true)], Today, 50_000, [air, oil, oil]));
        Assert.Equal((before, 2, 2), (await StampAsync(), same.Record.Items.Count, same.Record.Tasks.Count));

        // Each kind of change still saves: an item reorder, a shop name, the tasks.
        await tasks.UpdateRecordAsync(userId, car, record.Id, new UpdateServiceRecordRequest("Shop", null, "n", [items[1], items[0]], TaskIds: [oil, air]));
        var reordered = await StampAsync();
        Assert.NotEqual(before, reordered);
        await tasks.UpdateRecordAsync(userId, car, record.Id, new UpdateServiceRecordRequest("Shop", null, "n", [items[1], items[0]], TaskIds: [oil]));
        Assert.NotEqual(reordered, await StampAsync());

        // A void after the edits saves.
        await tasks.VoidAsync(userId, car, record.Id);
        Assert.True((await db.ServiceRecords.AsNoTracking().SingleAsync()).IsVoided);
    }

    /// <summary>Fails the next save like a unique index would, with nothing else saved first.</summary>
    private sealed class FailSave : SaveChangesInterceptor
    {
        public bool Next { get; set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!Next)
            {
                return ValueTask.FromResult(result);
            }

            Next = false;
            throw new DbUpdateException("Cannot insert duplicate key row with unique index.");
        }
    }
}
