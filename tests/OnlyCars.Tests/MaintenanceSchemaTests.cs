using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Npgsql;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Tires.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>
/// Runs the real migrations on a throwaway Postgres database, because the InMemory provider
/// enforces neither check constraints nor database cascades.
/// </summary>
public class MaintenanceSchemaTests : IAsyncLifetime
{
    private readonly AppDbContext db = new(TestDbContextFactory.PostgresOptions(TestDbContextFactory.NewPostgresConnection()).Options);

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
    public async Task Migrations_SeedTheHebrewTemplateNames_AndTheSearchRunsOnPostgres()
    {
        // SRCH-1a: NameHe equals the Hebrew templates.* texts in client/src/i18n.ts.
        Assert.Equal(["שמן מנוע ופילטר שמן", "פילטר אוויר", "פילטר מזגן", "בדיקת רפידות בלמים", "נוזל בלמים", "נוזל קירור", "שמן גיר", "מצתים",
            "רצועת טיימינג", "רוטציית צמיגים", "בדיקת מצבר", "מגבים"], await db.TaskTemplates.OrderBy(t => t.Id).Select(t => t.NameHe).ToListAsync());

        // The words, the tire-change test, the totals and each sort (a repeated ORDER BY column failed on SQL Server, kept as a check) translate and run.
        var tasks = new MaintenanceTaskService(db, new VehicleService(db));
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var oil = new MaintenanceTask { VehicleId = car.Id, TemplateId = Guid.Parse("7a5c0000-0000-4000-8000-000000000001"), Name = "Shemen", IntervalKm = 1 };
        var oilRecord = new ServiceRecord { VehicleId = car.Id, Date = today, OdometerKm = 1_000, TotalCost = 100.50m };
        oilRecord.Tasks.Add(new ServiceRecordTask { MaintenanceTask = oil, PreviousLastDoneDate = today });
        var tireRecord = new ServiceRecord { VehicleId = car.Id, Date = today.AddDays(-1), OdometerKm = 900 };
        db.AddRange(oil, oilRecord, tireRecord, new Tire { VehicleId = car.Id, Position = TirePosition.FL, Brand = "X", FittedAt = today, ServiceRecord = tireRecord });
        await db.SaveChangesAsync();

        var oilPage = await tasks.SearchRecordsAsync(car.UserId, null, null, null, null, "שמן OIL", 0, 10);
        Assert.Equal((oilRecord.Id, 1, 100.50m, 100.50m, today), (Assert.Single(oilPage.Items).Id, oilPage.TotalCount, oilPage.TotalCost,
            oilPage.AverageCost, oilPage.LastDate));
        var tirePage = await tasks.SearchRecordsAsync(car.UserId, null, null, null, null, "צמיגים", 0, 10);
        Assert.Equal((tireRecord.Id, 1), (Assert.Single(tirePage.Items).Id, tirePage.Items[0].TireCount));
        foreach (var sort in new[] { "date", "cost", "odometer" })
        {
            Assert.Equal(2, (await tasks.SearchRecordsAsync(car.UserId, null, null, null, null, null, 0, 10, default, sort, "asc")).Items.Count);
        }
        Assert.Equal([oilRecord.Id, tireRecord.Id],
            (await tasks.SearchRecordsAsync(car.UserId, null, null, null, null, null, 0, 10, default, "cost", "asc")).Items.Select(r => r.Id));
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
    public async Task Attachments_OnPostgres_AreIndexedByRecord_AndCascadeFromRecordAndVehicle()
    {
        // FILE-2: rows go with their record, and with the vehicle; IX_Attachments_ServiceRecordId exists.
        var car = await AddCarAsync();
        ServiceRecord NewRecord() => new()
        {
            VehicleId = car.Id, Date = DateOnly.FromDateTime(DateTime.UtcNow), OdometerKm = 1_000,
            Attachments = { new Attachment { FileUrl = "k", FileName = "r.pdf", ContentType = "application/pdf", SizeBytes = 5 } }
        };
        var record = NewRecord();
        db.ServiceRecords.AddRange(record, NewRecord());
        await db.SaveChangesAsync();
        Assert.Equal(2, await db.Attachments.CountAsync());

        await db.ServiceRecords.Where(r => r.Id == record.Id).ExecuteDeleteAsync();
        Assert.Equal(1, await db.Attachments.CountAsync());
        await db.Vehicles.Where(v => v.Id == car.Id).ExecuteDeleteAsync();
        Assert.Equal(0, await db.Attachments.CountAsync());

        var index = await db.Database.SqlQuery<string>(
            $"SELECT a.attname::text AS \"Value\" FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE c.relname = 'IX_Attachments_ServiceRecordId'")
            .ToListAsync();
        Assert.Equal(["ServiceRecordId"], index);
    }

    [Fact]
    public async Task Checklists_ClearTheRunItemLinkOnItemDelete_DeleteRunReadings_AndCascadeVehicleDeleteWithoutCycles()
    {
        // MVP5-B: the no-cascade paths (template item and reading) are handled by the services on Postgres too.
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
    public async Task Tires_OnPostgres_ReplaceAndSwaps_PassTheOneTirePerWheelIndex_AndUserDeleteCascades()
    {
        // TIRE-2: Replace closes and fits in one save, and a rotation swaps wheels, past the filtered unique (car, position) index.
        var vehicles = new VehicleService(db);
        var tasks = new MaintenanceTaskService(db, vehicles);
        var tires = new TireService(db, vehicles, tasks);
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        TireRotationMoveRequest Move(TirePosition from, TirePosition to) => new(from, to);
        async Task<Dictionary<TirePosition, Guid>> OnCar() => (await tires.GetVehicleTiresAsync(car.UserId, car.Id)).Current.ToDictionary(t => t.Position, t => t.Id);

        await tires.ReplaceAsync(car.UserId, car.Id, new ReplaceTiresRequest([TirePosition.FL, TirePosition.FR, TirePosition.RL, TirePosition.RR], today.AddDays(-10),
            1_000, "A", null, null, TireSeason.Summer, null, null, null, null, null));
        var replaced = await tires.ReplaceAsync(car.UserId, car.Id, new ReplaceTiresRequest([TirePosition.FL, TirePosition.FR], today.AddDays(-5), 2_000,
            "B", null, null, TireSeason.Winter, null, null, 400, null, null));
        Assert.Equal((4, 2), (replaced.Current.Count, replaced.Removed.Count));
        var ids = await OnCar();

        var swap = await tires.AddRotationAsync(car.UserId, car.Id, new TireRotationRequest(today.AddDays(-4), 2_100, null,
            [Move(TirePosition.FL, TirePosition.FR), Move(TirePosition.FR, TirePosition.FL)]));
        var cycle = await tires.AddRotationAsync(car.UserId, car.Id, new TireRotationRequest(today.AddDays(-3), 2_200, null,
            [Move(TirePosition.FL, TirePosition.RL), Move(TirePosition.RL, TirePosition.RR), Move(TirePosition.RR, TirePosition.FR), Move(TirePosition.FR, TirePosition.FL)]));
        db.ChangeTracker.Clear();
        var rotated = await OnCar();
        Assert.Equal((ids[TirePosition.FL], ids[TirePosition.RR], ids[TirePosition.FR], ids[TirePosition.RL]),
            (rotated[TirePosition.FL], rotated[TirePosition.FR], rotated[TirePosition.RL], rotated[TirePosition.RR]));
        await tires.DeleteRotationAsync(car.UserId, cycle.Id);
        await tires.DeleteRotationAsync(car.UserId, swap.Id);
        db.ChangeTracker.Clear();
        Assert.Equal(ids, await OnCar());

        // A second tire on a wheel, and a removal before the fitting, are refused by the database.
        db.Tires.Add(new Tire { VehicleId = car.Id, Position = TirePosition.FL, Brand = "X", FittedAt = today });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.Tires.Add(new Tire { VehicleId = car.Id, Position = TirePosition.Spare, Brand = "X", FittedAt = today, RemovedAt = today.AddDays(-1), RemovedOdometerKm = 0 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // Voiding the Replace record keeps its tires and clears their link (the key is NoAction).
        var record = await db.ServiceRecords.SingleAsync();
        await tasks.VoidAsync(car.UserId, car.Id, record.Id);
        db.ChangeTracker.Clear();
        Assert.Equal(6, await db.Tires.CountAsync(t => t.ServiceRecordId == null));

        // Deleting the user removes cars, records, tires, measurements, rotations and moves in one statement, a tire linked to a record included.
        await db.Tires.Where(t => t.RemovedAt == null).ExecuteUpdateAsync(u => u.SetProperty(t => t.ServiceRecordId, record.Id));
        await tires.AddCheckAsync(car.UserId, car.Id, new TireCheckRequest(today, [new(TirePosition.FL, 2.2m, null)]));
        await tires.AddRotationAsync(car.UserId, car.Id, new TireRotationRequest(today, 2_300, null, [Move(TirePosition.FL, TirePosition.FR), Move(TirePosition.FR, TirePosition.FL)]));
        await db.Users.Where(u => u.Id == car.UserId).ExecuteDeleteAsync();
        Assert.Equal((0, 0, 0, 0, 0, 0), (await db.Vehicles.CountAsync(), await db.ServiceRecords.CountAsync(), await db.Tires.CountAsync(),
            await db.TireMeasurements.CountAsync(), await db.TireRotations.CountAsync(), await db.TireRotationMoves.CountAsync()));
    }

    [Fact]
    public async Task TireMeasurements_OnPostgres_SameTireAndDateRefusedByTheIndex_ValuesChecked_AndTireDeleteCascades()
    {
        var vehicles = new VehicleService(db);
        var tires = new TireService(db, vehicles, new MaintenanceTaskService(db, vehicles));
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var fl = Assert.Single((await tires.ReplaceAsync(car.UserId, car.Id, new ReplaceTiresRequest([TirePosition.FL], today, 0, "A", null, null,
            TireSeason.Summer, null, null, null, null, null))).Current).Id;
        var check = await tires.AddCheckAsync(car.UserId, car.Id, new TireCheckRequest(today, [new(TirePosition.FL, 2.25m, 6.5m)]));
        Assert.Equal(new TireCheckItemDto(fl, TirePosition.FL, 2.25m, 6.5m), Assert.Single(check.Items));
        db.ChangeTracker.Clear();

        // A simultaneous request that passed the "already measured" query fails on the index. (Its 409 is covered on InMemory in TireTests.)
        db.TireMeasurements.Add(new TireMeasurement { TireId = fl, Position = TirePosition.FL, MeasuredAt = today, PressureBar = 2 });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();
        db.TireMeasurements.Add(new TireMeasurement { TireId = fl, Position = TirePosition.FL, MeasuredAt = today.AddDays(-1) });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        await tires.DeleteAsync(car.UserId, fl);
        Assert.Equal((0, 0), (await db.Tires.CountAsync(), await db.TireMeasurements.CountAsync()));
    }

    // --- LOW-4: races on the real database. Each "other request" runs on its own context just before this request's save. ---

    private AppDbContext Context(BeforeSave? race = null) => new(TestDbContextFactory.PostgresOptions(db.Database.GetConnectionString()!).AddInterceptors(race is null ? [] : [race]).Options);

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    [Fact]
    public async Task ServiceRecord_OnPostgres_VoidRacingAnEdit_ThrowsDbUpdateConcurrencyException_ANoOpEditDoesNot()
    {
        // L69: the UpdatedAt token on Postgres. This checks the EF exception only; its 409 concurrency.conflict mapping is
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
    public async Task Vin_And_Email_OnPostgres_SimultaneousDuplicate_IsTheNormalConflictCode()
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

    // --- FILE-2: uploads racing on the real database (InMemory has no transactions, so a failed save there keeps its insert). ---

    private static readonly byte[] Pdf = "%PDF-1.7\n%%EOF\n"u8.ToArray();
    private readonly FakeFileStorage storage = new();

    // Each racer gets its own context, as two requests would; the fake storage is shared.
    private MaintenanceTaskService Racer()
    {
        var context = Context();
        return new MaintenanceTaskService(context, new VehicleService(context, storage));
    }

    private async Task WaitForPutsAsync(int count)
    {
        var waited = Task.Run(async () =>
        {
            while (storage.Waiting < count)
            {
                await Task.Delay(10);
            }
        });
        Assert.Same(waited, await Task.WhenAny(waited, Task.Delay(TimeSpan.FromSeconds(10))));
    }

    private static async Task<Exception?> Settle(Task task)
    {
        try
        {
            await task;
            return null;
        }
        catch (Exception ex)
        {
            return ex;
        }
    }

    private async Task<(Vehicle Car, Guid Record)> RecordWithFilesAsync(int files)
    {
        var car = await AddCarAsync();
        var record = (await Racer().CreateRecordAsync(car.UserId, car.Id, new CreateServiceRecordRequest(null, 1_000, null, null, null, []))).Record.Id;
        for (var i = 0; i < files; i++)
        {
            await Racer().AddAttachmentAsync(car.UserId, car.Id, record, Pdf, $"{i}.pdf");
        }

        return (car, record);
    }

    [Fact]
    public async Task Attachment_OnPostgres_AVoidThatSavesDuringTheUpload_Wins_TheUploadIsAConcurrencyException_AndItsObjectIsDeleted()
    {
        var (car, record) = await RecordWithFilesAsync(0);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var upload = Task.Run(() => Racer().AddAttachmentAsync(car.UserId, car.Id, record, Pdf, "late.pdf"));
        await WaitForPutsAsync(1);
        await Racer().VoidAsync(car.UserId, car.Id, record);
        storage.PutGate.SetResult();

        // The handler turns it into 409 concurrency.conflict (GlobalExceptionHandlerTests).
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => upload);
        await using var check = Context();
        Assert.Empty(check.Attachments);
        Assert.Empty(storage.Objects);
        Assert.True((await check.ServiceRecords.SingleAsync(r => r.Id == record)).IsVoided);
    }

    [Fact]
    public async Task Attachment_OnPostgres_TwoSimultaneousUploadsAtNineFiles_OnlyOneSaves_TheOthersObjectIsDeleted()
    {
        var (car, record) = await RecordWithFilesAsync(Attachment.MaxPerParent - 1);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = Task.Run(() => Racer().AddAttachmentAsync(car.UserId, car.Id, record, Pdf, "a.pdf"));
        var second = Task.Run(() => Racer().AddAttachmentAsync(car.UserId, car.Id, record, Pdf, "b.pdf"));
        await WaitForPutsAsync(2);
        storage.PutGate.SetResult();

        var results = await Task.WhenAll(Settle(first), Settle(second));
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is DbUpdateConcurrencyException);
        await using var check = Context();
        var keys = await check.Attachments.Select(a => a.FileUrl).ToListAsync();
        Assert.Equal(Attachment.MaxPerParent, keys.Count);
        Assert.Equal(keys.Order(), storage.Objects.Keys.Order());
    }

    // --- L116: car photo replacements racing on the real database (the conditional update needs a relational provider). ---

    [Fact]
    public async Task Photo_OnPostgres_TwoSimultaneousReplacements_OneWins_TheOtherIsAConflict_ExactlyOneObjectRemains()
    {
        var car = await AddCarAsync();
        await new VehicleService(Context(), storage).SetPhotoAsync(car.UserId, car.Id, Png);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = Task.Run(() => new VehicleService(Context(), storage).SetPhotoAsync(car.UserId, car.Id, Png));
        var second = Task.Run(() => new VehicleService(Context(), storage).SetPhotoAsync(car.UserId, car.Id, Png));
        await WaitForPutsAsync(2);
        storage.PutGate.SetResult();

        var results = await Task.WhenAll(Settle(first), Settle(second));
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is DbUpdateConcurrencyException); // 409 concurrency.conflict
        await using var check = Context();
        var key = (await check.Vehicles.SingleAsync(v => v.Id == car.Id)).PhotoUrl;
        Assert.Equal([key], storage.Objects.Keys); // the first photo was replaced, the loser's object deleted
    }

    [Fact]
    public async Task Photo_OnPostgres_ARemoveThatSavesDuringAReplacement_Wins_TheReplacementIsAConflict_NoObjectRemains()
    {
        var car = await AddCarAsync();
        await new VehicleService(Context(), storage).SetPhotoAsync(car.UserId, car.Id, Png);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var replace = Task.Run(() => new VehicleService(Context(), storage).SetPhotoAsync(car.UserId, car.Id, Png));
        await WaitForPutsAsync(1);
        await new VehicleService(Context(), storage).DeletePhotoAsync(car.UserId, car.Id);
        storage.PutGate.SetResult();

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => replace);
        await using var check = Context();
        Assert.Null((await check.Vehicles.SingleAsync(v => v.Id == car.Id)).PhotoUrl);
        Assert.Empty(storage.Objects);
    }

    // --- FILE-3: run photos on the real database. ---

    private VehicleChecklistService RunRacer()
    {
        var context = Context();
        return new VehicleChecklistService(context, new VehicleService(context, storage));
    }

    private async Task<(Vehicle Car, Guid Run)> RunWithPhotosAsync(int photos)
    {
        var car = await AddCarAsync();
        var template = await new ChecklistTemplateService(Context()).CreateAsync(car.UserId,
            new ChecklistTemplateRequest("Walk-around", [new(null, "Lights", "Check", null, null, null)]));
        var checklist = await RunRacer().AttachAsync(car.UserId, car.Id, new AttachChecklistRequest(template.Id, null, null, null));
        var run = (await RunRacer().CreateRunAsync(car.UserId, checklist.Id,
            new CreateChecklistRunRequest(null, null, null, [new ChecklistRunItemRequest(template.Items[0].Id, true, null, null)]))).Run.Id;
        for (var i = 0; i < photos; i++)
        {
            await RunRacer().AddRunAttachmentAsync(car.UserId, run, Png, $"{i}.png");
        }

        return (car, run);
    }

    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    [Fact]
    public async Task RunAttachments_OnPostgres_HaveExactlyOneParent_AreIndexedByRun_AndGoWithTheCarAndTheUser()
    {
        var (car, run) = await RunWithPhotosAsync(1);
        var record = (await Racer().CreateRecordAsync(car.UserId, car.Id, new CreateServiceRecordRequest(null, 1_000, null, null, null, []))).Record.Id;
        await Racer().AddAttachmentAsync(car.UserId, car.Id, record, Pdf, "r.pdf");

        foreach (var (recordId, runId) in new (Guid?, Guid?)[] { (null, null), (record, run) })
        {
            await using var bad = Context();
            bad.Attachments.Add(new Attachment { ServiceRecordId = recordId, ChecklistRunId = runId, FileUrl = "k", FileName = "x", ContentType = "image/png", SizeBytes = 1 });
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => bad.SaveChangesAsync());
            Assert.Contains("CK_Attachments_OneParent", ex.InnerException!.Message);
        }

        var index = await db.Database.SqlQuery<string>(
            $"SELECT a.attname::text AS \"Value\" FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE c.relname = 'IX_Attachments_ChecklistRunId'")
            .ToListAsync();
        Assert.Equal(["ChecklistRunId"], index);

        // The run link doesn't cascade (one cascade path per table), so a raw car or user delete must remove the run photo rows first.
        var blocked = await Assert.ThrowsAsync<PostgresException>(() => db.Users.Where(u => u.Id == car.UserId).ExecuteDeleteAsync());
        Assert.Contains("FK_Attachments_ChecklistRuns_ChecklistRunId", blocked.Message);
        await db.Attachments.Where(a => a.ChecklistRun!.VehicleChecklist!.Vehicle!.UserId == car.UserId).ExecuteDeleteAsync();
        await db.Users.Where(u => u.Id == car.UserId).ExecuteDeleteAsync();
        Assert.Equal(0, await db.Attachments.CountAsync());
        Assert.Equal(0, await db.ChecklistRuns.CountAsync());
    }

