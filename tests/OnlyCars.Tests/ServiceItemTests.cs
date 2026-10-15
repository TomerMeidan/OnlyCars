using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP3-B: line items and editing service records. Criterion numbers refer to the ticket.</summary>
public class ServiceItemTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public ServiceItemTests()
    {
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    private static readonly ServiceItemRequest Part = new(" Oil filter ", " Mann ", " W 712/75 ", 2, 45.50m);
    private static readonly ServiceItemRequest Labour = new("Labour", null, null, 1.5m, 200, IsLabor: true);

    private async Task<Guid> CreateCarAsync(Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 50_000))).Id;

    private async Task<ServiceRecordDto> CreateAsync(Guid car, decimal? totalCost, params ServiceItemRequest[] items) =>
        (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today.AddDays(-10), 49_000, "Garage", totalCost, "Notes", null, Items: [.. items]))).Record;

    private Task<ServiceRecordDto> UpdateAsync(Guid car, Guid record, decimal? totalCost, params ServiceItemRequest[] items) =>
        tasks.UpdateRecordAsync(userId, car, record, new UpdateServiceRecordRequest("New shop", totalCost, "New notes", [.. items]));

    // --- Criterion 1 ---

    [Fact]
    public async Task Create_WithAPartAndLabour_ComputesTheTotal_IgnoresTheBodyTotal_AndListsItemsInOrder()
    {
        var car = await CreateCarAsync();

        var record = await CreateAsync(car, 5, Part, Labour);

        Assert.Equal(391.00m, record.TotalCost);
        Assert.Equal(["Oil filter", "Labour"], record.Items.Select(i => i.Description));
        var part = record.Items[0];
        Assert.Equal(("Mann", "W 712/75", 2m, 45.50m, false), (part.Brand, part.PartNumber, part.Quantity, part.UnitCost, part.IsLabor));
        var labour = record.Items[1];
        Assert.Equal(((string?)null, (string?)null, 1.5m, 200m, true), (labour.Brand, labour.PartNumber, labour.Quantity, labour.UnitCost, labour.IsLabor));

        db.ChangeTracker.Clear();
        var listed = Assert.Single(await tasks.ListRecordsAsync(userId, car));
        Assert.Equal(391.00m, listed.TotalCost);
        Assert.Equal(record.Items, listed.Items);
    }

    [Fact]
    public async Task Create_WithoutItems_KeepsTheEnteredTotal()
    {
        var car = await CreateCarAsync();

        Assert.Equal(120.50m, (await CreateAsync(car, 120.50m)).TotalCost);
        Assert.Null((await CreateAsync(car, null)).TotalCost);
        Assert.All(await tasks.ListRecordsAsync(userId, car), r => Assert.Empty(r.Items));
    }

    [Fact]
    public async Task Total_RoundsTheSumHalfAwayFromZero()
    {
        var car = await CreateCarAsync();

        // 0.5 x 0.01 = 0.005: banker's rounding would give 0.00.
        Assert.Equal(0.01m, (await CreateAsync(car, null, new ServiceItemRequest("Washer", null, null, 0.5m, 0.01m))).TotalCost);
    }

    // --- Criterion 2 ---

    [Fact]
    public async Task Update_ReplacesAndReordersItems_ThenClearingThemUsesTheBodyTotal()
    {
        var car = await CreateCarAsync();
        var created = await CreateAsync(car, null, Part, Labour);

        var reordered = await UpdateAsync(car, created.Id, 1, Labour with { Quantity = 2 }, Part with { Description = "Air filter" });

        Assert.Equal(("New shop", "New notes", 491.00m), (reordered.ShopName, reordered.Notes, reordered.TotalCost!.Value));
        Assert.Equal(["Labour", "Air filter"], reordered.Items.Select(i => i.Description));
        db.ChangeTracker.Clear();
        Assert.Equal(2, await db.ServiceItems.CountAsync());
        Assert.Equal(reordered.Items, (await tasks.ListRecordsAsync(userId, car)).Single().Items);

        var cleared = await UpdateAsync(car, created.Id, 80);
        Assert.Equal(80m, cleared.TotalCost);
        Assert.Empty(cleared.Items);
        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.ServiceItems.CountAsync());

        var nulls = await tasks.UpdateRecordAsync(userId, car, created.Id, new UpdateServiceRecordRequest("  ", null, " ", null));
        Assert.Equal(((string?)null, (decimal?)null, (string?)null), (nulls.ShopName, nulls.TotalCost, nulls.Notes));
    }

    [Fact]
    public async Task Update_LeavesDateOdometerTasksServiceReadingAndLastDoneUntouched()
    {
        var car = await CreateCarAsync();
        var task = await tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", 5_000, 730, 40_000, Today.AddDays(-400)));
        var created = (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(
            Today.AddDays(-10), 49_000, null, null, null, [task.Id]))).Record;
        db.ChangeTracker.Clear();
        var readingsBefore = await db.OdometerReadings.AsNoTracking().OrderBy(r => r.Id).ToListAsync();
        var taskBefore = await db.MaintenanceTasks.AsNoTracking().SingleAsync();
        var carBefore = await vehicles.GetAsync(userId, car);

        var updated = await UpdateAsync(car, created.Id, null, Part);

        Assert.Equal((created.Date, created.OdometerKm), (updated.Date, updated.OdometerKm));
        Assert.Equal(created.Tasks, updated.Tasks);
        db.ChangeTracker.Clear();
        var readingsAfter = await db.OdometerReadings.AsNoTracking().OrderBy(r => r.Id).ToListAsync();
        Assert.Equal(readingsBefore.Select(r => (r.Id, r.ValueKm, r.ReadingDate, r.Source, r.ServiceRecordId, r.UpdatedAt)),
            readingsAfter.Select(r => (r.Id, r.ValueKm, r.ReadingDate, r.Source, r.ServiceRecordId, r.UpdatedAt)));
        Assert.Contains(readingsAfter, r => r.ServiceRecordId == created.Id && r.Source == OdometerSource.Service);
        var taskAfter = await db.MaintenanceTasks.AsNoTracking().SingleAsync();
        Assert.Equal((taskBefore.LastDoneDate, taskBefore.LastDoneOdometerKm, taskBefore.UpdatedAt),
            (taskAfter.LastDoneDate, taskAfter.LastDoneOdometerKm, taskAfter.UpdatedAt));
        Assert.Equal(1, await db.ServiceRecordTasks.CountAsync());
        Assert.Equal(carBefore.CurrentOdometerKm, (await vehicles.GetAsync(userId, car)).CurrentOdometerKm);
    }

    // --- Criterion 3 ---

    public static TheoryData<ServiceItemRequest?, string> BadItems => new()
    {
        { null, "serviceItem.invalidDescription" },
        { new(null, null, null, 1, 1), "serviceItem.invalidDescription" },
        { new("   ", null, null, 1, 1), "serviceItem.invalidDescription" },
        { new(new string('d', 101), null, null, 1, 1), "serviceItem.invalidDescription" },
        { new("Part", new string('b', 101), null, 1, 1), "serviceItem.brandTooLong" },
        { new("Part", null, new string('p', 51), 1, 1), "serviceItem.partNumberTooLong" },
        { new("Part", null, null, null, 1), "serviceItem.invalidQuantity" },
        { new("Part", null, null, 0, 1), "serviceItem.invalidQuantity" },
        { new("Part", null, null, -1, 1), "serviceItem.invalidQuantity" },
        { new("Part", null, null, 10_000.01m, 1), "serviceItem.invalidQuantity" },
        { new("Part", null, null, 1.005m, 1), "serviceItem.invalidQuantity" },
        { new("Part", null, null, 1, null), "serviceItem.invalidUnitCost" },
        { new("Part", null, null, 1, -0.01m), "serviceItem.invalidUnitCost" },
        { new("Part", null, null, 1, 1_000_000.01m), "serviceItem.invalidUnitCost" },
        { new("Part", null, null, 1, 1.005m), "serviceItem.invalidUnitCost" },
    };

    [Theory]
    [MemberData(nameof(BadItems))]
    public async Task BadItem_ReturnsItsCodeWithTheRowIndex_AndSavesNothing_OnCreateAndUpdate(ServiceItemRequest? bad, string code)
    {
        var car = await CreateCarAsync();
        var create = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync(car, null, Part, bad!));
        Assert.Equal((code, (object?)1), (create.Code, create.Extensions["index"]));
        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.ServiceRecords.CountAsync());

        var record = await CreateAsync(car, null, Part);
        var update = await Assert.ThrowsAsync<ValidationFailedException>(() => UpdateAsync(car, record.Id, null, Labour, bad!));
        Assert.Equal((code, (object?)1), (update.Code, update.Extensions["index"]));
        await AssertUnchangedAsync(record);
    }

    [Fact]
    public async Task ValidItemLimits_AreAccepted()
    {
        var car = await CreateCarAsync();

        var record = await CreateAsync(car, null,
            new(new string('d', 100), new string('b', 100), new string('p', 50), 10_000, 0),
            new("x", "  ", "", 0.01m, 1_000_000));

        Assert.Equal(10_000m, record.TotalCost);
        Assert.Equal(((string?)null, (string?)null), (record.Items[1].Brand, record.Items[1].PartNumber));
    }

    [Fact]
    public async Task SumOverOneMillion_IsInvalidCost_AndExactlyOneMillionIsAccepted()
    {
        var car = await CreateCarAsync();
        var half = new ServiceItemRequest("Engine", null, null, 1, 500_000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync(car, 1, half, half with { UnitCost = 500_000.01m }));
        Assert.Equal("serviceRecord.invalidCost", ex.Code);
        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.ServiceRecords.CountAsync());

        var record = await CreateAsync(car, null, half, half);
        Assert.Equal(1_000_000m, record.TotalCost);
        var update = await Assert.ThrowsAsync<ValidationFailedException>(() => UpdateAsync(car, record.Id, null, half, half, Labour));
        Assert.Equal("serviceRecord.invalidCost", update.Code);
        await AssertUnchangedAsync(record);
    }

    [Fact]
    public async Task FiftyItemsAreAccepted_FiftyOneAreTooMany()
    {
        var car = await CreateCarAsync();

        var record = await CreateAsync(car, null, [.. Enumerable.Repeat(Labour, 50)]);
        Assert.Equal(50, record.Items.Count);

        var create = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync(car, null, [.. Enumerable.Repeat(Labour, 51)]));
        Assert.Equal("serviceRecord.tooManyItems", create.Code);
        var update = await Assert.ThrowsAsync<ValidationFailedException>(() => UpdateAsync(car, record.Id, null, [.. Enumerable.Repeat(Part, 51)]));
        Assert.Equal("serviceRecord.tooManyItems", update.Code);
        await AssertUnchangedAsync(record);
    }

    [Fact]
    public async Task Update_ShopNotesAndHandEnteredCostRules_ApplyAndSaveNothing()
    {
        var car = await CreateCarAsync();
        var record = await CreateAsync(car, null, Part);

        Assert.Equal("serviceRecord.shopTooLong", (await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.UpdateRecordAsync(userId, car, record.Id,
            new UpdateServiceRecordRequest(new string('s', 101), null, null, null)))).Code);
        Assert.Equal("serviceRecord.notesTooLong", (await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.UpdateRecordAsync(userId, car, record.Id,
            new UpdateServiceRecordRequest(null, null, new string('n', 1_001), null)))).Code);
        Assert.Equal("serviceRecord.invalidCost", (await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.UpdateRecordAsync(userId, car, record.Id,
            new UpdateServiceRecordRequest(null, 1.001m, null, null)))).Code);
        await AssertUnchangedAsync(record);
    }

    // --- Criterion 4 ---

    [Fact]
    public async Task Update_VoidedRecordIsConflict()
    {
        var car = await CreateCarAsync();
        var record = await CreateAsync(car, null, Part);
        await tasks.VoidAsync(userId, car, record.Id);

        var ex = await Assert.ThrowsAsync<ConflictException>(() => UpdateAsync(car, record.Id, 1));
        Assert.Equal("serviceRecord.alreadyVoided", ex.Code);
        db.ChangeTracker.Clear();
        Assert.Equal("Garage", (await db.ServiceRecords.SingleAsync()).ShopName);
        Assert.Equal(1, await db.ServiceItems.CountAsync());
    }

    [Fact]
    public async Task Update_AnotherUsersRecordOrCar_IsNotFound()
    {
        var car = await CreateCarAsync();
        var record = await CreateAsync(car, null, Part);
        var otherUser = Guid.NewGuid();
        var theirCar = await CreateCarAsync(otherUser);
        var myOtherCar = await CreateCarAsync();

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() =>
            tasks.UpdateRecordAsync(otherUser, car, record.Id, new UpdateServiceRecordRequest(null, 1, null, null)))).Code);
        Assert.Equal("serviceRecord.notFound", (await Assert.ThrowsAsync<NotFoundException>(() =>
            tasks.UpdateRecordAsync(otherUser, theirCar, record.Id, new UpdateServiceRecordRequest(null, 1, null, null)))).Code);
        Assert.Equal("serviceRecord.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => UpdateAsync(myOtherCar, record.Id, 1))).Code);
        Assert.Equal("serviceRecord.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => UpdateAsync(car, Guid.NewGuid(), 1))).Code);
        await AssertUnchangedAsync(record);
    }

    private async Task AssertUnchangedAsync(ServiceRecordDto expected)
    {
        db.ChangeTracker.Clear();
        var stored = Assert.Single(await tasks.ListRecordsAsync(userId, (await db.ServiceRecords.SingleAsync(r => r.Id == expected.Id)).VehicleId));
        Assert.Equal((expected.ShopName, expected.TotalCost, expected.Notes), (stored.ShopName, stored.TotalCost, stored.Notes));
        Assert.Equal(expected.Items, stored.Items);
    }
}
