using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>
/// Runs the real migrations on a throwaway LocalDB database, because the InMemory provider
/// enforces neither check constraints nor database cascades.
/// shortcut: needs SQL Server LocalDB on the machine; switch to a container or CI database when there is a CI.
/// </summary>
public class MaintenanceSchemaTests : IAsyncLifetime
{
    private readonly AppDbContext db = new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer($@"Server=(localdb)\mssqllocaldb;Database=OnlyCars_Test_{Guid.NewGuid():N};Trusted_Connection=True;TrustServerCertificate=True")
        .Options);

    public async Task InitializeAsync() => await db.Database.MigrateAsync();

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    private async Task<Vehicle> AddCarAsync()
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = "Car" };
        db.Vehicles.Add(car);
        await db.SaveChangesAsync();
        return car;
    }

    [Fact]
    public async Task Migrations_SeedTwelveTemplates_EnforceIntervalCheck_AndCascadeVehicleDelete()
    {
        // Criterion 1: a fresh database has exactly the 12 templates, in seed order of their fixed ids.
        var keys = await db.TaskTemplates.OrderBy(t => t.Id).Select(t => t.Key).ToListAsync();
        Assert.Equal(["oilChange", "airFilter", "cabinFilter", "brakePads", "brakeFluid", "coolant",
            "transmissionFluid", "sparkPlugs", "timingBelt", "tireRotation", "battery", "wiperBlades"], keys);

        // Criterion 4: the check constraint rejects a task with neither interval.
        var car = await AddCarAsync();
        db.MaintenanceTasks.Add(new MaintenanceTask { VehicleId = car.Id, Name = "No interval", Category = TaskCategory.Other });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // Criterion 10: deleting the vehicle in the database cascades to its tasks and leaves the template.
        var template = await db.TaskTemplates.FirstAsync();
        db.MaintenanceTasks.Add(new MaintenanceTask { VehicleId = car.Id, TemplateId = template.Id, Name = "Oil", IntervalKm = 1 });
        await db.SaveChangesAsync();
        await db.Vehicles.Where(v => v.Id == car.Id).ExecuteDeleteAsync();

        Assert.Equal(0, await db.MaintenanceTasks.CountAsync());
        Assert.Equal(12, await db.TaskTemplates.CountAsync());
    }

    [Fact]
    public async Task ServiceRecords_DeletingATaskKeepsTheRecordAndReading_AndVehicleDeleteCascadesWithoutCycles()
    {
        // MVP2-C criterion 9, through the real services: delete removes the join row, keeps the record and its reading.
        var vehicles = new VehicleService(db);
        var tasks = new MaintenanceTaskService(db, vehicles);
        var car = await AddCarAsync();
        db.OdometerReadings.Add(new OdometerReading { VehicleId = car.Id, ValueKm = 1_000, ReadingDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-30) });
        db.MaintenanceTasks.Add(new MaintenanceTask { VehicleId = car.Id, Name = "Oil", IntervalKm = 5_000 });
        await db.SaveChangesAsync();
        var task = await db.MaintenanceTasks.SingleAsync(t => t.VehicleId == car.Id);

        var reset = await tasks.ResetAsync(car.UserId, car.Id, task.Id, null);
        await tasks.DeleteAsync(car.UserId, car.Id, task.Id);
        db.ChangeTracker.Clear();

        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
        Assert.True(await db.ServiceRecords.AnyAsync(r => r.Id == reset.ServiceRecordId));
        Assert.True(await db.OdometerReadings.AnyAsync(r => r.ServiceRecordId == reset.ServiceRecordId));

        // Undo after the task is gone still voids the record and removes its reading, with no tasks to return.
        Assert.Empty(await tasks.VoidAsync(car.UserId, car.Id, reset.ServiceRecordId));
        db.ChangeTracker.Clear();

        // Deleting the vehicle in the database cascades through records, join rows, tasks and readings in one statement.
        db.MaintenanceTasks.Add(new MaintenanceTask { VehicleId = car.Id, Name = "Oil", IntervalKm = 5_000 });
        await db.SaveChangesAsync();
        await tasks.ResetAsync(car.UserId, car.Id, (await db.MaintenanceTasks.SingleAsync(t => t.VehicleId == car.Id)).Id, null);
        await db.Vehicles.Where(v => v.Id == car.Id).ExecuteDeleteAsync();

        Assert.Equal(0, await db.ServiceRecords.CountAsync());
        Assert.Equal(0, await db.ServiceRecordTasks.CountAsync());
        Assert.Equal(0, await db.OdometerReadings.CountAsync());
    }

    [Fact]
    public async Task ServiceItems_EnforceQuantityAndUnitCostChecks_AndCascadeFromRecordAndVehicle()
    {
        // MVP3-B: Quantity > 0 and UnitCost >= 0 in the database; items go with their record, and with the vehicle.
        var car = await AddCarAsync();
        var record = new ServiceRecord { VehicleId = car.Id, Date = DateOnly.FromDateTime(DateTime.UtcNow), OdometerKm = 1_000 };
        db.ServiceRecords.Add(record);
        await db.SaveChangesAsync();

        db.ServiceItems.Add(new ServiceItem { ServiceRecordId = record.Id, Description = "Zero", Quantity = 0, UnitCost = 1 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.ServiceItems.Add(new ServiceItem { ServiceRecordId = record.Id, Description = "Negative", Quantity = 1, UnitCost = -1 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        db.ServiceItems.Add(new ServiceItem { ServiceRecordId = record.Id, Description = "Oil", Quantity = 4.5m, UnitCost = 0 });
        await db.SaveChangesAsync();
        await db.ServiceRecords.Where(r => r.Id == record.Id).ExecuteDeleteAsync();
        Assert.Equal(0, await db.ServiceItems.CountAsync());

        var second = new ServiceRecord { VehicleId = car.Id, Date = record.Date, OdometerKm = 1_000 };
        second.Items.Add(new ServiceItem { Description = "Labour", Quantity = 1, UnitCost = 100, IsLabor = true });
        db.ServiceRecords.Add(second);
        await db.SaveChangesAsync();
        await db.Vehicles.Where(v => v.Id == car.Id).ExecuteDeleteAsync();
        Assert.Equal(0, await db.ServiceItems.CountAsync());
    }

    [Fact]
    public async Task Checklists_ClearTheRunItemLinkOnItemDelete_DeleteRunReadings_AndCascadeVehicleDeleteWithoutCycles()
    {
        // MVP5-B: the no-cascade paths (template item and reading) are handled by the services on SQL Server too.
        var vehicles = new VehicleService(db);
        var templates = new ChecklistTemplateService(db);
        var checklists = new VehicleChecklistService(db, vehicles);
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var t = await templates.CreateAsync(car.UserId, new ChecklistTemplateRequest("Quick", [
            new(null, "Lights", "Check", null, null, null), new(null, "Tires", "Number", "bar", 2m, 3m)]));
        var c = await checklists.AttachAsync(car.UserId, car.Id, new AttachChecklistRequest(t.Id, null, 30, today));
        List<ChecklistRunItemRequest?> answers = [new(t.Items[0].Id, false, null, null), new(t.Items[1].Id, null, 2.5m, null)];
        var run = await checklists.CreateRunAsync(car.UserId, c.Id, new CreateChecklistRunRequest(today, 1_000, null, answers));

        await templates.UpdateAsync(car.UserId, t.Id, new ChecklistTemplateRequest("Quick", [new(t.Items[0].Id, "Lights", "Check", null, null, null)]));
        db.ChangeTracker.Clear();
        Assert.Equal(["Lights", "Tires"], (await checklists.ListRunsAsync(car.UserId, c.Id)).Single().Items.Select(i => i.Label));

        await checklists.DeleteRunAsync(car.UserId, run.Run.Id);
        db.ChangeTracker.Clear();
        Assert.Equal(0, await db.OdometerReadings.CountAsync(r => r.VehicleId == car.Id && r.Source == OdometerSource.Checklist));

        // A run with a reading and items goes with the car in one statement; the template stays.
        await checklists.CreateRunAsync(car.UserId, c.Id, new CreateChecklistRunRequest(today, 1_000, null, [answers[0]]));
        db.ChangeTracker.Clear();
        await db.Vehicles.Where(v => v.Id == car.Id).ExecuteDeleteAsync();
        Assert.Equal((0, 0, 0, 0), (await db.VehicleChecklists.CountAsync(), await db.ChecklistRuns.CountAsync(),
            await db.ChecklistRunItems.CountAsync(), await db.OdometerReadings.CountAsync()));
        Assert.Equal(1, await db.ChecklistTemplates.CountAsync());
    }
}