    [Fact]
    public async Task RunAttachment_OnPostgres_ARunDeleteThatSavesDuringTheUpload_Wins_TheUploadFails_AndItsObjectIsDeleted()
    {
        var (car, run) = await RunWithPhotosAsync(1);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var upload = Task.Run(() => RunRacer().AddRunAttachmentAsync(car.UserId, run, Png, "late.png"));
        await WaitForPutsAsync(1);
        await RunRacer().DeleteRunAsync(car.UserId, run);
        storage.PutGate.SetResult();

        // The handler turns it into 409 concurrency.conflict (GlobalExceptionHandlerTests).
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => upload);
        await using var check = Context();
        Assert.Empty(check.Attachments);
        Assert.Empty(check.ChecklistRuns);
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task RunAttachment_OnPostgres_TwoSimultaneousUploadsAtNinePhotos_OnlyOneSaves_TheOthersObjectIsDeleted()
    {
        var (car, run) = await RunWithPhotosAsync(Attachment.MaxPerParent - 1);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = Task.Run(() => RunRacer().AddRunAttachmentAsync(car.UserId, run, Png, "a.png"));
        var second = Task.Run(() => RunRacer().AddRunAttachmentAsync(car.UserId, run, Png, "b.png"));
        await WaitForPutsAsync(2);
        storage.PutGate.SetResult();

        var results = await Task.WhenAll(Settle(first), Settle(second));
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is DbUpdateConcurrencyException);
        await using var check = Context();
        var keys = await check.Attachments.Select(a => a.FileUrl).ToListAsync();
        Assert.Equal(Attachment.MaxPerParent, keys.Count);
        Assert.Equal(keys.Order(), storage.Objects.Keys.Order());
    }

    [Fact]
    public async Task RunDelete_OnPostgres_AfterAnUploadSavedSinceItsRead_IsAConcurrencyException_AndKeepsEverything()
    {
        var (car, run) = await RunWithPhotosAsync(0);
        var interceptor = new BeforeSave();
        await using var context = Context(interceptor);
        var deleter = new VehicleChecklistService(context, new VehicleService(context, storage));
        interceptor.Next = () => RunRacer().AddRunAttachmentAsync(car.UserId, run, Png, "a.png");

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => deleter.DeleteRunAsync(car.UserId, run));

        await using var check = Context();
        Assert.Single(check.Attachments);
        Assert.Single(storage.Objects);
    }

    // --- NOT-1: two first saves of one unique row; the loser updates the winner's row instead of a 500. ---

    [Fact]
    public async Task Snooze_OnPostgres_TwoFirstSnoozesOfOneItem_OneRow_TheLaterDateWins()
    {
        var car = await AddCarAsync();
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var doc = new VehicleDocument { VehicleId = car.Id, Type = VehicleDocumentType.Insurance, ExpiryDate = today };
        db.VehicleDocuments.Add(doc);
        await db.SaveChangesAsync();
        var race = new BeforeSave();
        await using var context = Context(race);
        race.Next = async () =>
        {
            await using var other = Context();
            await new ReminderService(other).SnoozeAsync(car.UserId, new SnoozeRequest("Document", doc.Id, 30, today));
        };

        var result = await new ReminderService(context).SnoozeAsync(car.UserId, new SnoozeRequest("Document", doc.Id, 7, today));

        Assert.Equal(today.AddDays(7), result.SnoozedUntil);
        await using var check = Context();
        Assert.Equal(today.AddDays(7), (await check.Notifications.SingleAsync()).SnoozedUntil);
    }

    [Fact]
    public async Task LeadDays_OnPostgres_TwoFirstSaves_OneRule_TheLaterValueAndTheOtherSettingsSave()
    {
        var car = await AddCarAsync();
        var race = new BeforeSave();
        await using var context = Context(race);
        AuthService Auth(AppDbContext c) => new(c, new PasswordHasher<User>(), new FakeJwtTokenService(),
            new MemoryCache(new MemoryCacheOptions()), Options.Create(new RateLimitOptions()));
        race.Next = async () =>
        {
            await using var other = Context();
            await Auth(other).UpdateSettingsAsync(car.UserId, new UpdateSettingsRequest(ReminderLeadDays: 10));
        };

        var saved = await Auth(context).UpdateSettingsAsync(car.UserId, new UpdateSettingsRequest(Theme: "Dark", ReminderLeadDays: 20));

        Assert.Equal((20, Theme.Dark), (saved.ReminderLeadDays, saved.Theme));
        await using var check = Context();
        Assert.Equal(20, (await check.NotificationRules.SingleAsync(r => r.UserId == car.UserId)).LeadDays);
        Assert.Equal(Theme.Dark, (await check.Users.SingleAsync(u => u.Id == car.UserId)).Theme);
    }

    [Fact]
    public async Task Export_OnPostgres_SameNumberOfQueriesForOneCarAndThree_NoStorageKeyRead()
    {
        // ACC-1 criterion 3: one query per table, not one per car.
        var car = await AddCarAsync();
        car.PhotoUrl = "users/x/vehicles/key.jpg";
        var record = new ServiceRecord { VehicleId = car.Id, Date = new DateOnly(2026, 1, 1) };
        db.AddRange(record, new Attachment { ServiceRecord = record, FileUrl = "users/x/receipts/key.pdf", FileName = "r.pdf", ContentType = "application/pdf" });
        await db.SaveChangesAsync();
        var commands = new CommandCounter();
        await using var context = new AppDbContext(TestDbContextFactory.PostgresOptions(db.Database.GetConnectionString()!).AddInterceptors(commands).Options);

        var one = await new Application.Account.ExportService(context).ExportAsync(car.UserId);
        var queriesForOne = commands.Texts.Count;
        db.AddRange(new Vehicle { UserId = car.UserId, Nickname = "Two" }, new Vehicle { UserId = car.UserId, Nickname = "Three" });
        await db.SaveChangesAsync();
        commands.Texts.Clear();
        var three = await new Application.Account.ExportService(context).ExportAsync(car.UserId);

        Assert.Equal(3, three.Vehicles.Count);
        Assert.Equal("r.pdf", Assert.Single(Assert.Single(one.Vehicles).ServiceRecords).Attachments.Single().FileName);
        Assert.Equal(20, queriesForOne); // the user, lead days, then one per table
        Assert.Equal(queriesForOne, commands.Texts.Count);
        Assert.DoesNotContain(commands.Texts, t => t.Contains("\"PasswordHash\"") || t.Contains("\"FileUrl\"")
            || System.Text.RegularExpressions.Regex.IsMatch(t, @"""PhotoUrl""(?! IS NOT NULL)")); // only tested for null, never read
    }

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public List<string> Texts { get; } = [];

        public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(System.Data.Common.DbCommand command,
            CommandEventData eventData, InterceptionResult<System.Data.Common.DbDataReader> result, CancellationToken cancellationToken = default)
        {
            Texts.Add(command.CommandText);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    // --- SCAN-2a: document files on the real database. ---

    private VehicleDocumentService DocumentRacer()
    {
        var context = Context();
        return new VehicleDocumentService(context, new VehicleService(context, storage));
    }

    private async Task<(Vehicle Car, Guid Document)> DocumentWithFilesAsync(int files)
    {
        var car = await AddCarAsync();
        var document = (await DocumentRacer().CreateAsync(car.UserId, car.Id, new VehicleDocumentRequest("Insurance", new DateOnly(2027, 1, 31), null, null),
            null)).Id;
        for (var i = 0; i < files; i++)
        {
            await DocumentRacer().AddAttachmentAsync(car.UserId, car.Id, document, Pdf, $"{i}.pdf", null);
        }

        return (car, document);
    }

    [Fact]
    public async Task DocumentAttachments_OnPostgres_HaveExactlyOneOfThreeParents_AreIndexed_AndBlockARawDocumentDelete()
    {
        var (car, document) = await DocumentWithFilesAsync(1);
        var record = (await Racer().CreateRecordAsync(car.UserId, car.Id, new CreateServiceRecordRequest(null, 1_000, null, null, null, []))).Record.Id;

        foreach (var (recordId, documentId) in new (Guid?, Guid?)[] { (null, null), (record, document) })
        {
            await using var bad = Context();
            bad.Attachments.Add(new Attachment { ServiceRecordId = recordId, VehicleDocumentId = documentId, FileUrl = "k", FileName = "x",
                ContentType = "application/pdf", SizeBytes = 1 });
            var ex = await Assert.ThrowsAsync<DbUpdateException>(() => bad.SaveChangesAsync());
            Assert.Contains("CK_Attachments_OneParent", ex.InnerException!.Message);
        }

        var index = await db.Database.SqlQuery<string>(
            $"SELECT a.attname::text AS \"Value\" FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE c.relname = 'IX_Attachments_VehicleDocumentId'")
            .ToListAsync();
        Assert.Equal(["VehicleDocumentId"], index);

        // NoAction: the database never deletes a document's files by itself; the services do.
        var blocked = await Assert.ThrowsAsync<PostgresException>(() => db.VehicleDocuments.Where(d => d.Id == document).ExecuteDeleteAsync());
        Assert.Contains("FK_Attachments_VehicleDocuments_VehicleDocumentId", blocked.Message);
        await DocumentRacer().DeleteAsync(car.UserId, car.Id, document);
        await using var check = Context();
        Assert.Equal(0, await check.Attachments.CountAsync(a => a.VehicleDocumentId != null));
        Assert.DoesNotContain(storage.Objects.Keys, k => k.Contains("/documents/"));
    }

    [Fact]
    public async Task DocumentAttachment_OnPostgres_TwoSimultaneousUploadsAtNineFiles_OnlyOneSaves_TheOthersObjectIsDeleted()
    {
        var (car, document) = await DocumentWithFilesAsync(Attachment.MaxPerParent - 1);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = Task.Run(() => DocumentRacer().AddAttachmentAsync(car.UserId, car.Id, document, Pdf, "a.pdf", null));
        var second = Task.Run(() => DocumentRacer().AddAttachmentAsync(car.UserId, car.Id, document, Pdf, "b.pdf", null));
        await WaitForPutsAsync(2);
        storage.PutGate.SetResult();

        // The handler turns it into 409 concurrency.conflict (GlobalExceptionHandlerTests).
        var results = await Task.WhenAll(Settle(first), Settle(second));
        Assert.Single(results, e => e is null);
        Assert.Single(results, e => e is DbUpdateConcurrencyException);
        await using var check = Context();
        var keys = await check.Attachments.Select(a => a.FileUrl).ToListAsync();
        Assert.Equal(Attachment.MaxPerParent, keys.Count);
        Assert.Equal(keys.Order(), storage.Objects.Keys.Order());
    }

    [Fact]
    public async Task DocumentAttachment_OnPostgres_ADocumentDeleteThatSavesDuringTheUpload_Wins_TheUploadIsAConflict_AndItsObjectIsDeleted()
    {
        var (car, document) = await DocumentWithFilesAsync(1);
        storage.PutGate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var upload = Task.Run(() => DocumentRacer().AddAttachmentAsync(car.UserId, car.Id, document, Pdf, "late.pdf", null));
        await WaitForPutsAsync(1);
        await DocumentRacer().DeleteAsync(car.UserId, car.Id, document);
        storage.PutGate.SetResult();

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => upload);
        await using var check = Context();
        Assert.Empty(check.Attachments);
        Assert.Empty(check.VehicleDocuments);
        Assert.Empty(storage.Objects);
    }

    [Fact]
    public async Task DocumentDelete_OnPostgres_AfterAnUploadSavedSinceItsRead_IsAConcurrencyException_AndKeepsEverything()
    {
        var (car, document) = await DocumentWithFilesAsync(0);
        var interceptor = new BeforeSave();
        await using var context = Context(interceptor);
        var deleter = new VehicleDocumentService(context, new VehicleService(context, storage));
        interceptor.Next = () => DocumentRacer().AddAttachmentAsync(car.UserId, car.Id, document, Pdf, "a.pdf", null);

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => deleter.DeleteAsync(car.UserId, car.Id, document));

        await using var check = Context();
        Assert.Single(check.Attachments);
        Assert.Single(check.VehicleDocuments);
        Assert.Single(storage.Objects);
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
