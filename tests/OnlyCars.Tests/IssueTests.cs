using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Storage;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Issues;
using OnlyCars.Application.Issues.Dtos;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP5-C backend: a car's to-dos, from a flagged run item or by hand. Criterion numbers refer to the ticket.</summary>
public class IssueTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db;
    private readonly VehicleService vehicles;
    private readonly ChecklistTemplateService templates;
    private readonly VehicleChecklistService checklists;
    private readonly IssueService issues;
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid otherUserId = Guid.NewGuid();

    public IssueTests() : this(TestDbContextFactory.Create())
    {
    }

    private IssueTests(AppDbContext context)
    {
        db = context;
        vehicles = new VehicleService(db);
        templates = new ChecklistTemplateService(db);
        checklists = new VehicleChecklistService(db, vehicles);
        issues = new IssueService(db, vehicles);
    }

    private async Task<Guid> CarAsync(Guid? owner = null, string nickname = "Mazda") =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(nickname, null, null, null, null, null, null, null, null, null, 50_000))).Id;

    // A run of "Monthly quick check" on the car: Lights Not OK (flagged), Tire pressure 1.8 bar (flagged), Notes empty (not flagged).
    private async Task<(ChecklistRunDto Run, ChecklistTemplateDto Template, Guid ChecklistId)> RunAsync(Guid car, Guid? owner = null)
    {
        var o = owner ?? userId;
        var t = await templates.CreateAsync(o, new ChecklistTemplateRequest("Monthly quick check", [
            new(null, "Lights", "Check", null, null, null),
            new(null, "Tire pressure", "Number", "bar", 2.0m, 2.6m),
            new(null, "Notes", "Text", null, null, null)
        ]));
        var c = await checklists.AttachAsync(o, car, new AttachChecklistRequest(t.Id, null, null, Today));
        var r = await checklists.CreateRunAsync(o, c.Id, new CreateChecklistRunRequest(Today, null, null, [
            new ChecklistRunItemRequest(t.Items[0].Id, false, null, null),
            new ChecklistRunItemRequest(t.Items[1].Id, null, 1.8m, null),
            new ChecklistRunItemRequest(t.Items[2].Id, null, null, null)
        ]));
        return (r.Run, t, c.Id);
    }

    private Task<IssueDto> AddAsync(Guid car, string title = "Fix it", string? description = null, Guid? source = null) =>
        issues.CreateAsync(userId, car, new CreateIssueRequest(title, description, source));

    private Task<IssueDto> SetAsync(IssueDto i, IssueStatus? status, DateOnly? resolvedAt) =>
        issues.UpdateAsync(userId, i.Id, new UpdateIssueRequest(i.Title, i.Description, status, resolvedAt));

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    // --- Criterion 1: CRUD, ownership, validation ---

    [Fact]
    public async Task Create_TrimsAndStartsOpen_AndLists()
    {
        var car = await CarAsync();

        var created = await AddAsync(car, "  Wash the car  ", "   ");

        Assert.Equal((car, "Wash the car", (string?)null, IssueStatus.Open, (DateOnly?)null, (IssueSourceDto?)null),
            (created.VehicleId, created.Title, created.Description, created.Status, created.ResolvedAt, created.Source));
        Assert.Equal(created, Assert.Single(await issues.ListAsync(userId, car)));
    }

    [Fact]
    public async Task Update_ChangesTitleAndDescription_AndDeleteRemoves()
    {
        var car = await CarAsync();
        var i = await AddAsync(car);

        var edited = await issues.UpdateAsync(userId, i.Id, new UpdateIssueRequest(" New ", " Details ", null, null));
        Assert.Equal(("New", "Details", IssueStatus.Open), (edited.Title, edited.Description, edited.Status));

        await issues.DeleteAsync(userId, i.Id);
        Assert.Empty(await issues.ListAsync(userId, car));
    }

    [Fact]
    public async Task AnotherUsersCarIssueOrRunItem_IsNotFound()
    {
        var mine = await CarAsync();
        var theirs = await CarAsync(otherUserId, "Theirs");
        var theirIssue = await issues.CreateAsync(otherUserId, theirs, new CreateIssueRequest("Theirs", null, null));
        var (theirRun, _, _) = await RunAsync(theirs, otherUserId);

        Assert.Equal("vehicle.notFound", await CodeAsync(() => issues.ListAsync(userId, theirs)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => AddAsync(theirs)));
        Assert.Equal("issue.notFound", await CodeAsync(() => SetAsync(theirIssue, IssueStatus.Done, Today)));
        Assert.Equal("issue.notFound", await CodeAsync(() => issues.DeleteAsync(userId, theirIssue.Id)));
        Assert.Equal("checklistRunItem.notFound", await CodeAsync(() => AddAsync(mine, source: theirRun.Items[0].Id)));
        Assert.Equal("checklistRunItem.notFound", await CodeAsync(() => AddAsync(mine, source: Guid.NewGuid())));
        Assert.Equal("Theirs", (await db.Issues.SingleAsync()).Title);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public async Task Title_Blank_IsInvalid(string? title)
    {
        var car = await CarAsync();
        var i = await AddAsync(car);

        Assert.Equal("issue.invalidTitle", await CodeAsync(() => issues.CreateAsync(userId, car, new CreateIssueRequest(title, null, null))));
        Assert.Equal("issue.invalidTitle", await CodeAsync(() => issues.UpdateAsync(userId, i.Id, new UpdateIssueRequest(title, null, null, null))));
    }

    [Fact]
    public async Task TitleAndDescription_Boundaries()
    {
        var car = await CarAsync();

        Assert.Equal(100, (await AddAsync(car, new string('a', 100))).Title.Length);
        Assert.Equal("issue.invalidTitle", await CodeAsync(() => AddAsync(car, new string('a', 101))));
        Assert.Equal(1_000, (await AddAsync(car, description: new string('d', 1_000))).Description!.Length);
        Assert.Equal("issue.invalidDescription", await CodeAsync(() => AddAsync(car, description: new string('d', 1_001))));
    }

    [Fact]
    public async Task Create_OnArchivedCar_IsRejected_ButEditAndDeleteWork()
    {
        var car = await CarAsync();
        var i = await AddAsync(car);
        await vehicles.ArchiveAsync(userId, car, true);

        Assert.Equal("issue.vehicleArchived", await CodeAsync(() => AddAsync(car)));
        Assert.Equal(IssueStatus.Done, (await SetAsync(i, IssueStatus.Done, Today)).Status);
        await issues.DeleteAsync(userId, i.Id);
    }

    [Fact]
    public async Task Create_AtTheLimitOf500_IsRejected()
    {
        var car = await CarAsync();
        db.Issues.AddRange(Enumerable.Range(0, Issue.MaxPerVehicle - 1).Select(n => new Issue { VehicleId = car, Title = $"#{n}" }));
        await db.SaveChangesAsync();

        await AddAsync(car);
        Assert.Equal("issue.limitReached", await CodeAsync(() => AddAsync(car)));
        Assert.Equal(Issue.MaxPerVehicle, await db.Issues.CountAsync());
    }

    // --- Criterion 2: one to-do per flagged run item ---

    [Fact]
    public async Task Create_FromAFlaggedRunItem_CarriesTheSource()
    {
        var car = await CarAsync();
        var (run, _, _) = await RunAsync(car);
        var pressure = run.Items[1];

        var i = await AddAsync(car, "Tire pressure", "1.8 bar", pressure.Id);

        Assert.Equal(new IssueSourceDto(pressure.Id, run.Id, Today, "Monthly quick check", "Tire pressure"), i.Source);
        Assert.Equal(i, Assert.Single(await issues.ListAsync(userId, car)));
    }

    [Fact]
    public async Task Create_FromAnUnflaggedOrAnotherCarsRunItem_IsInvalidSource()
    {
        var car = await CarAsync();
        var otherCar = await CarAsync(nickname: "Honda");
        var (run, _, _) = await RunAsync(car);

        Assert.Equal("issue.invalidSource", await CodeAsync(() => AddAsync(car, source: run.Items[2].Id)));
        Assert.Equal("issue.invalidSource", await CodeAsync(() => AddAsync(otherCar, source: run.Items[0].Id)));
        Assert.Empty(db.Issues);
    }

    [Fact]
    public async Task Create_SecondFromTheSameRunItem_IsDuplicate()
    {
        var car = await CarAsync();
        var (run, _, _) = await RunAsync(car);
        await AddAsync(car, source: run.Items[0].Id);

        var error = await Assert.ThrowsAsync<ConflictException>(() => AddAsync(car, source: run.Items[0].Id));
        Assert.Equal("issue.duplicate", error.Code);
        Assert.Single(db.Issues);
    }

    [Fact]
    public async Task Create_SimultaneousFromTheSameRunItem_IsDuplicateNotA500()
    {
        // Both requests pass the check; the other one saves first and the unique index fails this save.
        var root = new InMemoryDatabaseRoot();
        var name = Guid.NewGuid().ToString();
        DbContextOptionsBuilder<AppDbContext> Options() => new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root);
        var race = new RaceInterceptor(async source =>
        {
            await using var other = new AppDbContext(Options().Options);
            var vehicleId = await other.ChecklistRunItems.Where(i => i.Id == source).Select(i => i.Run!.VehicleChecklist!.VehicleId).SingleAsync();
            other.Issues.Add(new Issue { VehicleId = vehicleId, Title = "Other tab", SourceRunItemId = source });
            await other.SaveChangesAsync();
        });
        var t = new IssueTests(new AppDbContext(Options().AddInterceptors(race).Options));
        var car = await t.CarAsync();
        var (run, _, _) = await t.RunAsync(car);

        var error = await Assert.ThrowsAsync<ConflictException>(() => t.AddAsync(car, source: run.Items[0].Id));

        Assert.Equal("issue.duplicate", error.Code);
        await using var check = new AppDbContext(Options().Options);
        Assert.Equal("Other tab", (await check.Issues.SingleAsync()).Title);
    }

    [Fact]
    public async Task Create_SaveFailureWithoutACompetingToDo_IsRethrown()
    {
        var root = new InMemoryDatabaseRoot();
        var name = Guid.NewGuid().ToString();
        var race = new RaceInterceptor(_ => Task.CompletedTask);
        var t = new IssueTests(new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root).AddInterceptors(race).Options));
        var car = await t.CarAsync();
        var (run, _, _) = await t.RunAsync(car);

        await Assert.ThrowsAsync<DbUpdateException>(() => t.AddAsync(car, source: run.Items[0].Id));
    }

    // --- Criterion 3: deleting a run keeps its to-dos ---

    [Fact]
    public async Task DeleteRun_KeepsItsToDos_WithoutSource()
    {
        var car = await CarAsync();
        var (run, _, _) = await RunAsync(car);
        var i = await AddAsync(car, "Lights", "Not OK", run.Items[0].Id);

        await checklists.DeleteRunAsync(userId, run.Id);

        var kept = Assert.Single(await issues.ListAsync(userId, car));
        Assert.Equal(i with { Source = null }, kept);
    }

    [Fact]
    public async Task DeleteTemplateItem_LeavesToDosAlone()
    {
        var car = await CarAsync();
        var (run, t, _) = await RunAsync(car);
        var i = await AddAsync(car, "Lights", null, run.Items[0].Id);

        await templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest(t.Name, [
            new(t.Items[1].Id, "Tire pressure", "Number", "bar", 2.0m, 2.6m),
            new(t.Items[2].Id, "Notes", "Text", null, null, null)
        ]));

        Assert.Equal(i, Assert.Single(await issues.ListAsync(userId, car)));
    }

    [Fact]
    public async Task RunItems_CarryTheirIssueId()
    {
        var car = await CarAsync();
        var (run, _, checklistId) = await RunAsync(car);
        var i = await AddAsync(car, source: run.Items[1].Id);

        var items = Assert.Single(await checklists.ListRunsAsync(userId, checklistId)).Items;

        Assert.Equal([null, i.Id, null], items.Select(x => x.IssueId));
        Assert.All(run.Items, x => Assert.Null(x.IssueId));
    }

    // --- Criterion 4: Done and reopen ---

    [Fact]
    public async Task Done_SetsTheSentDate_AndReopenClearsIt()
    {
        var car = await CarAsync();
        var i = await AddAsync(car);

        var done = await SetAsync(i, IssueStatus.Done, Today.AddDays(-3));
        Assert.Equal((IssueStatus.Done, (DateOnly?)Today.AddDays(-3)), (done.Status, done.ResolvedAt));

        // A null status keeps Done, which still needs the date.
        Assert.Equal("issue.invalidDate", await CodeAsync(() => SetAsync(done, null, null)));
        Assert.Equal(Today.AddDays(-3), (await SetAsync(done, null, Today.AddDays(-3))).ResolvedAt);

        var reopened = await SetAsync(done, IssueStatus.Open, Today);
        Assert.Equal((IssueStatus.Open, (DateOnly?)null), (reopened.Status, reopened.ResolvedAt));
    }

    [Fact]
    public async Task Done_DateBoundaries()
    {
        var car = await CarAsync();
        var i = await AddAsync(car);

        Assert.Equal("issue.invalidDate", await CodeAsync(() => SetAsync(i, IssueStatus.Done, null)));
        Assert.Equal("issue.invalidDate", await CodeAsync(() => SetAsync(i, IssueStatus.Done, new DateOnly(1999, 12, 31))));
        Assert.Equal("issue.futureDate", await CodeAsync(() => SetAsync(i, IssueStatus.Done, Today.AddDays(2))));
        Assert.Equal(IssueStatus.Open, (await db.Issues.SingleAsync()).Status);

        Assert.Equal(new DateOnly(2000, 1, 1), (await SetAsync(i, IssueStatus.Done, new DateOnly(2000, 1, 1))).ResolvedAt);
        Assert.Equal(Today.AddDays(1), (await SetAsync(i, IssueStatus.Done, Today.AddDays(1))).ResolvedAt);
    }

    [Fact]
    public async Task List_OpenNewestFirst_ThenDoneByResolvedThenCreated()
    {
        var car = await CarAsync();
        var created = DateTimeOffset.UtcNow.AddDays(-10);
        var rows = new (string Title, IssueStatus Status, int ResolvedDaysAgo, int CreatedDays)[]
        {
            ("open old", IssueStatus.Open, 0, 1), ("open new", IssueStatus.Open, 0, 2),
            ("done 5 days ago", IssueStatus.Done, 5, 9), ("done today, older", IssueStatus.Done, 0, 3), ("done today, newer", IssueStatus.Done, 0, 4)
        };
        db.Issues.AddRange(rows.Select(r => new Issue
        {
            VehicleId = car, Title = r.Title, Status = r.Status, CreatedAt = created.AddDays(r.CreatedDays),
            ResolvedAt = r.Status == IssueStatus.Done ? Today.AddDays(-r.ResolvedDaysAgo) : null
        }));
        await db.SaveChangesAsync();

        Assert.Equal(["open new", "open old", "done today, newer", "done today, older", "done 5 days ago"],
            (await issues.ListAsync(userId, car)).Select(i => i.Title));
    }

    [Fact]
    public async Task Dashboard_CountsOpenToDosOfActiveCarsOnly()
    {
        var car = await CarAsync();
        var none = await CarAsync(nickname: "Honda");
        var archived = await CarAsync(nickname: "Old");
        await AddAsync(car);
        await AddAsync(car);
        await SetAsync(await AddAsync(car), IssueStatus.Done, Today);
        await AddAsync(archived);
        await vehicles.ArchiveAsync(userId, archived, true);
        await issues.CreateAsync(otherUserId, await CarAsync(otherUserId), new CreateIssueRequest("Theirs", null, null));

        var dash = await new MaintenanceTaskService(db, vehicles).DashboardAsync(userId, null);

        Assert.Equal([(car, 2), (none, 0)], dash.Vehicles.Select(v => (v.Id, v.OpenIssueCount)).OrderBy(v => v.Item2 == 0));
        Assert.Equal((0, 0), (dash.OverdueCount, dash.DueSoonCount));
    }

    /// <summary>Simulates another request saving first: runs <c>race</c> once with the source id, then fails this save like the unique index.</summary>
    private sealed class RaceInterceptor(Func<Guid, Task> race) : SaveChangesInterceptor
    {
        private bool fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            var added = eventData.Context!.ChangeTracker.Entries<Issue>()
                .FirstOrDefault(e => e.State == EntityState.Added && e.Entity.SourceRunItemId is not null);
            if (fired || added is null)
            {
                return result;
            }

            fired = true;
            await race(added.Entity.SourceRunItemId!.Value);
            throw new DbUpdateException("Cannot insert duplicate key row in object 'dbo.Issues' with unique index 'IX_Issues_SourceRunItemId'.");
        }
    }
}
