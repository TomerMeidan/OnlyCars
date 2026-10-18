using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>ACC-1 fix round: per-account caps so an account (and its export) can't grow without bound.</summary>
public class AccountCapsTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly OdometerService odometer;
    private readonly Guid userId = Guid.NewGuid();

    public AccountCapsTests()
    {
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
        odometer = new OdometerService(db, vehicles);
    }

    private static CreateVehicleRequest Car(string name) => new(name, null, null, null, null, null, null, null, null, null, null);

    private static async Task AssertCapAsync(string code, int max, Func<Task> act)
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(act);
        Assert.Equal((code, (object?)max), (ex.Code, ex.Extensions["max"]));
    }

    // A car at 10,000 km with `records` service records (every other one voided) and `readings` readings dated before today.
    private async Task<(Guid Car, Guid Task)> SeedCarAsync(int records, int readings)
    {
        var car = new Vehicle { UserId = userId, Nickname = "Full", CurrentOdometerKm = 10_000 };
        var task = new MaintenanceTask { VehicleId = car.Id, Name = "Oil", IntervalKm = 10_000 };
        db.AddRange(car, task);
        db.ServiceRecords.AddRange(Enumerable.Range(0, records).Select(i =>
            new ServiceRecord { VehicleId = car.Id, Date = Today.AddDays(-1), OdometerKm = 5_000, IsVoided = i % 2 == 0 }));
        db.OdometerReadings.AddRange(Enumerable.Range(0, readings).Select(i =>
            new OdometerReading { VehicleId = car.Id, ValueKm = 10_000 * i / readings, ReadingDate = Today.AddDays(-1), Source = OdometerSource.Manual }));
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        return (car.Id, task.Id);
    }

    [Fact]
    public async Task Vehicles_The51stIsRefused_ArchivedCount_OtherUsersDoNot()
    {
        var other = Guid.NewGuid();
        db.Vehicles.AddRange(Enumerable.Range(0, Vehicle.MaxPerUser - 1).Select(i =>
            new Vehicle { UserId = userId, Nickname = $"Car {i}", IsArchived = i == 0 }));
        db.Vehicles.AddRange(Enumerable.Range(0, Vehicle.MaxPerUser).Select(i => new Vehicle { UserId = other, Nickname = $"Theirs {i}" }));
        await db.SaveChangesAsync();

        await vehicles.CreateAsync(userId, Car("50th"));
        await AssertCapAsync("vehicle.tooMany", 50, () => vehicles.CreateAsync(userId, Car("51st")));
        Assert.Equal(50, await db.Vehicles.CountAsync(v => v.UserId == userId));
        await vehicles.CreateAsync(Guid.NewGuid(), Car("Someone else's first"));
    }

    [Fact]
    public async Task ServiceRecords_The2001stIsRefused_VoidedCount_BothWays()
    {
        var (car, task) = await SeedCarAsync(ServiceRecord.MaxPerVehicle, 1);

        await AssertCapAsync("serviceRecord.tooMany", 2000, () => tasks.CreateRecordAsync(userId, car,
            new CreateServiceRecordRequest(Today, 10_000, null, null, null, null)));
        await AssertCapAsync("serviceRecord.tooMany", 2000, () => tasks.ResetAsync(userId, car, task, null));
        db.ChangeTracker.Clear();
        Assert.Equal(2000, await db.ServiceRecords.CountAsync());
        Assert.Equal(1, await db.OdometerReadings.CountAsync());
    }

    [Fact]
    public async Task ServiceRecords_The2000thIsAllowed()
    {
        var (car, _) = await SeedCarAsync(ServiceRecord.MaxPerVehicle - 1, 1);

        await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Today, 10_000, null, null, null, null));

        Assert.Equal(2000, await db.ServiceRecords.CountAsync());
    }

    [Fact]
    public async Task Readings_The5001stIsRefused_FromEverySource()
    {
        var (car, task) = await SeedCarAsync(0, OdometerReading.MaxPerVehicle);
        var templates = new ChecklistTemplateService(db);
        var checklists = new VehicleChecklistService(db, vehicles);
        var template = await templates.CreateAsync(userId, new ChecklistTemplateRequest("Quick", [new(null, "Lights", "Check", null, null, null)]));
        var checklist = await checklists.AttachAsync(userId, car, new AttachChecklistRequest(template.Id, null, 30, Today));
        List<ChecklistRunItemRequest?> answers = [new ChecklistRunItemRequest(template.Items[0].Id, true, null, null)];

        await AssertCapAsync("odometer.tooMany", 5000, () => odometer.AddAsync(userId, car, new AddOdometerReadingRequest(10_500, Today)));
        await AssertCapAsync("odometer.tooMany", 5000, () => tasks.CreateRecordAsync(userId, car,
            new CreateServiceRecordRequest(Today, 10_500, null, null, null, null)));
        db.ChangeTracker.Clear();
        await AssertCapAsync("odometer.tooMany", 5000, () => tasks.ResetAsync(userId, car, task, null));
        db.ChangeTracker.Clear();
        await AssertCapAsync("odometer.tooMany", 5000, () => checklists.CreateRunAsync(userId, checklist.Id,
            new CreateChecklistRunRequest(Today, 10_500, null, answers)));
        db.ChangeTracker.Clear();
        Assert.Equal(5000, await db.OdometerReadings.CountAsync());
        Assert.Equal(0, await db.ServiceRecords.CountAsync());

        // A run without an odometer adds no reading, so it is still allowed.
        await checklists.CreateRunAsync(userId, checklist.Id, new CreateChecklistRunRequest(Today, null, null, answers));
    }
}
