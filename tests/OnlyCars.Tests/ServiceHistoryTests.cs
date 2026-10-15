using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP3-A: service history, recording a past service, and void in any order. Criterion numbers refer to the ticket.</summary>
public class ServiceHistoryTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly OriginalDate = Today.AddDays(-400);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly OdometerService odometer;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public ServiceHistoryTests()
    {
        vehicles = new VehicleService(db);
        odometer = new OdometerService(db, vehicles);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    // One manual reading of 50,000 dated today.
    private async Task<Guid> CreateCarAsync(Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 50_000))).Id;

    private async Task<MaintenanceTaskDto> CreateTaskAsync(Guid car, string name = "Oil", decimal lastKm = 40_000, DateOnly? lastDate = null,
        Guid? owner = null) =>
        await tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(null, name, "Oil", 5_000, 730, lastKm, lastDate ?? OriginalDate));

    private Task<CreateServiceRecordResponse> RecordAsync(Guid car, DateOnly date, decimal? km, params Guid[] taskIds) =>
        tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(date, km, null, null, null, [.. taskIds]));

    private Task<VehicleDto> CarAsync(Guid car) => vehicles.GetAsync(userId, car);

    private async Task<(decimal Km, DateOnly Date)> StoredLastDoneAsync(Guid taskId)
    {
        db.ChangeTracker.Clear();
        var t = await db.MaintenanceTasks.SingleAsync(x => x.Id == taskId);
        return (t.LastDoneOdometerKm, t.LastDoneDate);
    }

    private async Task AssertNothingSavedAsync(Guid car, Guid taskId)
    {
        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.ServiceRecords.CountAsync());
        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
        Assert.DoesNotContain(await db.OdometerReadings.ToListAsync(), r => r.Source == OdometerSource.Service);
        Assert.Equal((40_000m, OriginalDate), await StoredLastDoneAsync(taskId));
        Assert.Equal(50_000, (await CarAsync(car)).CurrentOdometerKm);
    }

    // --- Create (criteria 1 to 3) ---

    [Fact]
    public async Task Create_WithTwoTasks_LinksBoth_MovesBoth_LogsOneServiceReading_AndListsItFirst()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car, "Oil");
        var filter = await CreateTaskAsync(car, "Filter", 45_000, Today.AddDays(-100));
        var older = await RecordAsync(car, Today.AddDays(-200), 46_000);

        var result = await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today, 50_300, "  Garage Cohen ", 250.5m, " Full service ", [oil.Id, filter.Id]));

        Assert.Equal((Today, 50_300m, "Garage Cohen", 250.5m, "Full service"),
            (result.Record.Date, result.Record.OdometerKm, result.Record.ShopName, result.Record.TotalCost!.Value, result.Record.Notes));
        Assert.Equal(["Filter", "Oil"], result.Record.Tasks.Select(t => t.Name));
        Assert.Equal(["Filter", "Oil"], result.Tasks.Select(t => t.Name));
        Assert.All(result.Tasks, t => Assert.Equal((50_300m, Today, DueStatus.Ok), (t.LastDoneOdometerKm, t.LastDoneDate, t.Status!.Value)));

        db.ChangeTracker.Clear();
        var record = await db.ServiceRecords.SingleAsync(r => r.Id == result.Record.Id);
        Assert.Equal((car, Today, 50_300m, "Garage Cohen", false), (record.VehicleId, record.Date, record.OdometerKm, record.ShopName, record.IsVoided));
        var joins = await db.ServiceRecordTasks.Where(j => j.ServiceRecordId == record.Id).ToListAsync();
        Assert.Equal(2, joins.Count);
        var oilJoin = joins.Single(j => j.MaintenanceTaskId == oil.Id);
        Assert.Equal((40_000m, OriginalDate), (oilJoin.PreviousLastDoneOdometerKm, oilJoin.PreviousLastDoneDate));
        var filterJoin = joins.Single(j => j.MaintenanceTaskId == filter.Id);
        Assert.Equal((45_000m, Today.AddDays(-100)), (filterJoin.PreviousLastDoneOdometerKm, filterJoin.PreviousLastDoneDate));
        Assert.Equal((50_300m, Today), await StoredLastDoneAsync(oil.Id));
        Assert.Equal((50_300m, Today), await StoredLastDoneAsync(filter.Id));

        var reading = await db.OdometerReadings.SingleAsync(r => r.ServiceRecordId == record.Id);
        Assert.Equal((OdometerSource.Service, 50_300m, Today), (reading.Source, reading.ValueKm, reading.ReadingDate));
        Assert.Equal(50_300, (await CarAsync(car)).CurrentOdometerKm);

        var list = await tasks.ListRecordsAsync(userId, car);
        Assert.Equal([result.Record.Id, older.Record.Id], list.Select(r => r.Id));
        Assert.Equal(["Filter", "Oil"], list[0].Tasks.Select(t => t.Name));
        Assert.Equal((filter.Id, TaskCategory.Oil), (list[0].Tasks[0].Id, list[0].Tasks[0].Category));
    }

    [Fact]
    public async Task Create_WithNoTasks_SavesDiyRecordWithNullsAndItsReading()
    {
        var car = await CreateCarAsync();

        var result = await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today.AddDays(-10), 49_000, "   ", null, "  ", null));

        Assert.Empty(result.Tasks);
        Assert.Empty(result.Record.Tasks);
        db.ChangeTracker.Clear();
        var record = await db.ServiceRecords.SingleAsync();
        Assert.Null(record.ShopName);
        Assert.Null(record.TotalCost);
        Assert.Null(record.Notes);
        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
        Assert.Equal(49_000m, (await db.OdometerReadings.SingleAsync(r => r.ServiceRecordId == record.Id)).ValueKm);
        // Older than today's reading, so the current odometer stays.
        Assert.Equal(50_000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Create_WithOneTask_AndDuplicateIds_LinksItOnce()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var result = await RecordAsync(car, Today, 50_000, task.Id, task.Id);

        Assert.Single(result.Tasks);
        Assert.Single(result.Record.Tasks);
        db.ChangeTracker.Clear();
        Assert.Equal(1, await db.ServiceRecordTasks.CountAsync());
        Assert.Equal((50_000m, Today), await StoredLastDoneAsync(task.Id));
    }

    [Fact]
    public async Task Create_OlderThanTheTasksLastDone_LinksItButLeavesLastDone()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car, lastKm: 49_500, lastDate: Today.AddDays(-5));

        var result = await RecordAsync(car, Today.AddDays(-30), 48_000, task.Id);

        Assert.Equal((49_500m, Today.AddDays(-5)), (result.Tasks[0].LastDoneOdometerKm, result.Tasks[0].LastDoneDate));
        Assert.Equal((49_500m, Today.AddDays(-5)), await StoredLastDoneAsync(task.Id));
        var join = await db.ServiceRecordTasks.SingleAsync();
        Assert.Equal((task.Id, 49_500m), (join.MaintenanceTaskId, join.PreviousLastDoneOdometerKm));
    }

    [Theory]
    [InlineData(49_400, false)] // same date, lower km: older
    [InlineData(49_500, true)]  // same date and km: at least as recent
    [InlineData(49_600, true)]  // same date, higher km
    public async Task Create_OnTheSameDateAsLastDone_ComparesTheOdometer(int km, bool moves)
    {
        var car = await CreateCarAsync();
        var lastDate = Today.AddDays(-5);
        var task = await CreateTaskAsync(car, lastKm: 49_500, lastDate: lastDate);
        // Different on purpose, to see whether it moved: the record's km is the only difference.
        var result = await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(lastDate, km, null, null, null, [task.Id]));

        Assert.Equal(moves ? km : 49_500m, (await StoredLastDoneAsync(task.Id)).Km);
        Assert.Single(result.Tasks);
    }

    [Fact]
    public async Task Create_OutOfDateOrder_ReturnsNeighbourInKm_SavesNothing_AndConfirmSaves()
    {
        var car = await CreateCarAsync();
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(45_000, Today.AddDays(-60)));
        var task = await CreateTaskAsync(car);
        var readingsBefore = await db.OdometerReadings.CountAsync();

        var low = await Assert.ThrowsAsync<ValidationFailedException>(() => RecordAsync(car, Today.AddDays(-30), 44_000, task.Id));
        Assert.Equal(("odometer.lowerThanPrevious", (object?)45_000m), (low.Code, low.Extensions["previousKm"]));
        var high = await Assert.ThrowsAsync<ValidationFailedException>(() => RecordAsync(car, Today.AddDays(-30), 51_000, task.Id));
        Assert.Equal(("odometer.higherThanNext", (object?)50_000m), (high.Code, high.Extensions["nextKm"]));
        await AssertNothingSavedAsync(car, task.Id);
        Assert.Equal(readingsBefore, await db.OdometerReadings.CountAsync());

        var confirmed = await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today.AddDays(-30), 44_000, null, null, null, [task.Id], ConfirmCorrection: true));

        Assert.Equal((44_000m, Today.AddDays(-30)), (confirmed.Tasks[0].LastDoneOdometerKm, confirmed.Tasks[0].LastDoneDate));
        db.ChangeTracker.Clear();
        Assert.Equal(44_000m, (await db.OdometerReadings.SingleAsync(r => r.Source == OdometerSource.Service)).ValueKm);
    }

    [Fact]
    public async Task Create_FutureDate_IsFutureDate_AndSavesNothing_ButTomorrowIsAllowed()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => RecordAsync(car, Today.AddDays(2), 50_000, task.Id));
        Assert.Equal("serviceRecord.futureDate", ex.Code);
        await AssertNothingSavedAsync(car, task.Id);

        var tomorrow = await RecordAsync(car, Today.AddDays(1), 50_000, task.Id);
        Assert.Equal(Today.AddDays(1), tomorrow.Record.Date);
    }

    [Theory]
    [InlineData(null, null, null, null, "odometer.invalidValue")]
    [InlineData("-1", null, null, null, "odometer.invalidValue")]
    [InlineData("10000000.01", null, null, null, "odometer.invalidValue")]
    [InlineData("50000", "-1", null, null, "serviceRecord.invalidCost")]
    [InlineData("50000", "1000000.01", null, null, "serviceRecord.invalidCost")]
    [InlineData("50000", "1.234", null, null, "serviceRecord.invalidCost")]
    [InlineData("50000", null, 101, null, "serviceRecord.shopTooLong")]
    [InlineData("50000", null, null, 1_001, "serviceRecord.notesTooLong")]
    public async Task Create_InvalidField_ReturnsItsCode_AndSavesNothing(string? km, string? cost, int? shopLength, int? notesLength, string code)
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today, km is null ? null : decimal.Parse(km), shopLength is { } s ? new string('s', s) : null,
            cost is null ? null : decimal.Parse(cost), notesLength is { } n ? new string('n', n) : null, [task.Id])));

        Assert.Equal(code, ex.Code);
        await AssertNothingSavedAsync(car, task.Id);
    }

    [Fact]
    public async Task Create_LimitsExactlyAfterTrim_AreAccepted()
    {
        var car = await CreateCarAsync();

        var result = await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today, 50_000, " " + new string('s', 100) + " ", 1_000_000m, " " + new string('n', 1_000) + " ", null));

        Assert.Equal((100, 1_000), (result.Record.ShopName!.Length, result.Record.Notes!.Length));
    }

    [Fact]
    public async Task Create_OtherUsersCarOrTask_OrAnotherCarsTask_IsNotFound_AndSavesNothing()
    {
        var otherUser = Guid.NewGuid();
        var theirCar = await CreateCarAsync(otherUser);
        var theirTask = await CreateTaskAsync(theirCar, owner: otherUser);
        var car = await CreateCarAsync();
        var car2 = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var task2 = await CreateTaskAsync(car2);

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => RecordAsync(theirCar, Today, 50_000))).Code);
        // A valid task listed first must not be moved either.
        Assert.Equal("maintenanceTask.notFound",
            (await Assert.ThrowsAsync<NotFoundException>(() => RecordAsync(car, Today, 50_100, task.Id, theirTask.Id))).Code);
        Assert.Equal("maintenanceTask.notFound",
            (await Assert.ThrowsAsync<NotFoundException>(() => RecordAsync(car, Today, 50_100, task.Id, task2.Id))).Code);

        await AssertNothingSavedAsync(car, task.Id);
        Assert.Equal((40_000m, OriginalDate), await StoredLastDoneAsync(theirTask.Id));
    }

    // --- List (criterion 5) ---

    [Fact]
    public async Task List_NewestFirstByDateThenCreation_HidesVoided_AndDeletedTasks()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var gone = await CreateTaskAsync(car, "Gone");
        var old = await RecordAsync(car, Today.AddDays(-20), 49_000, task.Id, gone.Id);
        var sameDayFirst = await RecordAsync(car, Today.AddDays(-5), 49_500);
        var sameDaySecond = await RecordAsync(car, Today.AddDays(-5), 49_500);
        var voided = await RecordAsync(car, Today, 50_000);
        await tasks.VoidAsync(userId, car, voided.Record.Id);
        await tasks.DeleteAsync(userId, car, gone.Id);
        db.ChangeTracker.Clear();

        var list = await tasks.ListRecordsAsync(userId, car);

        Assert.Equal([sameDaySecond.Record.Id, sameDayFirst.Record.Id, old.Record.Id], list.Select(r => r.Id));
        Assert.Equal([task.Id], list[2].Tasks.Select(t => t.Id));
    }

    [Fact]
    public async Task List_OtherUsersCar_IsNotFound()
    {
        var theirCar = await CreateCarAsync(Guid.NewGuid());

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.ListRecordsAsync(userId, theirCar))).Code);
    }

    // --- Void in any order (criterion 4) ---

    [Fact]
    public async Task Void_NewerThenOlder_EndsAtTheOriginalSnapshot()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var older = await RecordAsync(car, Today.AddDays(-20), 49_000, task.Id);
        var newer = await RecordAsync(car, Today.AddDays(-10), 49_500, task.Id);
        Assert.Equal((49_500m, Today.AddDays(-10)), await StoredLastDoneAsync(task.Id));

        var afterNewer = Assert.Single(await tasks.VoidAsync(userId, car, newer.Record.Id));
        Assert.Equal((49_000m, Today.AddDays(-20)), (afterNewer.LastDoneOdometerKm, afterNewer.LastDoneDate));
        Assert.Equal((49_000m, Today.AddDays(-20)), await StoredLastDoneAsync(task.Id));

        await tasks.VoidAsync(userId, car, older.Record.Id);

        Assert.Equal((40_000m, OriginalDate), await StoredLastDoneAsync(task.Id));
        Assert.DoesNotContain(await db.OdometerReadings.ToListAsync(), r => r.Source == OdometerSource.Service);
        Assert.Empty(await tasks.ListRecordsAsync(userId, car));
    }

    [Fact]
    public async Task Void_OlderThenNewer_LeavesTheTaskThenEndsAtTheOriginalSnapshot()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var older = await RecordAsync(car, Today.AddDays(-20), 49_000, task.Id);
        var newer = await RecordAsync(car, Today.AddDays(-10), 49_500, task.Id);

        var afterOlder = Assert.Single(await tasks.VoidAsync(userId, car, older.Record.Id));
        Assert.Equal((49_500m, Today.AddDays(-10)), (afterOlder.LastDoneOdometerKm, afterOlder.LastDoneDate));
        Assert.Equal((49_500m, Today.AddDays(-10)), await StoredLastDoneAsync(task.Id));

        await tasks.VoidAsync(userId, car, newer.Record.Id);

        Assert.Equal((40_000m, OriginalDate), await StoredLastDoneAsync(task.Id));
    }

    [Fact]
    public async Task Void_BackdatedRecordCreatedLater_LeavesTheTaskAtTheNewerRecord()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var newer = await RecordAsync(car, Today.AddDays(-10), 49_500, task.Id);
        var backdated = await RecordAsync(car, Today.AddDays(-20), 49_000, task.Id); // linked, but didn't move last done

        await tasks.VoidAsync(userId, car, newer.Record.Id);
        Assert.Equal((49_000m, Today.AddDays(-20)), await StoredLastDoneAsync(task.Id));

        // None left: the earliest-created link's snapshot (newer's), not the backdated one's (which held newer's values).
        await tasks.VoidAsync(userId, car, backdated.Record.Id);
        Assert.Equal((40_000m, OriginalDate), await StoredLastDoneAsync(task.Id));
    }

    [Fact]
    public async Task Void_AfterAManualEdit_LeavesTheTaskAlone()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var record = await RecordAsync(car, Today.AddDays(-10), 49_500, task.Id);
        await tasks.UpdateAsync(userId, car, task.Id, new UpdateMaintenanceTaskRequest(
            "Oil", "Oil", 5_000, 730, 49_800, Today.AddDays(-5), true));

        var result = Assert.Single(await tasks.VoidAsync(userId, car, record.Record.Id));

        Assert.Equal((49_800m, Today.AddDays(-5)), (result.LastDoneOdometerKm, result.LastDoneDate));
        Assert.Equal((49_800m, Today.AddDays(-5)), await StoredLastDoneAsync(task.Id));
        db.ChangeTracker.Clear();
        Assert.True((await db.ServiceRecords.SingleAsync()).IsVoided);
    }

    [Fact]
    public async Task Void_OnlyRecomputesTheTasksAtThisRecord()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car, "Oil");
        var filter = await CreateTaskAsync(car, "Filter", 49_800, Today.AddDays(-2));
        var record = await RecordAsync(car, Today.AddDays(-10), 49_500, oil.Id, filter.Id); // moves oil only

        var result = await tasks.VoidAsync(userId, car, record.Record.Id);

        Assert.Equal(["Filter", "Oil"], result.Select(t => t.Name));
        Assert.Equal((40_000m, OriginalDate), await StoredLastDoneAsync(oil.Id));
        Assert.Equal((49_800m, Today.AddDays(-2)), await StoredLastDoneAsync(filter.Id));
    }
}
