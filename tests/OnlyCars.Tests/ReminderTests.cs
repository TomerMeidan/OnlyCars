using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Reminders.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>NOT-1 backend: car documents, reminders, snooze and lead days. Criterion numbers refer to the ticket.</summary>
public class ReminderTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly ChecklistTemplateService templates;
    private readonly VehicleChecklistService checklists;
    private readonly VehicleDocumentService documents;
    private readonly ReminderService reminders;
    private readonly AuthService auth;
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid otherUserId = Guid.NewGuid();

    public ReminderTests()
    {
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
        templates = new ChecklistTemplateService(db);
        checklists = new VehicleChecklistService(db, vehicles);
        documents = new VehicleDocumentService(db, vehicles);
        reminders = new ReminderService(db);
        auth = new AuthService(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(new RateLimitOptions()));
    }

    // Starts at 50,000 km.
    private async Task<Guid> CarAsync(string nickname = "Mazda", Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(nickname, null, null, null, null, null, null, null, null, null, 50_000))).Id;

    private Task<VehicleDocumentDto> DocAsync(Guid car, int daysFromToday, string type = "Insurance", Guid? owner = null) =>
        documents.CreateAsync(owner ?? userId, car, new VehicleDocumentRequest(type, Today.AddDays(daysFromToday), null, null), Today);

    // 5,000 km interval, due soon at 500 km left; the car is at 50,000.
    private Task<MaintenanceTaskDto> TaskAsync(Guid car, string name, decimal usedKm, Guid? owner = null) =>
        tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(null, name, "Oil", 5_000, null, 50_000 - usedKm, Today));

    // A 30-day checklist last run daysAgo days ago (Due soon from 27 days, Overdue from 31); null days is manual only.
    private async Task<VehicleChecklistDto> ChecklistAsync(Guid car, string name, int daysAgo, int? intervalDays = 30, Guid? owner = null)
    {
        var o = owner ?? userId;
        var t = await templates.CreateAsync(o, new ChecklistTemplateRequest(name, [new(null, "Lights", "Check", null, null, null)]));
        var c = await checklists.AttachAsync(o, car, new AttachChecklistRequest(t.Id, null, intervalDays, Today));
        var entity = await db.VehicleChecklists.SingleAsync(x => x.Id == c.Id);
        entity.LastRunDate = Today.AddDays(-daysAgo);
        await db.SaveChangesAsync();
        return c;
    }

    private Task<RemindersDto> GetAsync(DateOnly? today = null, Guid? owner = null) => reminders.GetAsync(owner ?? userId, today ?? Today);

    private Task<SnoozeDto> SnoozeAsync(string kind, Guid refId, int days = 7, DateOnly? today = null, Guid? owner = null) =>
        reminders.SnoozeAsync(owner ?? userId, new SnoozeRequest(kind, refId, days, today ?? Today));

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    [Fact]
    public async Task OpenToDos_OfActiveCarsOnly_NewestFirst_AndNeverCountedAsSnoozed()
    {
        var car = await CarAsync();
        var archived = await CarAsync("Old");
        var theirs = await CarAsync("Theirs", otherUserId);
        var older = new Issue { VehicleId = car, Title = "Older", CreatedAt = DateTimeOffset.UtcNow.AddDays(-1) };
        db.Issues.AddRange(older, new Issue { VehicleId = car, Title = "Newer" }, new Issue { VehicleId = car, Title = "Done", Status = IssueStatus.Done },
            new Issue { VehicleId = archived, Title = "On archived" }, new Issue { VehicleId = theirs, Title = "Theirs" });
        await db.SaveChangesAsync();
        await vehicles.ArchiveAsync(userId, archived, true);

        var r = await GetAsync();

        Assert.Equal(["Newer", "Older"], r.OpenToDos.Select(i => i.Title));
        Assert.All(r.OpenToDos, i => Assert.Equal((car, "Mazda"), (i.VehicleId, i.VehicleNickname)));
        Assert.Equal(0, r.SnoozedCount);
    }

    // ---- Documents (criterion 2) ----

    [Fact]
    public async Task Documents_CreateUpdateList_SortedByExpiry_WithStatusAndDaysLeft()
    {
        var car = await CarAsync();
        var later = await DocAsync(car, 100, "Registration");
        var soon = await documents.CreateAsync(userId, car, new VehicleDocumentRequest("Inspection", Today.AddDays(5), 120.5m, "  Test centre  "), Today);
        Assert.Equal((DocumentStatus.Expiring, 5, 120.5m, "Test centre"), (soon.Status, soon.DaysLeft, soon.Cost, soon.Notes));

        var updated = await documents.UpdateAsync(userId, car, later.Id, new VehicleDocumentRequest("Licence", Today.AddDays(-3), null, "   "), Today);
        Assert.Equal((VehicleDocumentType.Licence, DocumentStatus.Expired, -3, (string?)null), (updated.Type, updated.Status, updated.DaysLeft, updated.Notes));

        var list = await documents.ListAsync(userId, car, Today);
        Assert.Equal([later.Id, soon.Id], list.Select(d => d.Id));
    }

    [Theory]
    [InlineData(-1, 30, DocumentStatus.Expired)]
    [InlineData(0, 30, DocumentStatus.Expiring)]
    [InlineData(30, 30, DocumentStatus.Expiring)]
    [InlineData(31, 30, DocumentStatus.Ok)]
    [InlineData(10, 10, DocumentStatus.Expiring)]
    [InlineData(11, 10, DocumentStatus.Ok)]
    [InlineData(1, 1, DocumentStatus.Expiring)]
    [InlineData(2, 1, DocumentStatus.Ok)]
    public async Task DocumentStatus_AtTheLeadDayBoundaries(int daysFromToday, int leadDays, DocumentStatus expected)
    {
        db.NotificationRules.RemoveRange(db.NotificationRules);
        db.NotificationRules.Add(new NotificationRule { UserId = userId, Channel = NotificationChannel.InApp, LeadDays = leadDays });
        await db.SaveChangesAsync();
        var car = await CarAsync();

        var doc = await DocAsync(car, daysFromToday);

        Assert.Equal((expected, daysFromToday), (doc.Status, doc.DaysLeft));
        var inReminders = (await GetAsync()).Items.Any(i => i.RefId == doc.Id);
        Assert.Equal(expected != DocumentStatus.Ok, inReminders);
    }

    public static TheoryData<string?, DateOnly?, decimal?, string?, string> InvalidDocuments => new()
    {
        { null, new DateOnly(2027, 1, 1), null, null, "vehicleDocument.invalidType" },
        { "insurance", new DateOnly(2027, 1, 1), null, null, "vehicleDocument.invalidType" },
        { "1", new DateOnly(2027, 1, 1), null, null, "vehicleDocument.invalidType" },
        { "Insurance", null, null, null, "vehicleDocument.invalidExpiryDate" },
        { "Insurance", new DateOnly(1899, 12, 31), null, null, "date.tooEarly" },
        { "Insurance", new DateOnly(2101, 1, 1), null, null, "date.tooLate" },
        { "Insurance", new DateOnly(2027, 1, 1), -0.01m, null, "vehicleDocument.invalidCost" },
        { "Insurance", new DateOnly(2027, 1, 1), 1_000_000.01m, null, "vehicleDocument.invalidCost" },
        { "Insurance", new DateOnly(2027, 1, 1), 1.005m, null, "vehicleDocument.invalidCost" },
        { "Insurance", new DateOnly(2027, 1, 1), null, new string('x', 1_001), "vehicleDocument.invalidNotes" }
    };

    [Theory]
    [MemberData(nameof(InvalidDocuments))]
    public async Task Documents_InvalidFields_AreCoded400s_OnCreateAndUpdate(string? type, DateOnly? expiry, decimal? cost, string? notes, string code)
    {
        var car = await CarAsync();
        var doc = await DocAsync(car, 10);
        var request = new VehicleDocumentRequest(type, expiry, cost, notes);

        Assert.Equal(code, await CodeAsync(() => documents.CreateAsync(userId, car, request, Today)));
        Assert.Equal(code, await CodeAsync(() => documents.UpdateAsync(userId, car, doc.Id, request, Today)));
        db.ChangeTracker.Clear();
        Assert.Equal(Today.AddDays(10), (await db.VehicleDocuments.SingleAsync()).ExpiryDate);
    }

    [Fact]
    public async Task Documents_BoundaryValuesAreAccepted()
    {
        var car = await CarAsync();
        var a = await documents.CreateAsync(userId, car, new VehicleDocumentRequest("Insurance", new DateOnly(1900, 1, 1), 0, new string('x', 1_000)), Today);
        var b = await documents.CreateAsync(userId, car, new VehicleDocumentRequest("Licence", new DateOnly(2100, 12, 31), 1_000_000, null), Today);
        Assert.Equal((DocumentStatus.Expired, DocumentStatus.Ok), (a.Status, b.Status));
    }

    [Fact]
    public async Task Documents_The51stIsRefused()
    {
        var car = await CarAsync();
        for (var i = 0; i < VehicleDocument.MaxPerVehicle; i++)
        {
            await DocAsync(car, i);
        }

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => DocAsync(car, 60));
        Assert.Equal(("vehicleDocument.tooMany", (object?)50), (ex.Code, ex.Extensions["max"]));
    }

    [Fact]
    public async Task Documents_ArchivedCar_IsReadOnly_ButListable()
    {
        var car = await CarAsync();
        var doc = await DocAsync(car, 10);
        await vehicles.ArchiveAsync(userId, car, true);
        var request = new VehicleDocumentRequest("Insurance", Today, null, null);

        Assert.Equal("vehicleDocument.vehicleArchived", await CodeAsync(() => documents.CreateAsync(userId, car, request, Today)));
        Assert.Equal("vehicleDocument.vehicleArchived", await CodeAsync(() => documents.UpdateAsync(userId, car, doc.Id, request, Today)));
        Assert.Equal("vehicleDocument.vehicleArchived", await CodeAsync(() => documents.DeleteAsync(userId, car, doc.Id)));
        Assert.Single(await documents.ListAsync(userId, car, Today));
    }

    [Fact]
    public async Task Documents_AnotherUsersCarOrDocument_IsNotFound()
    {
        var mine = await CarAsync();
        var theirs = await CarAsync("Theirs", otherUserId);
        var theirDoc = await DocAsync(theirs, 10, owner: otherUserId);
        var request = new VehicleDocumentRequest("Insurance", Today, null, null);

        Assert.Equal("vehicle.notFound", await CodeAsync(() => documents.ListAsync(userId, theirs, Today)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => documents.CreateAsync(userId, theirs, request, Today)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => documents.UpdateAsync(userId, theirs, theirDoc.Id, request, Today)));
        Assert.Equal("vehicle.notFound", await CodeAsync(() => documents.DeleteAsync(userId, theirs, theirDoc.Id)));
        // Their document through my car.
        Assert.Equal("vehicleDocument.notFound", await CodeAsync(() => documents.UpdateAsync(userId, mine, theirDoc.Id, request, Today)));
        Assert.Equal("vehicleDocument.notFound", await CodeAsync(() => documents.DeleteAsync(userId, mine, theirDoc.Id)));
        Assert.Empty(await documents.ListAsync(userId, mine, Today));
        Assert.Equal(Today.AddDays(10), (await db.VehicleDocuments.SingleAsync()).ExpiryDate);
    }

    [Fact]
    public async Task Documents_TodayMoreThanADayOff_IsInvalidDate()
    {
        var car = await CarAsync();
        Assert.Equal("vehicleDocument.invalidDate", await CodeAsync(() => documents.ListAsync(userId, car, Today.AddDays(2))));
        Assert.Equal("vehicleDocument.invalidDate", await CodeAsync(() =>
            documents.CreateAsync(userId, car, new VehicleDocumentRequest("Insurance", Today, null, null), Today.AddDays(-2))));
        Assert.Empty(await documents.ListAsync(userId, car, Today.AddDays(1)));
    }

    [Fact]
    public async Task DeletingADocument_DeletesItsSnoozeRow_Only()
    {
        var car = await CarAsync();
        var doc = await DocAsync(car, 5);
        var other = await DocAsync(car, 6);
        await SnoozeAsync("Document", doc.Id);
        await SnoozeAsync("Document", other.Id);

        await documents.DeleteAsync(userId, car, doc.Id);

        Assert.Equal([other.Id], await db.Notifications.Select(n => n.RefId).ToListAsync());
        Assert.Equal([other.Id], await db.VehicleDocuments.Select(d => d.Id).ToListAsync());
    }

    [Fact]
    public async Task DeletingATaskOrRemovingAChecklist_DeletesItsSnoozeRow_Only()
    {
        var car = await CarAsync();
        var task = await TaskAsync(car, "Oil", 6_000);
        var keptTask = await TaskAsync(car, "Brakes", 6_000);
        var checklist = await ChecklistAsync(car, "Monthly", 40);
        await SnoozeAsync("Task", task.Id);
        await SnoozeAsync("Task", keptTask.Id);
        await SnoozeAsync("Checklist", checklist.Id);

        await tasks.DeleteAsync(userId, car, task.Id);
        await checklists.DeleteAsync(userId, checklist.Id);

        Assert.Equal([keptTask.Id], await db.Notifications.Select(n => n.RefId).ToListAsync());
    }

    [Fact]
    public async Task RenewingADocument_DeletesItsSnooze_AnEditKeepingTheExpiryDoesNot()
    {
        var car = await CarAsync();
        var doc = await DocAsync(car, 5);
        var other = await DocAsync(car, 6);
        await SnoozeAsync("Document", doc.Id, 30);
        await SnoozeAsync("Document", other.Id, 30);

        await documents.UpdateAsync(userId, car, doc.Id, new VehicleDocumentRequest("Insurance", Today.AddDays(5), 100, "Paid"), Today);
        Assert.Equal(2, await db.Notifications.CountAsync());

        // Renewed to a date still inside the lead time: it shows again at once.
        await documents.UpdateAsync(userId, car, doc.Id, new VehicleDocumentRequest("Insurance", Today.AddDays(20), 100, "Paid"), Today);

        Assert.Equal([other.Id], await db.Notifications.Select(n => n.RefId).ToListAsync());
        Assert.Equal([doc.Id], (await GetAsync()).Items.Select(i => i.RefId));
    }

    // ---- Reminders (criterion 3) ----

    [Fact]
    public async Task Reminders_HoldExactlyTheDueItemsOfActiveCars_WithTheCarPageStatus()
    {
        var car = await CarAsync("Mazda");
        var overdue = await TaskAsync(car, "Oil", 6_000);
        var dueSoon = await TaskAsync(car, "Brakes", 4_700);
        await TaskAsync(car, "Tires", 1_000); // Ok
        var disabled = await TaskAsync(car, "Coolant", 6_000);
        await tasks.UpdateAsync(userId, car, disabled.Id, new UpdateMaintenanceTaskRequest("Coolant", "Oil", 5_000, null, 44_000, Today, IsEnabled: false));
        var dueChecklist = await ChecklistAsync(car, "Monthly", 40);
        await ChecklistAsync(car, "Fresh", 1); // Ok
        await ChecklistAsync(car, "Manual", 400, intervalDays: null);
        var off = await ChecklistAsync(car, "Off", 400);
        await checklists.UpdateAsync(userId, off.Id, new UpdateVehicleChecklistRequest(null, 30, false));
        var expiring = await DocAsync(car, 10);
        await DocAsync(car, 200); // Ok

        var archived = await CarAsync("Old");
        await TaskAsync(archived, "Oil", 6_000);
        await ChecklistAsync(archived, "Monthly", 40);
        await DocAsync(archived, -5);
        await vehicles.ArchiveAsync(userId, archived, true);

        var theirs = await CarAsync("Theirs", otherUserId);
        await TaskAsync(theirs, "Oil", 6_000, otherUserId);
        await DocAsync(theirs, -5, owner: otherUserId);

        var result = await GetAsync();

        Assert.Equal(30, result.LeadDays);
        Assert.Equal(0, result.SnoozedCount);
        Assert.Equal(
            new HashSet<Guid> { overdue.Id, dueSoon.Id, dueChecklist.Id, expiring.Id },
            result.Items.Select(i => i.RefId).ToHashSet());
        Assert.All(result.Items, i => Assert.Equal((car, "Mazda"), (i.VehicleId, i.VehicleNickname)));

        // Same status and remaining values as the car page's lists.
        var carTasks = await tasks.ListAsync(userId, car);
        foreach (var item in result.Items.Where(i => i.Kind == NotificationKind.Task))
        {
            var t = carTasks.Single(x => x.Id == item.RefId);
            Assert.Equal((t.Status.ToString(), t.RemainingKm, t.RemainingDays, t.Name), (item.Status, item.RemainingKm, item.RemainingDays, item.Name));
        }

        var c = (await checklists.ListAsync(userId, car)).Single(x => x.Id == dueChecklist.Id);
        var ci = result.Items.Single(i => i.RefId == dueChecklist.Id);
        Assert.Equal((NotificationKind.Checklist, c.Status.ToString(), c.RemainingDays, "Monthly", (DateOnly?)null),
            (ci.Kind, ci.Status, ci.RemainingDays, ci.Name, ci.DueDate));

        var di = result.Items.Single(i => i.RefId == expiring.Id);
        Assert.Equal((NotificationKind.Document, "Expiring", (string?)null, (VehicleDocumentType?)VehicleDocumentType.Insurance, (DateOnly?)Today.AddDays(10), 10, (decimal?)null),
            (di.Kind, di.Status, di.Name, di.DocumentType, di.DueDate, di.RemainingDays, di.RemainingKm));
    }

    [Fact]
    public async Task Reminders_SortSevereFirst_ThenDaysLeft_NullLast_ThenNickname_ThenName()
    {
        var a = await CarAsync("A");
        var b = await CarAsync("B");
        var expired = await DocAsync(b, -2, "Registration");                // Expired, -2
        var overdueChecklist = await ChecklistAsync(a, "Weekly", 35);        // Overdue, -5
        var overdueKmTask = await TaskAsync(a, "Oil", 6_000);                // Overdue, no days
        var expiringB = await DocAsync(b, 3, "Inspection");                  // Expiring, 3
        var expiringA2 = await DocAsync(a, 3, "Licence");                    // Expiring, 3 (A, Licence)
        var expiringA1 = await DocAsync(a, 3, "Insurance");                  // Expiring, 3 (A, Insurance)
        var dueSoonChecklist = await ChecklistAsync(b, "Monthly", 28);       // DueSoon, 2
        var dueSoonKmTask = await TaskAsync(b, "Brakes", 4_700);             // DueSoon, no days

        var items = (await GetAsync()).Items;

        Assert.Equal(
            [overdueChecklist.Id, expired.Id, overdueKmTask.Id, dueSoonChecklist.Id, expiringA1.Id, expiringA2.Id, expiringB.Id, dueSoonKmTask.Id],
            items.Select(i => i.RefId));
    }

    [Fact]
    public async Task Reminders_TodayMoreThanADayOff_IsInvalidDate()
    {
        Assert.Equal("reminder.invalidDate", await CodeAsync(() => reminders.GetAsync(userId, Today.AddDays(2))));
        Assert.Equal("reminder.invalidDate", await CodeAsync(() => SnoozeAsync("Task", Guid.NewGuid(), today: Today.AddDays(-2))));
    }

    // ---- Snooze (criterion 4) ----

    [Fact]
    public async Task Snooze_HidesUntilItsDate_AndComesBackOnThatDate()
    {
        var car = await CarAsync();
        var task = await TaskAsync(car, "Oil", 6_000);
        var yesterday = Today.AddDays(-1);

        var snooze = await SnoozeAsync("Task", task.Id, days: 1, today: yesterday);

        Assert.Equal(Today, snooze.SnoozedUntil);
        var onYesterday = await GetAsync(yesterday);
        Assert.Empty(onYesterday.Items);
        Assert.Equal(1, onYesterday.SnoozedCount);
        var onTheDate = await GetAsync(Today);
        Assert.Single(onTheDate.Items);
        Assert.Equal(0, onTheDate.SnoozedCount);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(30)]
    public async Task Snooze_AcceptsOneSevenOrThirtyDays(int days)
    {
        var car = await CarAsync();
        var doc = await DocAsync(car, 5);
        Assert.Equal(Today.AddDays(days), (await SnoozeAsync("Document", doc.Id, days)).SnoozedUntil);
        Assert.Empty((await GetAsync()).Items);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(2)]
    [InlineData(31)]
    [InlineData(-7)]
    public async Task Snooze_OtherDays_AreInvalid(int days)
    {
        var car = await CarAsync();
        var doc = await DocAsync(car, 5);
        Assert.Equal("reminder.invalidSnooze", await CodeAsync(() => SnoozeAsync("Document", doc.Id, days)));
        Assert.Empty(db.Notifications);
    }

    [Fact]
    public async Task Snooze_Again_MovesTheDate_OnOneRow()
    {
        var car = await CarAsync();
        var checklist = await ChecklistAsync(car, "Monthly", 40);
        await SnoozeAsync("Checklist", checklist.Id, 30);

        await SnoozeAsync("Checklist", checklist.Id, 1);

        var row = await db.Notifications.SingleAsync();
        Assert.Equal((Today.AddDays(1), car, NotificationKind.Checklist, (DateTimeOffset?)null), (row.SnoozedUntil, row.VehicleId, row.Kind, row.SentAt));
    }

    [Fact]
    public async Task Undo_RestoresTheItem_AndIsANoOpWithoutASnooze()
    {
        var car = await CarAsync();
        var task = await TaskAsync(car, "Oil", 6_000);
        await SnoozeAsync("Task", task.Id);

        await reminders.UnsnoozeAsync(userId, "Task", task.Id);
        await reminders.UnsnoozeAsync(userId, "Task", task.Id);
        await reminders.UnsnoozeAsync(userId, "Nope", task.Id);

        var result = await GetAsync();
        Assert.Equal((1, 0), (result.Items.Count, result.SnoozedCount));
        Assert.Empty(db.Notifications);
    }

    [Fact]
    public async Task Undo_NeverTouchesAnotherUsersSnooze()
    {
        var theirs = await CarAsync("Theirs", otherUserId);
        var task = await TaskAsync(theirs, "Oil", 6_000, otherUserId);
        await SnoozeAsync("Task", task.Id, owner: otherUserId);

        await reminders.UnsnoozeAsync(userId, "Task", task.Id);

        Assert.Single(db.Notifications);
    }

    [Fact]
    public async Task SnoozedCount_CountsOnlyHiddenDueItems()
    {
        var car = await CarAsync();
        var due = await DocAsync(car, 5);
        var ok = await DocAsync(car, 200);
        var expiredSnooze = await TaskAsync(car, "Oil", 6_000);
        await SnoozeAsync("Document", due.Id);
        await SnoozeAsync("Document", ok.Id); // not a reminder now, so not counted
        await SnoozeAsync("Task", expiredSnooze.Id, 1, Today.AddDays(-1)); // ends today

        var result = await GetAsync();

        Assert.Equal(1, result.SnoozedCount);
        Assert.Equal([expiredSnooze.Id], result.Items.Select(i => i.RefId));
    }

    [Fact]
    public async Task Snooze_NeverChangesTheTaskStatusOrTheDashboardCounts()
    {
        var car = await CarAsync();
        var task = await TaskAsync(car, "Oil", 6_000);
        await SnoozeAsync("Task", task.Id);

        Assert.Equal(DueStatus.Overdue, (await tasks.ListAsync(userId, car)).Single().Status);
        Assert.Equal(1, (await tasks.DashboardAsync(userId, Today)).OverdueCount);
    }

    [Fact]
    public async Task Snooze_AnotherUsersItem_ArchivedCar_OrUnknownKind_IsNotFound()
    {
        var theirs = await CarAsync("Theirs", otherUserId);
        var theirTask = await TaskAsync(theirs, "Oil", 6_000, otherUserId);
        var theirChecklist = await ChecklistAsync(theirs, "Monthly", 40, owner: otherUserId);
        var theirDoc = await DocAsync(theirs, 5, owner: otherUserId);
        var archived = await CarAsync("Old");
        var archivedDoc = await DocAsync(archived, 5);
        await vehicles.ArchiveAsync(userId, archived, true);
        var mine = await CarAsync();
        var myTask = await TaskAsync(mine, "Oil", 6_000);

        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("Task", theirTask.Id)));
        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("Checklist", theirChecklist.Id)));
        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("Document", theirDoc.Id)));
        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("Document", archivedDoc.Id)));
        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("Document", myTask.Id))); // wrong kind for the id
        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("task", myTask.Id)));
        Assert.Equal("reminder.notFound", await CodeAsync(() => SnoozeAsync("1", myTask.Id)));
        Assert.Empty(db.Notifications);
    }

    // ---- Lead days (criterion 5) ----

    private async Task<UserDto> RegisterAsync() =>
        (await auth.RegisterAsync(new RegisterRequest($"{Guid.NewGuid():N}@example.com", "Passw0rd!"))).User;

    [Fact]
    public async Task LeadDays_Default30_SavedThroughSettings_AndMoveDocumentsInOrOut()
    {
        var me = await RegisterAsync();
        Assert.Equal(30, me.ReminderLeadDays);
        Assert.Equal(30, (await auth.GetMeAsync(me.Id)).ReminderLeadDays);
        var car = await CarAsync(owner: me.Id);
        var doc = await DocAsync(car, 20, owner: me.Id);
        Assert.Single((await GetAsync(owner: me.Id)).Items);

        var saved = await auth.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(ReminderLeadDays: 10));

        Assert.Equal(me with { ReminderLeadDays = 10 }, saved);
        Assert.Equal(10, (await auth.GetMeAsync(me.Id)).ReminderLeadDays);
        var after = await GetAsync(owner: me.Id);
        Assert.Equal((10, 0), (after.LeadDays, after.Items.Count));
        Assert.Equal(DocumentStatus.Ok, (await documents.ListAsync(me.Id, car, Today)).Single(d => d.Id == doc.Id).Status);

        await auth.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(ReminderLeadDays: 365));
        await auth.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(Theme: "Dark")); // null leaves it
        Assert.Equal(365, (await auth.GetMeAsync(me.Id)).ReminderLeadDays);
        Assert.Single(db.NotificationRules.Where(r => r.UserId == me.Id));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(366)]
    [InlineData(-1)]
    public async Task LeadDays_OutOfRange_IsRejected_AndSavesNothing(int leadDays)
    {
        var me = await RegisterAsync();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            auth.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(Theme: "Dark", ReminderLeadDays: leadDays)));

        Assert.Equal(("settings.invalidLeadDays", (object?)1, (object?)365), (ex.Code, ex.Extensions["min"], ex.Extensions["max"]));
        db.ChangeTracker.Clear();
        Assert.Equal(me, await auth.GetMeAsync(me.Id));
        Assert.Empty(db.NotificationRules);
    }

    [Fact]
    public async Task LeadDays_AreThePerUserValue_AndLoginReturnsThem()
    {
        var me = await RegisterAsync();
        var other = await RegisterAsync();
        await auth.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(ReminderLeadDays: 5));

        Assert.Equal(30, (await auth.GetMeAsync(other.Id)).ReminderLeadDays);
        Assert.Equal(5, (await auth.LoginAsync(new LoginRequest(me.Email, "Passw0rd!"))).User.ReminderLeadDays);
    }
}
