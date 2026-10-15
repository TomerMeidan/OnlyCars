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

/// <summary>MVP3-D: editing a service's date, odometer and tasks. Criterion numbers refer to the ticket.</summary>
public class ServiceRecordEditTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly OriginalDate = Today.AddDays(-400);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly OdometerService odometer;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public ServiceRecordEditTests()
    {
        vehicles = new VehicleService(db);
        odometer = new OdometerService(db, vehicles);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    // One reading: 50,000 km today.
    private async Task<Guid> CreateCarAsync(Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 50_000))).Id;

    private async Task<Guid> CreateTaskAsync(Guid car, string name = "Oil", decimal lastKm = 40_000, DateOnly? lastDate = null, Guid? owner = null) =>
        (await tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(null, name, "Oil", 5_000, 730, lastKm, lastDate ?? OriginalDate))).Id;

    private async Task<Guid> RecordAsync(Guid car, int daysAgo, decimal km, params Guid[] taskIds) =>
        (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today.AddDays(-daysAgo), km, "Garage", 100, "Notes", [.. taskIds]))).Record.Id;

    // An MVP3-B body (shop, cost, notes unchanged) plus the MVP3-D fields.
    private Task<CreateServiceRecordResponse> EditAsync(Guid car, Guid record, DateOnly? date = null, decimal? km = null,
        List<Guid>? taskIds = null, bool confirm = false, Guid? user = null) =>
        tasks.UpdateRecordAsync(user ?? userId, car, record, new UpdateServiceRecordRequest("Garage", 100, "Notes", null, date, km, taskIds, confirm));

    private async Task<(DateOnly, decimal)> LastDoneAsync(Guid task)
    {
        db.ChangeTracker.Clear();
        var t = await db.MaintenanceTasks.AsNoTracking().SingleAsync(x => x.Id == task);
        return (t.LastDoneDate, t.LastDoneOdometerKm);
    }

    private async Task<(DateOnly, decimal)?> ReadingOfAsync(Guid record)
    {
        db.ChangeTracker.Clear();
        var r = await db.OdometerReadings.AsNoTracking().SingleOrDefaultAsync(x => x.ServiceRecordId == record);
        return r is null ? null : (r.ReadingDate, r.ValueKm);
    }

    private async Task<string> SnapshotAsync()
    {
        db.ChangeTracker.Clear();
        var records = await db.ServiceRecords.AsNoTracking().OrderBy(r => r.Id).Select(r => $"{r.Id}:{r.Date}:{r.OdometerKm}:{r.IsVoided}").ToListAsync();
        var links = await db.ServiceRecordTasks.AsNoTracking().OrderBy(j => j.Id).Select(j => $"{j.Id}:{j.ServiceRecordId}:{j.MaintenanceTaskId}").ToListAsync();
        var readings = await db.OdometerReadings.AsNoTracking().OrderBy(r => r.Id).Select(r => $"{r.Id}:{r.ReadingDate}:{r.ValueKm}:{r.ServiceRecordId}").ToListAsync();
        var taskRows = await db.MaintenanceTasks.AsNoTracking().OrderBy(t => t.Id).Select(t => $"{t.Id}:{t.LastDoneDate}:{t.LastDoneOdometerKm}").ToListAsync();
        var cars = await db.Vehicles.AsNoTracking().OrderBy(v => v.Id).Select(v => $"{v.Id}:{v.CurrentOdometerKm}:{v.AvgKmPerDay}").ToListAsync();
        return string.Join("|", records.Concat(links).Concat(readings).Concat(taskRows).Concat(cars));
    }

    // --- Criterion 1: date and odometer ---

    [Fact]
    public async Task DateOnly_MovesRecordReadingAverageAndLastDone()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);
        Assert.Equal(50m, (await vehicles.GetAsync(userId, car)).AvgKmPerDay);

        var result = await EditAsync(car, record, date: Today.AddDays(-50));

        Assert.Equal((Today.AddDays(-50), 45_000m), (result.Record.Date, result.Record.OdometerKm));
        Assert.Equal((Today.AddDays(-50), 45_000m), await ReadingOfAsync(record));
        var vehicle = await vehicles.GetAsync(userId, car);
        Assert.Equal((50_000m, (decimal?)100m), (vehicle.CurrentOdometerKm, vehicle.AvgKmPerDay));
        Assert.Equal((Today.AddDays(-50), 45_000m), await LastDoneAsync(oil));
        var dto = Assert.Single(result.Tasks);
        Assert.Equal((Today.AddDays(-50), 45_000m), (dto.LastDoneDate, dto.LastDoneOdometerKm));
    }

    [Fact]
    public async Task OdometerOnly_MovesReadingAverageAndLastDone()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);

        await EditAsync(car, record, km: 46_000);

        Assert.Equal((Today.AddDays(-100), 46_000m), await ReadingOfAsync(record));
        Assert.Equal(40m, (await vehicles.GetAsync(userId, car)).AvgKmPerDay);
        Assert.Equal((Today.AddDays(-100), 46_000m), await LastDoneAsync(oil));
    }

    [Fact]
    public async Task Both_ToTheNewestReading_MovesTheCarsCurrentOdometer()
    {
        var car = await CreateCarAsync();
        var record = await RecordAsync(car, 100, 45_000);

        await EditAsync(car, record, Today.AddDays(1), 52_000);

        Assert.Equal((Today.AddDays(1), 52_000m), await ReadingOfAsync(record));
        var vehicle = await vehicles.GetAsync(userId, car);
        Assert.Equal((52_000m, (decimal?)2_000m), (vehicle.CurrentOdometerKm, vehicle.AvgKmPerDay));
    }

    [Fact]
    public async Task MarkDoneRecord_IsEditedTheSameWay_AndAVoidAfterTheEditRestoresTheOriginal()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = (await tasks.ResetAsync(userId, car, oil, null)).ServiceRecordId;

        await EditAsync(car, record, Today.AddDays(-30), 48_000);
        Assert.Equal((Today.AddDays(-30), 48_000m), await LastDoneAsync(oil));
        Assert.Equal((Today.AddDays(-30), 48_000m), await ReadingOfAsync(record));

        await tasks.VoidAsync(userId, car, record);
        Assert.Equal((OriginalDate, 40_000m), await LastDoneAsync(oil));
        Assert.Null(await ReadingOfAsync(record));
    }

    [Fact]
    public async Task OutOfDateOrder_IsRejectedWithNothingSaved_AndConfirmCorrectionSaves()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(44_000, Today.AddDays(-200), ConfirmCorrection: false));
        var before = await SnapshotAsync();

        var higher = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, record, Today.AddDays(-50), 51_000));
        Assert.Equal("odometer.higherThanNext", higher.Code);
        Assert.Equal(50_000m, higher.Extensions["nextKm"]);
        var lower = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, record, km: 43_000));
        Assert.Equal("odometer.lowerThanPrevious", lower.Code);
        Assert.Equal(44_000m, lower.Extensions["previousKm"]);
        Assert.Equal(before, await SnapshotAsync());

        await EditAsync(car, record, Today.AddDays(-50), 51_000, confirm: true);
        Assert.Equal((Today.AddDays(-50), 51_000m), await ReadingOfAsync(record));
        Assert.Equal(50_000m, (await vehicles.GetAsync(userId, car)).CurrentOdometerKm);
    }

    [Theory]
    [InlineData(2, 45_000, "serviceRecord.futureDate")]
    [InlineData(-100, -1, "odometer.invalidValue")]
    [InlineData(-100, 10_000_001, "odometer.invalidValue")]
    public async Task FutureDateOrOutOfRangeOdometer_IsRejected_AndSavesNothing(int dayOffset, decimal km, string code)
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);
        var before = await SnapshotAsync();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => EditAsync(car, record, Today.AddDays(dayOffset), km, confirm: true));

        Assert.Equal(code, ex.Code);
        Assert.Equal(before, await SnapshotAsync());
    }

    [Fact]
    public async Task RecordWithoutALinkedReading_GetsOneWhenMoved()
    {
        var car = await CreateCarAsync();
        var record = await RecordAsync(car, 100, 45_000);
        db.OdometerReadings.Remove(await db.OdometerReadings.SingleAsync(r => r.ServiceRecordId == record));
        await db.SaveChangesAsync();

        await EditAsync(car, record, km: 46_000);

        Assert.Equal((Today.AddDays(-100), 46_000m), await ReadingOfAsync(record));
        Assert.Equal(1, await db.OdometerReadings.CountAsync(r => r.ServiceRecordId == record && r.Source == OdometerSource.Service));
    }

    // --- Criterion 3: no new fields, or unchanged ones ---

    [Fact]
    public async Task UnchangedDateAndOdometer_SkipDateOrderChecks_AndTouchNothing()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);
        // A later, lower correction leaves the record's 45,000 out of date order.
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(44_000, Today.AddDays(-50), ConfirmCorrection: true));
        var before = await SnapshotAsync();

        var mvp3B = await tasks.UpdateRecordAsync(userId, car, record, new UpdateServiceRecordRequest("New shop", 5, null, null));
        var same = await EditAsync(car, record, Today.AddDays(-100), 45_000);

        Assert.Equal("New shop", mvp3B.Record.ShopName);
        Assert.Equal("Garage", same.Record.ShopName);
        Assert.Equal(before, await SnapshotAsync());
    }

    // --- Criterion 2: tasks ---

    [Fact]
    public async Task AddTask_TakesASnapshot_AndMovesLastDoneOnlyIfTheRecordIsAtLeastAsRecent()
    {
        var car = await CreateCarAsync();
        var record = await RecordAsync(car, 100, 45_000);
        var older = await CreateTaskAsync(car, "Filter", 30_000);
        var newer = await CreateTaskAsync(car, "Brakes", 47_000, Today.AddDays(-50));

        var result = await EditAsync(car, record, taskIds: [older, newer, older]);

        Assert.Equal(["Brakes", "Filter"], result.Record.Tasks.Select(t => t.Name));
        Assert.Equal((Today.AddDays(-100), 45_000m), await LastDoneAsync(older));
        Assert.Equal((Today.AddDays(-50), 47_000m), await LastDoneAsync(newer));
        var links = await db.ServiceRecordTasks.AsNoTracking().Where(j => j.ServiceRecordId == record).ToListAsync();
        Assert.Equal(2, links.Count);
        Assert.Equal((OriginalDate, 30_000m), links.Single(j => j.MaintenanceTaskId == older) is var o ? (o.PreviousLastDoneDate, o.PreviousLastDoneOdometerKm) : default);
        Assert.Equal((Today.AddDays(-50), 47_000m), links.Single(j => j.MaintenanceTaskId == newer) is var n ? (n.PreviousLastDoneDate, n.PreviousLastDoneOdometerKm) : default);

        // Removing the added task again restores its snapshot.
        await EditAsync(car, record, taskIds: [newer]);
        Assert.Equal((OriginalDate, 30_000m), await LastDoneAsync(older));
    }

    [Fact]
    public async Task RemoveTask_FallsBackAsOnVoid_DeletesTheLink_AndEmptyListRemovesAll()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var filter = await CreateTaskAsync(car, "Filter", 30_000);
        var record = await RecordAsync(car, 100, 45_000, oil, filter);

        var result = await EditAsync(car, record, taskIds: [filter]);

        Assert.Equal((OriginalDate, 40_000m), await LastDoneAsync(oil));
        Assert.Equal(["Filter"], result.Record.Tasks.Select(t => t.Name));
        Assert.Equal(2, result.Tasks.Count); // every task of the car
        Assert.Equal(1, await db.ServiceRecordTasks.CountAsync(j => j.ServiceRecordId == record));

        await EditAsync(car, record, taskIds: []);
        Assert.Equal((OriginalDate, 30_000m), await LastDoneAsync(filter));
        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
    }

    [Fact]
    public async Task RemoveTask_ThroughAManualEdit_FallsBackToTheEdit_AndAnOlderRecordLeavesTheEditAlone()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var first = await RecordAsync(car, 100, 45_000, oil);
        var manual = (Today.AddDays(-60), 46_000m);
        await tasks.UpdateAsync(userId, car, oil, new UpdateMaintenanceTaskRequest("Oil", "Oil", 5_000, 730, manual.Item2, manual.Item1, null));
        var second = await RecordAsync(car, 10, 49_000, oil);

        await EditAsync(car, second, taskIds: []);
        Assert.Equal(manual, await LastDoneAsync(oil));

        await EditAsync(car, first, taskIds: []);
        Assert.Equal(manual, await LastDoneAsync(oil));
    }

    [Fact]
    public async Task KeptTask_MovedEarlierBehindAnotherRecord_FallsBackToTheLaterOne_AndVoidsStillRestore()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var first = await RecordAsync(car, 100, 45_000, oil);
        var second = await RecordAsync(car, 50, 47_000, oil);

        await EditAsync(car, second, Today.AddDays(-150), 43_000);
        Assert.Equal((Today.AddDays(-100), 45_000m), await LastDoneAsync(oil));

        // Voiding the other record now falls back to the edited one, at its new values.
        await tasks.VoidAsync(userId, car, first);
        Assert.Equal((Today.AddDays(-150), 43_000m), await LastDoneAsync(oil));
        await tasks.VoidAsync(userId, car, second);
        Assert.Equal((OriginalDate, 40_000m), await LastDoneAsync(oil));
    }

    [Fact]
    public async Task KeptTask_NotFromThisRecord_MovesOnlyIfTheNewValuesAreAtLeastAsRecent()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var first = await RecordAsync(car, 100, 45_000, oil);
        await RecordAsync(car, 50, 47_000, oil);

        await EditAsync(car, first, Today.AddDays(-80), 46_000);
        Assert.Equal((Today.AddDays(-50), 47_000m), await LastDoneAsync(oil));

        await EditAsync(car, first, Today.AddDays(-20), 48_000);
        Assert.Equal((Today.AddDays(-20), 48_000m), await LastDoneAsync(oil));
    }

    // Review High: B's snapshot is A's old values; editing A must keep the chain, so voiding both, in either order, restores the original.
    [Theory]
    [InlineData("moveBeforeB", true)]
    [InlineData("moveBeforeB", false)]
    [InlineData("moveAfterB", true)]
    [InlineData("moveAfterB", false)]
    [InlineData("remove", true)]
    [InlineData("remove", false)]
    public async Task EditedRecord_KeepsTheSnapshotChain_SoVoidingBothRestoresTheOriginal(string edit, bool voidAFirst)
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var a = await RecordAsync(car, 100, 45_000, oil);
        var b = await RecordAsync(car, 50, 47_000, oil);

        await (edit switch
        {
            "moveBeforeB" => EditAsync(car, a, Today.AddDays(-80), 46_000),
            "moveAfterB" => EditAsync(car, a, Today.AddDays(-30), 48_000),
            _ => EditAsync(car, a, taskIds: [])
        });

        foreach (var record in voidAFirst ? new[] { a, b } : [b, a])
        {
            await tasks.VoidAsync(userId, car, record);
        }
        Assert.Equal((OriginalDate, 40_000m), await LastDoneAsync(oil));
    }

    // --- Criterion 4: errors save nothing ---

    [Fact]
    public async Task VoidedRecord_IsConflict_AndSavesNothing()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);
        await tasks.VoidAsync(userId, car, record);
        var before = await SnapshotAsync();

        var ex = await Assert.ThrowsAsync<ConflictException>(() => EditAsync(car, record, Today.AddDays(-50), 46_000, []));

        Assert.Equal("serviceRecord.alreadyVoided", ex.Code);
        Assert.Equal(before, await SnapshotAsync());
    }

    [Fact]
    public async Task AnotherUsersRecord_IsNotFound_AndAnotherCarsTask_IsTaskNotFound_AndSavesNothing()
    {
        var car = await CreateCarAsync();
        var oil = await CreateTaskAsync(car);
        var record = await RecordAsync(car, 100, 45_000, oil);
        var otherUser = Guid.NewGuid();
        var theirCar = await CreateCarAsync(otherUser);
        var theirTask = await CreateTaskAsync(theirCar, owner: otherUser);
        var myOtherCar = await CreateCarAsync();
        var myOtherTask = await CreateTaskAsync(myOtherCar);
        var before = await SnapshotAsync();

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() =>
            EditAsync(car, record, km: 46_000, user: otherUser))).Code);
        Assert.Equal("serviceRecord.notFound", (await Assert.ThrowsAsync<NotFoundException>(() =>
            EditAsync(theirCar, record, km: 46_000, user: otherUser))).Code);
        foreach (var task in new[] { theirTask, myOtherTask })
        {
            Assert.Equal("maintenanceTask.notFound", (await Assert.ThrowsAsync<NotFoundException>(() =>
                EditAsync(car, record, Today.AddDays(-50), 46_000, [task]))).Code);
        }
        Assert.Equal(before, await SnapshotAsync());
    }
}
