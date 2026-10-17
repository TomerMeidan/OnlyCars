using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
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

    [Fact]
    public async Task Tires_SwapOnSqlServer_OneOpenMountPerCarAndSet_AndUserDeleteCascades()
    {
        // MVP5-D: the swap closes the old mount and inserts the new one in one save, past the filtered unique indexes.
        var vehicles = new VehicleService(db);
        var tires = new TireService(db, vehicles);
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var a = await tires.CreateAsync(car.UserId, new TireSetRequest("A", null, null, TireSeason.Summer, null, null, null));
        var b = await tires.CreateAsync(car.UserId, new TireSetRequest("B", null, null, TireSeason.Winter, null, null, null));
        await tires.MountAsync(car.UserId, car.Id, new MountTireSetRequest(a.Id, today, 0));
        var swapped = await tires.MountAsync(car.UserId, car.Id, new MountTireSetRequest(b.Id, today, 10));
        Assert.Equal((b.Id, a.Id), (swapped.Current!.TireSetId, Assert.Single(swapped.Past).TireSetId));
        db.ChangeTracker.Clear();

        // A second open mount on the car (two simultaneous mounts) is refused by the index.
        db.TireMounts.Add(new TireMount { TireSetId = a.Id, VehicleId = car.Id, MountedAt = today });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // Deleting the user removes cars, sets and mounts in one statement (no cascade cycle).
        await db.Users.Where(u => u.Id == car.UserId).ExecuteDeleteAsync();
        Assert.Equal((0, 0, 0), (await db.Vehicles.CountAsync(), await db.TireSets.CountAsync(), await db.TireMounts.CountAsync()));
    }

    [Fact]
    public async Task TireChecks_OnSqlServer_DuplicateDateRefusedByTheIndex_ValuesChecked_AndSetDeleteCascades()
    {
        // MVP5-E: the unique (mount, date) check index refuses a second check on the same date; deletes cascade in the database.
        var tires = new TireService(db, new VehicleService(db));
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var set = await tires.CreateAsync(car.UserId, new TireSetRequest("A", null, null, TireSeason.Summer, null, null, null));
        var mount = (await tires.MountAsync(car.UserId, car.Id, new MountTireSetRequest(set.Id, today, 0))).Current!.Id;
        var check = await tires.AddCheckAsync(car.UserId, mount, new TireCheckRequest(today, [new(TirePosition.FL, 2.25m, 6.5m)]));
        await tires.AddRotationAsync(car.UserId, mount, new TireRotationRequest(today, 10, "x"));
        Assert.Equal(new TireCheckItemDto(TirePosition.FL, 2.25m, 6.5m), Assert.Single(check.Items));
        db.ChangeTracker.Clear();

        // A simultaneous request that passed the "already a check" query fails on the index even with other wheels.
        // (Turning that failure into a 409 is covered on InMemory in TireTests, not here.)
        db.TireChecks.Add(new TireCheck { TireMountId = mount, MeasuredAt = today, Measurements = [new() { Position = TirePosition.RR, PressureBar = 2 }] });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // The same wheel twice in one check, and a wheel with neither value, are refused.
        var checkId = (await db.TireChecks.SingleAsync()).Id;
        db.TireMeasurements.Add(new TireMeasurement { TireCheckId = checkId, Position = TirePosition.FL, PressureBar = 2 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.TireMeasurements.Add(new TireMeasurement { TireCheckId = checkId, Position = TirePosition.FR });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        await tires.DeleteAsync(car.UserId, set.Id);
        Assert.Equal((0, 0, 0, 0), (await db.TireMounts.CountAsync(), await db.TireChecks.CountAsync(), await db.TireMeasurements.CountAsync(),
            await db.TireRotations.CountAsync()));
    }

    // --- LOW-4: races on the real database. Each "other request" runs on its own context just before this request's save. ---

    private AppDbContext Context(BeforeSave? race = null) => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer(db.Database.GetConnectionString()).AddInterceptors(race is null ? [] : [race]).Options);

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    [Fact]
    public async Task ServiceRecord_OnSqlServer_VoidRacingAnEdit_ThrowsDbUpdateConcurrencyException_ANoOpEditDoesNot()
    {
        // L69: the UpdatedAt token on SQL Server. This checks the EF exception only; its 409 concurrency.conflict mapping is
        // GlobalExceptionHandlerTests.ConcurrencyException_Returns409_ConcurrencyConflict_WithoutEfDetails (L89).
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var record = (await new MaintenanceTaskService(db, new VehicleService(db)).CreateRecordAsync(car.UserId, car.Id,
            new CreateServiceRecordRequest(today, 1_000, "Shop", null, null, []))).Record;
        var race = new BeforeSave();
        await using var voider = Context(race);
        var voids = new MaintenanceTaskService(voider, new VehicleService(voider));

        // L70: an edit that changes nothing doesn't move UpdatedAt, so the void still succeeds.
        race.Next = async () =>
        {
            await using var other = Context();
            await new MaintenanceTaskService(other, new VehicleService(other)).UpdateRecordAsync(car.UserId, car.Id, record.Id,
                new UpdateServiceRecordRequest("Shop", null, null, null));
        };
        await voids.VoidAsync(car.UserId, car.Id, record.Id);

        var second = (await new MaintenanceTaskService(db, new VehicleService(db)).CreateRecordAsync(car.UserId, car.Id,
            new CreateServiceRecordRequest(today, 1_000, "Shop", null, null, [], ConfirmCorrection: true))).Record;
        race.Next = async () =>
        {
            await using var other = Context();
            await new MaintenanceTaskService(other, new VehicleService(other)).UpdateRecordAsync(car.UserId, car.Id, second.Id,
                new UpdateServiceRecordRequest("Other shop", null, null, null));
        };
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => voids.VoidAsync(car.UserId, car.Id, second.Id));

        await using var check = Context();
        var kept = await check.ServiceRecords.SingleAsync(r => r.Id == second.Id);
        Assert.Equal((false, "Other shop"), (kept.IsVoided, kept.ShopName));
    }

    [Fact]
    public async Task Vin_And_Email_OnSqlServer_SimultaneousDuplicate_IsTheNormalConflictCode()
    {
        // L66: the second insert fails on the real unique index and gets the same code as a non-simultaneous duplicate.
        var car = await AddCarAsync();
        var race = new BeforeSave();
        await using var context = Context(race);
        var vehicles = new VehicleService(context);
        CreateVehicleRequest Car(string name) => new(name, null, null, null, "VIN1", null, null, null, null, null, null);

        race.Next = async () =>
        {
            await using var other = Context();
            await new VehicleService(other).CreateAsync(car.UserId, Car("First"));
        };
        Assert.Equal("vehicle.vinTaken", await CodeAsync(() => vehicles.CreateAsync(car.UserId, Car("Second"))));
        context.ChangeTracker.Clear(); // a failed request's context is dropped

        // An edit to the VIN racing a create of it, too.
        race.Next = async () =>
        {
            await using var other = Context();
            await new VehicleService(other).CreateAsync(car.UserId, Car("Third") with { Vin = "VIN2" });
        };
        Assert.Equal("vehicle.vinTaken", await CodeAsync(() =>
            vehicles.UpdateAsync(car.UserId, car.Id, new UpdateVehicleRequest("Car", null, null, null, "VIN2", null, null, null, null, null))));
        context.ChangeTracker.Clear();

        var auth = new AuthService(context, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(new RateLimitOptions()));
        race.Next = async () =>
        {
            await using var other = Context();
            other.Users.Add(new User { Email = "same@x.test", PasswordHash = "x" });
            await other.SaveChangesAsync();
        };
        Assert.Equal("auth.emailTaken", await CodeAsync(() => auth.RegisterAsync(new RegisterRequest("same@x.test", "Passw0rd!"))));

        await using var check = Context();
        Assert.Equal((1, 1, 1), (await check.Vehicles.CountAsync(v => v.Vin == "VIN1"), await check.Vehicles.CountAsync(v => v.Vin == "VIN2"),
            await check.Users.CountAsync(u => u.Email == "same@x.test")));
    }

    /// <summary>Simulates another request saving first: runs <see cref="Next"/> once, at the start of the next save.</summary>
    private sealed class BeforeSave : SaveChangesInterceptor
    {
        public Func<Task>? Next { get; set; }

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (Next is { } next)
            {
                Next = null;
                await next();
            }

            return result;
        }
    }
}
