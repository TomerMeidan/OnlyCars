using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
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

/// <summary>LOW-3 backend: concurrency (L34, L38, L51), date lower bound (L50), first reading date (L36), runs cap (L37), L52.</summary>
public class LowThreeTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private static readonly DateOnly TooEarly = new(1899, 12, 31);
    private static readonly DateOnly Earliest = new(1900, 1, 1);

    // Every context shares one in-memory store, as two requests share the database.
    private readonly InMemoryDatabaseRoot root = new();
    private readonly string name = Guid.NewGuid().ToString();
    private readonly BeforeSave race = new();
    private readonly AppDbContext db;
    private readonly Guid userId = Guid.NewGuid();

    public LowThreeTests() => db = Context(race);

    private AppDbContext Context(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root).AddInterceptors(interceptors).Options);

    private static (VehicleService Vehicles, MaintenanceTaskService Tasks, OdometerService Odometer, ChecklistTemplateService Templates,
        VehicleChecklistService Checklists) Services(AppDbContext context)
    {
        var vehicles = new VehicleService(context);
        return (vehicles, new MaintenanceTaskService(context, vehicles), new OdometerService(context, vehicles),
            new ChecklistTemplateService(context), new VehicleChecklistService(context, vehicles));
    }

    private (VehicleService Vehicles, MaintenanceTaskService Tasks, OdometerService Odometer, ChecklistTemplateService Templates,
        VehicleChecklistService Checklists) S => Services(db);

    private async Task<Guid> CarAsync(decimal? km = 50_000, DateOnly? readingDate = null) =>
        (await S.Vehicles.CreateAsync(userId, new CreateVehicleRequest("Mazda", null, null, null, null, null, null, null, null, null, km, readingDate))).Id;

    private Task<ChecklistTemplateDto> TemplateAsync() =>
        S.Templates.CreateAsync(userId, new ChecklistTemplateRequest("Quick", [new(null, "Lights", "Check", null, null, null)]));

    private Task<CreateChecklistRunResponse> RunAsync(Guid checklistId, ChecklistTemplateDto t, DateOnly runAt, decimal? km = null) =>
        S.Checklists.CreateRunAsync(userId, checklistId, new CreateChecklistRunRequest(runAt, km, null,
            [new ChecklistRunItemRequest(t.Items[0].Id, true, null, null)], ConfirmCorrection: true));

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    // --- L34: two simultaneous voids ---

    [Fact]
    public async Task Void_Simultaneous_SecondIsAlreadyVoided_EvenWhenTheReadingIsKept()
    {
        // No starting reading, so the record's reading is the car's only one and is kept (an update, not a delete):
        // only the record's UpdatedAt token can catch the race.
        var car = await CarAsync(km: null);
        var record = await S.Tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Today, 51_000, null, null, null, []));
        race.Next = () => Services(Context()).Tasks.VoidAsync(userId, car, record.Record.Id);

        Assert.Equal("serviceRecord.alreadyVoided", await CodeAsync(() => S.Tasks.VoidAsync(userId, car, record.Record.Id)));

        await using var check = Context();
        Assert.True((await check.ServiceRecords.SingleAsync()).IsVoided);
        Assert.Equal(OdometerSource.Manual, (await check.OdometerReadings.SingleAsync()).Source);
    }

    [Fact]
    public async Task Void_RacingAnEditThatSavedFirst_IsAConcurrencyException_EditIsKept()
    {
        var car = await CarAsync();
        var record = await S.Tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Today, 51_000, null, null, null, []));
        var oil = (await S.Tasks.CreateAsync(userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", 5_000, 730, 40_000, Today.AddYears(-1)))).Id;
        race.Next = () => Services(Context()).Tasks.UpdateRecordAsync(userId, car, record.Record.Id,
            new UpdateServiceRecordRequest(null, null, null, null, TaskIds: [oil]));

        // The handler turns it into 409 concurrency.conflict, not serviceRecord.alreadyVoided.
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => S.Tasks.VoidAsync(userId, car, record.Record.Id));

        await using var check = Context();
        Assert.False((await check.ServiceRecords.SingleAsync()).IsVoided);
        Assert.Equal(oil, (await check.ServiceRecordTasks.SingleAsync()).MaintenanceTaskId);
    }

    // --- L38(b): two simultaneous template edits ---

    [Fact]
    public async Task TemplateEdit_Simultaneous_SecondIsAConcurrencyException_FirstIsKept()
    {
        var t = await TemplateAsync();
        var item = new ChecklistTemplateItemRequest(t.Items[0].Id, "Lights", "Check", null, null, null);
        race.Next = () => Services(Context()).Templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest("Other tab", [item]));

        // The handler turns it into 409 concurrency.conflict (GlobalExceptionHandlerTests).
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() =>
            S.Templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest("This tab", [item])));

        await using var check = Context();
        Assert.Equal("Other tab", (await check.ChecklistTemplates.SingleAsync()).Name);
    }

    [Fact]
    public async Task TemplateEdit_OneAfterTheOther_BothSave()
    {
        var t = await TemplateAsync();
        var item = new ChecklistTemplateItemRequest(t.Items[0].Id, "Lights", "Check", null, null, null);

        await S.Templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest("A", [item]));
        var second = await Services(Context()).Templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest("B", [item]));

        Assert.Equal("B", second.Name);
    }

    // --- L51: two simultaneous attaches ---

    [Fact]
    public async Task Attach_Simultaneous_SecondIsDuplicate()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        race.Next = async () =>
        {
            await Services(Context()).Checklists.AttachAsync(userId, car, new AttachChecklistRequest(t.Id, null, 30, Today));
            // The in-memory provider has no unique index; this is what Postgres does to the second insert.
            throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.VehicleChecklists'.");
        };

        Assert.Equal("vehicleChecklist.duplicate", await CodeAsync(() =>
            S.Checklists.AttachAsync(userId, car, new AttachChecklistRequest(t.Id, null, 60, Today))));

        await using var check = Context();
        Assert.Equal(30, (await check.VehicleChecklists.SingleAsync()).IntervalDays);
    }

    [Fact]
    public async Task Attach_SaveFailureWithoutACompetingAttach_IsRethrown()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        race.Next = () => throw new DbUpdateException("Something else.");

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            S.Checklists.AttachAsync(userId, car, new AttachChecklistRequest(t.Id, null, 60, Today)));
    }

    // --- L50: dates before 1900-01-01 ---

    [Fact]
    public async Task Dates_Before1900_AreTooEarly_On_Runs_Records_And_Readings()
    {
        var car = await CarAsync(readingDate: Earliest);
        var t = await TemplateAsync();
        var c = await S.Checklists.AttachAsync(userId, car, new AttachChecklistRequest(t.Id, null, null, Today));
        var record = await S.Tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Today, 51_000, null, null, null, []));
        var reading = await S.Odometer.AddAsync(userId, car, new AddOdometerReadingRequest(52_000, Today));

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => RunAsync(c.Id, t, TooEarly));
        Assert.Equal(("date.tooEarly", (object?)Earliest), (error.Code, error.Extensions["minDate"]));
        Assert.Equal("date.tooEarly", await CodeAsync(() => RunAsync(c.Id, t, TooEarly, km: 10)));
        Assert.Equal("date.tooEarly", await CodeAsync(() =>
            S.Tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(TooEarly, 10, null, null, null, []))));
        Assert.Equal("date.tooEarly", await CodeAsync(() =>
            S.Tasks.UpdateRecordAsync(userId, car, record.Record.Id, new UpdateServiceRecordRequest(null, null, null, null, TooEarly, ConfirmCorrection: true))));
        Assert.Equal("date.tooEarly", await CodeAsync(() =>
            S.Odometer.AddAsync(userId, car, new AddOdometerReadingRequest(10, TooEarly, ConfirmCorrection: true))));
        Assert.Equal("date.tooEarly", await CodeAsync(() =>
            S.Odometer.UpdateAsync(userId, car, reading.Id, new UpdateOdometerReadingRequest(10, TooEarly, ConfirmCorrection: true))));
        Assert.Equal("date.tooEarly", await CodeAsync(() =>
            S.Vehicles.CreateAsync(userId, new CreateVehicleRequest("Old", null, null, null, null, null, null, null, null, null, 0, TooEarly))));

        // 1900-01-01 itself is accepted everywhere (the car's first reading above too).
        await RunAsync(c.Id, t, Earliest, km: 10);
        await S.Tasks.CreateRecordAsync(userId, car, new CreateServiceRecordRequest(Earliest, 10, null, null, null, [], ConfirmCorrection: true));
        await S.Odometer.UpdateAsync(userId, car, reading.Id, new UpdateOdometerReadingRequest(10, Earliest, ConfirmCorrection: true));
        Assert.Equal(4, await db.OdometerReadings.CountAsync(r => r.ReadingDate == Earliest));
    }

    // --- L36: a new car's first reading takes the client's date ---

    [Fact]
    public async Task NewCar_FirstReading_TakesTheClientsDate_WithTheQuickAddChecks()
    {
        // 00:30 on the client in UTC+3 is still yesterday in UTC: the client's date is UTC today + 1.
        var car = await CarAsync(readingDate: Today.AddDays(1));
        Assert.Equal(Today.AddDays(1), (await db.OdometerReadings.SingleAsync(r => r.VehicleId == car)).ReadingDate);

        var noDate = await CarAsync();
        Assert.Equal(Today, (await db.OdometerReadings.SingleAsync(r => r.VehicleId == noDate)).ReadingDate);

        Assert.Equal("odometer.futureDate", await CodeAsync(() => CarAsync(readingDate: Today.AddDays(2))));
        // No starting odometer: no reading, so the date isn't checked.
        await CarAsync(km: null, readingDate: Today.AddDays(2));
        Assert.Equal(3, await db.Vehicles.CountAsync());
    }

    // --- L37: the runs list is capped ---

    [Fact]
    public async Task RunsList_IsTheNewest200()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await S.Checklists.AttachAsync(userId, car, new AttachChecklistRequest(t.Id, null, null, Today));
        db.ChecklistRuns.AddRange(Enumerable.Range(0, VehicleChecklistService.MaxRunsListed + 1)
            .Select(i => new ChecklistRun { VehicleChecklistId = c.Id, RunAt = Today.AddDays(-i), OdometerKm = 50_000 }));
        await db.SaveChangesAsync();

        var runs = await S.Checklists.ListRunsAsync(userId, c.Id);

        Assert.Equal(200, runs.Count);
        Assert.Equal(Today, runs[0].RunAt);
        Assert.Equal(Today.AddDays(-199), runs[^1].RunAt);
    }

    // --- L52: deleting a run whose reading is the car's only one ---

    [Fact]
    public async Task DeleteRun_WithTheCarsOnlyReading_KeepsItAsManual()
    {
        var car = await CarAsync(km: null);
        var t = await TemplateAsync();
        var c = await S.Checklists.AttachAsync(userId, car, new AttachChecklistRequest(t.Id, null, null, Today));
        var run = await RunAsync(c.Id, t, Today, km: 12_000);

        await S.Checklists.DeleteRunAsync(userId, run.Run.Id);

        var reading = await db.OdometerReadings.SingleAsync();
        Assert.Equal((12_000m, OdometerSource.Manual), (reading.ValueKm, reading.Source));
        Assert.Equal(12_000m, (await S.Vehicles.GetAsync(userId, car)).CurrentOdometerKm);
        Assert.Empty(db.ChecklistRuns);
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
