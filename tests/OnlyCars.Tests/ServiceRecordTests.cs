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

/// <summary>MVP2-C: Reset / Mark as done and Undo (void). Criterion numbers refer to the ticket.</summary>
public class ServiceRecordTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly OriginalDate = Today.AddDays(-400);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly OdometerService odometer;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public ServiceRecordTests()
    {
        vehicles = new VehicleService(db);
        odometer = new OdometerService(db, vehicles);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    private async Task<Guid> CreateCarAsync(decimal km = 50_000, Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, km))).Id;

    // Overdue on km at 50,000 (last done 40,000, every 5,000 km), Ok on time.
    private async Task<MaintenanceTaskDto> CreateTaskAsync(Guid car, Guid? owner = null) =>
        await tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", 5_000, 730, 40_000, OriginalDate));

    private Task<ResetTaskResponse> ResetAsync(Guid car, Guid task, DateOnly? date = null, decimal? cost = null, string? notes = null) =>
        tasks.ResetAsync(userId, car, task, new ResetTaskRequest(date, cost, notes));

    private Task<VehicleDto> CarAsync(Guid car) => vehicles.GetAsync(userId, car);

    private async Task AssertNothingSavedAsync(Guid taskId)
    {
        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.ServiceRecords.CountAsync());
        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
        Assert.DoesNotContain(await db.OdometerReadings.ToListAsync(), r => r.Source == OdometerSource.Service);
        var task = await db.MaintenanceTasks.SingleAsync(t => t.Id == taskId);
        Assert.Equal((40_000m, OriginalDate), (task.LastDoneOdometerKm, task.LastDoneDate));
    }

    // --- Reset (criteria 1 to 5) ---

    [Fact]
    public async Task Reset_OneTap_CreatesRecordJoinRowAndServiceReading_AndRestartsTheTask()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        Assert.Equal(DueStatus.Overdue, task.Status);

        var result = await tasks.ResetAsync(userId, car, task.Id, null);

        db.ChangeTracker.Clear();
        var record = await db.ServiceRecords.SingleAsync();
        Assert.Equal(result.ServiceRecordId, record.Id);
        Assert.Equal((car, Today, 50_000m, false), (record.VehicleId, record.Date, record.OdometerKm, record.IsVoided));
        Assert.Null(record.TotalCost);
        Assert.Null(record.Notes);
        Assert.Null(record.ShopName);

        var join = await db.ServiceRecordTasks.SingleAsync();
        Assert.Equal((record.Id, task.Id, 40_000m, OriginalDate),
            (join.ServiceRecordId, join.MaintenanceTaskId, join.PreviousLastDoneOdometerKm, join.PreviousLastDoneDate));

        var stored = await db.MaintenanceTasks.SingleAsync();
        Assert.Equal((50_000m, Today), (stored.LastDoneOdometerKm, stored.LastDoneDate));

        var reading = await db.OdometerReadings.SingleAsync(r => r.Source == OdometerSource.Service);
        Assert.Equal((50_000m, Today, (Guid?)record.Id), (reading.ValueKm, reading.ReadingDate, reading.ServiceRecordId));

        Assert.Equal((DueStatus.Ok, 5_000m, 730, 0d), (result.Task.Status, result.Task.RemainingKm, result.Task.RemainingDays, result.Task.Progress));
        Assert.Equal((50_000m, Today), (result.Task.LastDoneOdometerKm, result.Task.LastDoneDate));
        Assert.Equal(50_000, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Reset_SavesCostAndTrimmedNotes_AndBlankNotesAsNull()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var first = await ResetAsync(car, task.Id, Today, 120.5m, "  Castrol 5W-30 ");
        var second = await ResetAsync(car, task.Id, Today, 0m, "   ");

        db.ChangeTracker.Clear();
        var a = await db.ServiceRecords.SingleAsync(r => r.Id == first.ServiceRecordId);
        Assert.Equal((120.50m, "Castrol 5W-30"), (a.TotalCost!.Value, a.Notes));
        var b = await db.ServiceRecords.SingleAsync(r => r.Id == second.ServiceRecordId);
        Assert.Equal(0m, b.TotalCost);
        Assert.Null(b.Notes);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(0)]
    [InlineData(1)]
    public async Task Reset_DateWithinOneDayOfUtcToday_IsAccepted(int offset)
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var result = await ResetAsync(car, task.Id, Today.AddDays(offset));

        Assert.Equal(Today.AddDays(offset), result.Task.LastDoneDate);
        Assert.Equal(Today.AddDays(offset), (await db.ServiceRecords.SingleAsync()).Date);
    }

    [Theory]
    [InlineData(-2)]
    [InlineData(2)]
    public async Task Reset_DateTwoDaysAway_IsInvalidDate_AndSavesNothing(int offset)
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        // Also invalid cost, to pin the validation order: the date is checked first.
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => ResetAsync(car, task.Id, Today.AddDays(offset), -1m));

        Assert.Equal("serviceRecord.invalidDate", ex.Code);
        await AssertNothingSavedAsync(task.Id);
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("1000000.01")]
    [InlineData("1.234")]
    public async Task Reset_CostOutOfRangeOrOverTwoDecimals_IsInvalidCost_AndSavesNothing(string cost)
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => ResetAsync(car, task.Id, cost: decimal.Parse(cost)));

        Assert.Equal("serviceRecord.invalidCost", ex.Code);
        await AssertNothingSavedAsync(task.Id);
    }

    [Fact]
    public async Task Reset_MaxCostAndNotesOfExactlyTheLimitAfterTrim_AreAccepted()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        await ResetAsync(car, task.Id, cost: 1_000_000m, notes: "  " + new string('x', 1_000) + "  ");

        Assert.Equal(1_000, (await db.ServiceRecords.SingleAsync()).Notes!.Length);
    }

    [Fact]
    public async Task Reset_NotesOver1000Characters_IsNotesTooLong_AndSavesNothing()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => ResetAsync(car, task.Id, notes: new string('x', 1_001)));

        Assert.Equal("serviceRecord.notesTooLong", ex.Code);
        await AssertNothingSavedAsync(task.Id);
    }

    [Fact]
    public async Task Reset_OtherUsersCarOrTask_OrTaskOnAnotherCar_IsNotFound_AndSavesNothing()
    {
        var otherUser = Guid.NewGuid();
        var theirCar = await CreateCarAsync(owner: otherUser);
        var theirTask = await CreateTaskAsync(theirCar, otherUser);
        var car = await CreateCarAsync();
        var car2 = await CreateCarAsync();
        var task = await CreateTaskAsync(car);

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => ResetAsync(theirCar, theirTask.Id))).Code);
        Assert.Equal("maintenanceTask.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => ResetAsync(car, theirTask.Id))).Code);
        Assert.Equal("maintenanceTask.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => ResetAsync(car2, task.Id))).Code);

        await AssertNothingSavedAsync(task.Id);
        var theirs = await db.MaintenanceTasks.SingleAsync(t => t.Id == theirTask.Id);
        Assert.Equal((40_000m, OriginalDate), (theirs.LastDoneOdometerKm, theirs.LastDoneDate));
    }

    [Fact]
    public async Task Reset_WhenLatestReadingIsDatedTomorrow_SkipsDateOrderChecks_AndKeepsCurrentOdometer()
    {
        var car = await CreateCarAsync();
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(51_000, Today.AddDays(1)));
        var task = await CreateTaskAsync(car);

        var result = await ResetAsync(car, task.Id, Today);

        Assert.Equal(51_000m, result.Task.LastDoneOdometerKm);
        Assert.Equal(51_000, (await CarAsync(car)).CurrentOdometerKm);
        var history = await odometer.HistoryAsync(userId, car);
        Assert.Equal((Today.AddDays(1), OdometerSource.Manual), (history[0].ReadingDate, history[0].Source));
        Assert.Equal((Today, OdometerSource.Service, 51_000m), (history[1].ReadingDate, history[1].Source, history[1].ValueKm));
    }

    [Fact]
    public async Task Reset_OnTheSameDateAsAManualReading_SortsAfterIt_AndUndoLeavesTheManualReadingCurrent()
    {
        var car = await CreateCarAsync(); // manual reading 50,000 dated today
        var task = await CreateTaskAsync(car);

        var reset = await ResetAsync(car, task.Id, Today);
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(50_200, Today));

        var history = await odometer.HistoryAsync(userId, car);
        Assert.Equal([OdometerSource.Manual, OdometerSource.Service, OdometerSource.Manual], history.Select(r => r.Source));
        Assert.Equal(50_200, (await CarAsync(car)).CurrentOdometerKm);

        await tasks.VoidAsync(userId, car, reset.ServiceRecordId);

        Assert.Equal([50_200m, 50_000m], (await odometer.HistoryAsync(userId, car)).Select(r => r.ValueKm));
        Assert.Equal(50_200, (await CarAsync(car)).CurrentOdometerKm);
    }

    // --- Undo (criteria 6 to 8) ---

    [Fact]
    public async Task Void_RestoresSnapshot_DeletesReading_RecomputesOdometerAndAverage_AndReturnsTasks()
    {
        var car = await CreateCarAsync(); // 50,000 today
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(47_000, Today.AddDays(-30)));
        var task = await CreateTaskAsync(car);
        var before = await CarAsync(car);
        Assert.Equal(100m, before.AvgKmPerDay);

        // Dated tomorrow, so the service reading is the last one and moves the average.
        var reset = await ResetAsync(car, task.Id, Today.AddDays(1));
        Assert.Equal(Math.Round(3_000m / 31, 2), (await CarAsync(car)).AvgKmPerDay);

        var restored = await tasks.VoidAsync(userId, car, reset.ServiceRecordId);

        var dto = Assert.Single(restored);
        Assert.Equal((task.Id, 40_000m, OriginalDate, DueStatus.Overdue, -5_000m),
            (dto.Id, dto.LastDoneOdometerKm, dto.LastDoneDate, dto.Status!.Value, dto.RemainingKm!.Value));
        db.ChangeTracker.Clear();
        Assert.True((await db.ServiceRecords.SingleAsync()).IsVoided);
        Assert.DoesNotContain(await db.OdometerReadings.ToListAsync(), r => r.Source == OdometerSource.Service);
        var after = await CarAsync(car);
        Assert.Equal((50_000m, 100m), (after.CurrentOdometerKm, after.AvgKmPerDay!.Value));
    }

    // MVP3-A retired serviceRecord.notLatest: any non-voided record can be voided, in any order (decisions.md).
    [Fact]
    public async Task Void_LatestResetFirst_ThenEarlier_EndsAtTheOriginal_AndNeverTwice()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var a = await ResetAsync(car, task.Id, Today);
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(50_500, Today));
        var b = await ResetAsync(car, task.Id, Today);

        var afterB = Assert.Single(await tasks.VoidAsync(userId, car, b.ServiceRecordId));
        Assert.Equal((50_000m, Today), (afterB.LastDoneOdometerKm, afterB.LastDoneDate));

        var afterA = Assert.Single(await tasks.VoidAsync(userId, car, a.ServiceRecordId));
        Assert.Equal((40_000m, OriginalDate), (afterA.LastDoneOdometerKm, afterA.LastDoneDate));

        var twice = await Assert.ThrowsAsync<ConflictException>(() => tasks.VoidAsync(userId, car, a.ServiceRecordId));
        Assert.Equal("serviceRecord.alreadyVoided", twice.Code);
        Assert.Equal(50_500, (await CarAsync(car)).CurrentOdometerKm);
    }

    [Fact]
    public async Task Void_EarlierResetFirst_LeavesTheTaskAtTheLaterOne_ThenTheLaterRestoresTheOriginal()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var a = await ResetAsync(car, task.Id, Today);
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(50_500, Today));
        var b = await ResetAsync(car, task.Id, Today);

        var afterA = Assert.Single(await tasks.VoidAsync(userId, car, a.ServiceRecordId));
        Assert.Equal((50_500m, Today), (afterA.LastDoneOdometerKm, afterA.LastDoneDate));
        db.ChangeTracker.Clear();
        Assert.True((await db.ServiceRecords.SingleAsync(r => r.Id == a.ServiceRecordId)).IsVoided);
        var untouched = await db.MaintenanceTasks.SingleAsync();
        Assert.Equal((50_500m, Today), (untouched.LastDoneOdometerKm, untouched.LastDoneDate));
        Assert.Equal(1, await db.OdometerReadings.CountAsync(r => r.Source == OdometerSource.Service));

        // None left, so the earliest-created record's snapshot (a's: the original values).
        var afterB = Assert.Single(await tasks.VoidAsync(userId, car, b.ServiceRecordId));
        Assert.Equal((40_000m, OriginalDate), (afterB.LastDoneOdometerKm, afterB.LastDoneDate));
        db.ChangeTracker.Clear();
        var stored = await db.MaintenanceTasks.SingleAsync();
        Assert.Equal((40_000m, OriginalDate), (stored.LastDoneOdometerKm, stored.LastDoneDate));
    }

    [Fact]
    public async Task Void_ResetsWithDatesGoingBackwards_WorkInEitherOrder()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var a = await ResetAsync(car, task.Id, Today.AddDays(1));
        var b = await ResetAsync(car, task.Id, Today); // the one-tap reset always moves last done, so the task is at b

        // a isn't the task's last done, so its void leaves the task alone; then b's void finds no record left.
        var first = Assert.Single(await tasks.VoidAsync(userId, car, a.ServiceRecordId));
        Assert.Equal((50_000m, Today), (first.LastDoneOdometerKm, first.LastDoneDate));
        var second = Assert.Single(await tasks.VoidAsync(userId, car, b.ServiceRecordId));
        Assert.Equal((40_000m, OriginalDate), (second.LastDoneOdometerKm, second.LastDoneDate));
    }

    [Fact]
    public async Task Void_ResetsWithDatesGoingBackwards_LaterCreatedFirst_GoesToTheLatestRemainingByDate()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var a = await ResetAsync(car, task.Id, Today.AddDays(1));
        var b = await ResetAsync(car, task.Id, Today);

        var afterB = Assert.Single(await tasks.VoidAsync(userId, car, b.ServiceRecordId));
        Assert.Equal((50_000m, Today.AddDays(1)), (afterB.LastDoneOdometerKm, afterB.LastDoneDate));

        var afterA = Assert.Single(await tasks.VoidAsync(userId, car, a.ServiceRecordId));
        Assert.Equal((40_000m, OriginalDate), (afterA.LastDoneOdometerKm, afterA.LastDoneDate));
    }

    [Fact]
    public async Task Void_OtherUsersRecord_IsNotFound_AndChangesNothing()
    {
        var otherUser = Guid.NewGuid();
        var theirCar = await CreateCarAsync(owner: otherUser);
        var theirTask = await CreateTaskAsync(theirCar, otherUser);
        var theirReset = await tasks.ResetAsync(otherUser, theirCar, theirTask.Id, null);
        var car = await CreateCarAsync();

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.VoidAsync(userId, theirCar, theirReset.ServiceRecordId))).Code);
        Assert.Equal("serviceRecord.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.VoidAsync(userId, car, theirReset.ServiceRecordId))).Code);

        db.ChangeTracker.Clear();
        Assert.False((await db.ServiceRecords.SingleAsync()).IsVoided);
        Assert.Equal(50_000m, (await db.MaintenanceTasks.SingleAsync()).LastDoneOdometerKm);
    }

    [Fact]
    public async Task Void_WhenItsReadingIsTheCarsOnlyReading_KeepsItAsManual()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var reset = await ResetAsync(car, task.Id, Today);
        var manual = (await odometer.HistoryAsync(userId, car)).Single(r => r.Source == OdometerSource.Manual);
        await odometer.DeleteAsync(userId, car, manual.Id);

        await tasks.VoidAsync(userId, car, reset.ServiceRecordId);

        db.ChangeTracker.Clear();
        var reading = await db.OdometerReadings.SingleAsync();
        Assert.Equal((OdometerSource.Manual, (Guid?)null, 50_000m), (reading.Source, reading.ServiceRecordId, reading.ValueKm));
        Assert.Equal(50_000, (await CarAsync(car)).CurrentOdometerKm);
        Assert.True((await db.ServiceRecords.SingleAsync()).IsVoided);
    }

    // --- Delete a task with resets (criterion 9; the database cascade is in MaintenanceSchemaTests) ---

    [Fact]
    public async Task DeleteTask_RemovesJoinRows_KeepsRecordAndReading()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var reset = await ResetAsync(car, task.Id);

        await tasks.DeleteAsync(userId, car, task.Id);

        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
        Assert.True(await db.ServiceRecords.AnyAsync(r => r.Id == reset.ServiceRecordId));
        Assert.True(await db.OdometerReadings.AnyAsync(r => r.ServiceRecordId == reset.ServiceRecordId));
    }
}
