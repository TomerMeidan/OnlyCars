using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>LOW-8 L155/L157: every task, checklist and reminder status uses the client's today (at most a day from UTC).</summary>
public class LowEightTests
{
    private static readonly DateOnly Utc = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly VehicleChecklistService checklists;
    private readonly ReminderService reminders;
    private readonly Guid userId = Guid.NewGuid();
    private Guid car;
    private Guid taskId;
    private Guid checklistId;
    private Guid templateItemId;

    public LowEightTests()
    {
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
        checklists = new VehicleChecklistService(db, vehicles);
        reminders = new ReminderService(db);
    }

    // A 30-day task and a 30-day checklist, both last done 30 days before the UTC date: due today (0 days left) on UTC.
    private async Task SeedAsync()
    {
        car = (await vehicles.CreateAsync(userId, new CreateVehicleRequest("Mazda", null, null, null, null, null, null, null, null, null, 50_000))).Id;
        taskId = (await tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", null, 30, 50_000, Utc.AddDays(-30)))).Id;
        var template = await new ChecklistTemplateService(db).CreateAsync(userId,
            new ChecklistTemplateRequest("Walk-around", [new(null, "Lights", "Check", null, null, null)]));
        checklistId = (await checklists.AttachAsync(userId, car, new AttachChecklistRequest(template.Id, null, 30, Utc))).Id;
        templateItemId = template.Items[0].Id;
        var c = await db.VehicleChecklists.SingleAsync(x => x.Id == checklistId);
        c.LastRunDate = Utc.AddDays(-30);
        await db.SaveChangesAsync();
    }

    [Theory]
    [InlineData(-1, 1)]
    [InlineData(0, 0)]
    [InlineData(1, -1)]
    public async Task EveryStatusRead_UsesTheClientsToday(int offset, int daysLeft)
    {
        await SeedAsync();
        var today = Utc.AddDays(offset);

        Assert.Equal(daysLeft, Assert.Single(await tasks.ListAsync(userId, car, today)).RemainingDays);
        Assert.Equal(daysLeft, Assert.Single(await checklists.ListAsync(userId, car, today)).RemainingDays);

        var card = Assert.Single((await tasks.DashboardAsync(userId, today)).Vehicles);
        Assert.Equal(daysLeft, Assert.Single(card.Tasks).RemainingDays);
        Assert.Equal(daysLeft, Assert.Single(card.Checklists).RemainingDays);

        var items = (await reminders.GetAsync(userId, today)).Items;
        Assert.Equal(2, items.Count);
        Assert.All(items, r => Assert.Equal(daysLeft, r.RemainingDays));
        Assert.Equal(offset == 1 ? "Overdue" : "DueSoon", items[0].Status);
    }

    [Fact]
    public async Task EveryStatusWrite_ReturnsTheClientsToday()
    {
        await SeedAsync();
        var tomorrow = Utc.AddDays(1);

        var updated = await tasks.UpdateAsync(userId, car, taskId,
            new UpdateMaintenanceTaskRequest("Oil", "Oil", null, 30, 50_000, Utc.AddDays(-30), true), tomorrow);
        Assert.Equal(-1, updated.RemainingDays);
        Assert.Equal(-1, (await checklists.UpdateAsync(userId, checklistId, new UpdateVehicleChecklistRequest(null, 30, true), tomorrow)).RemainingDays);

        // Mark done on the client's tomorrow: the record is dated tomorrow, 30 days left from there.
        var reset = await tasks.ResetAsync(userId, car, taskId, null, tomorrow);
        Assert.Equal(30, reset.Task.RemainingDays);
        Assert.Equal(tomorrow, (await db.ServiceRecords.SingleAsync(r => r.Id == reset.ServiceRecordId)).Date);
        Assert.Equal(-1, Assert.Single(await tasks.VoidAsync(userId, car, reset.ServiceRecordId, tomorrow)).RemainingDays);

        var created = await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Utc.AddDays(-30), 50_000, null, null, null, [taskId]), tomorrow);
        Assert.Equal(-1, Assert.Single(created.Tasks).RemainingDays);
        var edited = await tasks.UpdateRecordAsync(userId, car, created.Record.Id, new UpdateServiceRecordRequest("Shop", null, null, null), tomorrow);
        Assert.Equal(-1, Assert.Single(edited.Tasks).RemainingDays);
    }

    [Fact]
    public async Task CreateAttachAndRun_ReturnTheClientsToday()
    {
        await SeedAsync();
        var tomorrow = Utc.AddDays(1);

        // Done today on UTC, read on the client's tomorrow: 29 days left, not 30.
        var created = await tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Tyres", "Tires", null, 30, 50_000, Utc), tomorrow);
        Assert.Equal(29, created.RemainingDays);

        var other = await new ChecklistTemplateService(db).CreateAsync(userId,
            new ChecklistTemplateRequest("Tyres", [new(null, "Tread", "Check", null, null, null)]));
        Assert.Equal(29, (await checklists.AttachAsync(userId, car, new AttachChecklistRequest(other.Id, null, 30, Utc), tomorrow)).RemainingDays);

        // No runAt: the run is dated the client's tomorrow, and the checklist counts 30 days from there.
        var run = await checklists.CreateRunAsync(userId, checklistId,
            new CreateChecklistRunRequest(null, null, null, [new ChecklistRunItemRequest(templateItemId, true, null, null)]), tomorrow);
        Assert.Equal(tomorrow, run.Run.RunAt);
        Assert.Equal(tomorrow, run.Checklist.LastRunDate);
        Assert.Equal(30, run.Checklist.RemainingDays);
    }

    [Fact]
    public async Task NoToday_UsesTheUtcDate()
    {
        await SeedAsync();

        Assert.Equal(0, Assert.Single(await tasks.ListAsync(userId, car)).RemainingDays);
        Assert.Equal(0, Assert.Single(await checklists.ListAsync(userId, car)).RemainingDays);
        Assert.Equal(0, Assert.Single(Assert.Single((await tasks.DashboardAsync(userId, null)).Vehicles).Tasks).RemainingDays);
        Assert.All((await reminders.GetAsync(userId, null)).Items, r => Assert.Equal(0, r.RemainingDays));
    }

    [Theory]
    [InlineData(-2)]
    [InlineData(2)]
    public async Task ATodayTwoDaysOff_IsTheEndpointsDateCode(int offset)
    {
        await SeedAsync();
        var off = Utc.AddDays(offset);
        var record = (await tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Utc, 50_000, null, null, null, null))).Record.Id;

        async Task Is(string code, Func<Task> act) => Assert.Equal(code, (await Assert.ThrowsAsync<ValidationFailedException>(act)).Code);
        await Is("serviceRecord.invalidDate", () => tasks.ListAsync(userId, car, off));
        await Is("serviceRecord.invalidDate", () => tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Tyres", "Tires", null, 30, 50_000, Utc), off));
        await Is("serviceRecord.invalidDate", () => tasks.UpdateAsync(userId, car, taskId,
            new UpdateMaintenanceTaskRequest("Oil", "Oil", null, 30, 50_000, Utc, true), off));
        await Is("serviceRecord.invalidDate", () => tasks.ResetAsync(userId, car, taskId, null, off));
        await Is("serviceRecord.invalidDate", () => tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Utc, 50_000, null, null, null, null), off));
        await Is("serviceRecord.invalidDate", () => tasks.UpdateRecordAsync(userId, car, record, new UpdateServiceRecordRequest("X", null, null, null), off));
        await Is("serviceRecord.invalidDate", () => tasks.VoidAsync(userId, car, record, off));
        await Is("vehicleChecklist.invalidDate", () => checklists.ListAsync(userId, car, off));
        await Is("vehicleChecklist.invalidDate", () => checklists.AttachAsync(userId, car, new AttachChecklistRequest(Guid.NewGuid(), null, 30, Utc), off));
        await Is("vehicleChecklist.invalidDate", () => checklists.UpdateAsync(userId, checklistId, new UpdateVehicleChecklistRequest(null, 30, true), off));
        await Is("vehicleChecklist.invalidDate", () => checklists.CreateRunAsync(userId, checklistId, new CreateChecklistRunRequest(Utc, null, null, []), off));
        await Is("dashboard.invalidDate", () => tasks.DashboardAsync(userId, off));
        await Is("reminder.invalidDate", () => reminders.GetAsync(userId, off));

        // Nothing was saved by the refused writes.
        Assert.Equal(1, await db.MaintenanceTasks.CountAsync());
        Assert.Equal(1, await db.ServiceRecords.CountAsync(r => !r.IsVoided));
    }

    [Fact]
    public async Task AnotherUsersCar_IsStillNotFound_WithAValidToday()
    {
        await SeedAsync();
        var stranger = Guid.NewGuid();

        await Assert.ThrowsAsync<NotFoundException>(() => tasks.ListAsync(stranger, car, Utc.AddDays(1)));
        await Assert.ThrowsAsync<NotFoundException>(() => checklists.ListAsync(stranger, car, Utc.AddDays(-1)));
        // Ownership is checked before the date everywhere, so a bad today on another user's data is still 404.
        var off = Utc.AddDays(5);
        await Assert.ThrowsAsync<NotFoundException>(() => tasks.ListAsync(stranger, car, off));
        await Assert.ThrowsAsync<NotFoundException>(() => tasks.ResetAsync(stranger, car, taskId, null, off));
        await Assert.ThrowsAsync<NotFoundException>(() => tasks.VoidAsync(stranger, car, Guid.NewGuid(), off));
        await Assert.ThrowsAsync<NotFoundException>(() => checklists.ListAsync(stranger, car, off));
        await Assert.ThrowsAsync<NotFoundException>(() => checklists.UpdateAsync(stranger, checklistId, new UpdateVehicleChecklistRequest(null, 30, true), off));
        await Assert.ThrowsAsync<NotFoundException>(() => checklists.CreateRunAsync(stranger, checklistId, new CreateChecklistRunRequest(null, null, null, []), off));
        Assert.Empty((await tasks.DashboardAsync(stranger, Utc.AddDays(1))).Vehicles);
        Assert.Empty((await reminders.GetAsync(stranger, Utc.AddDays(1))).Items);
    }

    [Fact]
    public void ClientToday_IsTheOnlyTodayCheck()
    {
        // L157: no inline copy of the one-day check is left in the services.
        var root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(SourcePath())!, "..", "..", "src", "OnlyCars.Application"));
        var copies = Directory.EnumerateFiles(root, "*.cs", SearchOption.AllDirectories)
            .Where(f => File.ReadAllText(f).Contains("DayNumber) > 1"))
            .Select(Path.GetFileName);
        Assert.Equal(["DateRules.cs"], copies);
    }

    private static string SourcePath([CallerFilePath] string path = "") => path;
}
