using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP5-B backend: checklists attached to cars, their status, runs and run history. Criterion numbers refer to the ticket.</summary>
public class ChecklistRunTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly ChecklistTemplateService templates;
    private readonly VehicleChecklistService checklists;
    private readonly OdometerService odometer;
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid otherUserId = Guid.NewGuid();

    public ChecklistRunTests()
    {
        vehicles = new VehicleService(db);
        templates = new ChecklistTemplateService(db);
        checklists = new VehicleChecklistService(db, vehicles);
        odometer = new OdometerService(db, vehicles);
    }

    // Starts at 50,000 km with one reading dated today.
    private async Task<Guid> CarAsync(Guid? owner = null, string nickname = "Mazda") =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(nickname, null, null, null, null, null, null, null, null, null, 50_000))).Id;

    // Lights (Check), Tire pressure (Number, 2.0 to 2.6 bar), Notes (Text).
    private Task<ChecklistTemplateDto> TemplateAsync(string name = "Monthly quick check", Guid? owner = null) =>
        templates.CreateAsync(owner ?? userId, new ChecklistTemplateRequest(name, [
            new(null, "Lights", "Check", null, null, null),
            new(null, "Tire pressure", "Number", "bar", 2.0m, 2.6m),
            new(null, "Notes", "Text", null, null, null)
        ]));

    private Task<VehicleChecklistDto> AttachAsync(Guid car, Guid templateId, int? km = null, int? days = null, Guid? owner = null) =>
        checklists.AttachAsync(owner ?? userId, car, new AttachChecklistRequest(templateId, km, days, Today));

    private static List<ChecklistRunItemRequest?> Answers(ChecklistTemplateDto t, bool? ok = true, decimal? pressure = 2.2m, string? text = null,
        bool flagLights = false, bool flagPressure = false, bool flagText = false) =>
    [
        new ChecklistRunItemRequest(t.Items[0].Id, ok, null, null, flagLights),
        new ChecklistRunItemRequest(t.Items[1].Id, null, pressure, null, flagPressure),
        new ChecklistRunItemRequest(t.Items[2].Id, null, null, text, flagText)
    ];

    private Task<CreateChecklistRunResponse> RunAsync(Guid checklistId, ChecklistTemplateDto t, DateOnly? runAt = null, decimal? km = null,
        List<ChecklistRunItemRequest?>? items = null, bool confirm = false, string? notes = null) =>
        checklists.CreateRunAsync(userId, checklistId, new CreateChecklistRunRequest(runAt ?? Today, km, notes, items ?? Answers(t), confirm));

    private static async Task<AppException> ErrorAsync(Func<Task> act) => await Assert.ThrowsAnyAsync<AppException>(act);
    private static async Task<string> CodeAsync(Func<Task> act) => (await ErrorAsync(act)).Code;

    private async Task SetLastRunAsync(Guid checklistId, DateOnly date, decimal km)
    {
        var c = await db.VehicleChecklists.SingleAsync(x => x.Id == checklistId);
        (c.LastRunDate, c.LastRunOdometerKm, c.StartDate, c.StartOdometerKm) = (date, km, date, km);
        await db.SaveChangesAsync();
    }

    // --- Criterion 1: attach, list, edit, remove ---

    [Fact]
    public async Task Attach_StartsFromTodayAndTheCurrentOdometer_AndListsWithStatus()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();

        var attached = await AttachAsync(car, t.Id, km: 5_000, days: 30);

        Assert.Equal((t.Id, "Monthly quick check", 3, 5_000, 30, true), (attached.TemplateId, attached.Name, attached.ItemCount, attached.IntervalKm, attached.IntervalDays, attached.IsEnabled));
        Assert.Equal((Today, 50_000m, 0), (attached.LastRunDate, attached.LastRunOdometerKm, attached.RunCount));
        Assert.Equal((DueStatus.Ok, 5_000m, 30), (attached.Status, attached.RemainingKm, attached.RemainingDays));
        var stored = await db.VehicleChecklists.SingleAsync();
        Assert.Equal((Today, 50_000m), (stored.StartDate, stored.StartOdometerKm));
        Assert.Equal(attached, Assert.Single(await checklists.ListAsync(userId, car)));
    }

    [Fact]
    public async Task Attach_RejectsDuplicates_ArchivedCars_ForeignTemplatesAndCars_AndDatesNotToday()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        await AttachAsync(car, t.Id);

        Assert.Equal("vehicleChecklist.duplicate", (await ErrorAsync(() => AttachAsync(car, t.Id))) is ConflictException c ? c.Code : null);

        var foreignTemplate = await TemplateAsync(owner: otherUserId);
        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => AttachAsync(car, foreignTemplate.Id)));
        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => checklists.AttachAsync(userId, car, new AttachChecklistRequest(null, null, null, Today))));
        var foreignCar = await CarAsync(otherUserId);
        Assert.Equal("vehicle.notFound", await CodeAsync(() => AttachAsync(foreignCar, t.Id)));

        var b = await TemplateAsync("B");
        Assert.Equal("vehicleChecklist.invalidDate", await CodeAsync(() =>
            checklists.AttachAsync(userId, car, new AttachChecklistRequest(b.Id, null, null, Today.AddDays(2)))));

        var archived = await CarAsync();
        await vehicles.ArchiveAsync(userId, archived, true);
        Assert.Equal("vehicleChecklist.vehicleArchived", await CodeAsync(() => AttachAsync(archived, t.Id)));
    }

    [Theory]
    [InlineData(0, null, false)]
    [InlineData(1, null, true)]
    [InlineData(1_000_000, null, true)]
    [InlineData(1_000_001, null, false)]
    [InlineData(null, 0, false)]
    [InlineData(null, 1, true)]
    [InlineData(null, 3_650, true)]
    [InlineData(null, 3_651, false)]
    [InlineData(null, null, true)]
    public async Task Intervals_AreOptional_WithinTheirRanges_OnAttachAndEdit(int? km, int? days, bool valid)
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        if (valid)
        {
            var attached = await AttachAsync(car, t.Id, km, days);
            Assert.Equal((km, days), (attached.IntervalKm, attached.IntervalDays));
            var edited = await checklists.UpdateAsync(userId, attached.Id, new UpdateVehicleChecklistRequest(km, days, null));
            Assert.Equal((km, days), (edited.IntervalKm, edited.IntervalDays));
            return;
        }

        Assert.Equal("vehicleChecklist.invalidInterval", await CodeAsync(() => AttachAsync(car, t.Id, km, days)));
        var ok = await AttachAsync(car, t.Id, 1_000);
        Assert.Equal("vehicleChecklist.invalidInterval", await CodeAsync(() =>
            checklists.UpdateAsync(userId, ok.Id, new UpdateVehicleChecklistRequest(km, days, null))));
    }

    [Fact]
    public async Task Update_ChangesIntervalsAndOnOff_AndNullIsEnabledKeepsIt()
    {
        var car = await CarAsync();
        var c = await AttachAsync(car, (await TemplateAsync()).Id, km: 5_000);

        var off = await checklists.UpdateAsync(userId, c.Id, new UpdateVehicleChecklistRequest(null, 30, false));
        Assert.Equal((null, 30, false, null), (off.IntervalKm, off.IntervalDays, off.IsEnabled, off.Status));

        var kept = await checklists.UpdateAsync(userId, c.Id, new UpdateVehicleChecklistRequest(null, 30, null));
        Assert.False(kept.IsEnabled);
        var on = await checklists.UpdateAsync(userId, c.Id, new UpdateVehicleChecklistRequest(null, 30, true));
        Assert.Equal(DueStatus.Ok, on.Status);
    }

    [Fact]
    public async Task EveryEndpoint_HidesAnotherUsersCarAttachmentAndRun()
    {
        var t = await TemplateAsync(owner: otherUserId);
        var theirCar = await CarAsync(otherUserId);
        var theirs = await AttachAsync(theirCar, t.Id, owner: otherUserId);
        var theirRun = await checklists.CreateRunAsync(otherUserId, theirs.Id, new CreateChecklistRunRequest(Today, null, null, Answers(t)));

        Assert.Equal("vehicle.notFound", await CodeAsync(() => checklists.ListAsync(userId, theirCar)));
        Assert.Equal("vehicleChecklist.notFound", await CodeAsync(() => checklists.UpdateAsync(userId, theirs.Id, new UpdateVehicleChecklistRequest(null, null, false))));
        Assert.Equal("vehicleChecklist.notFound", await CodeAsync(() => checklists.DeleteAsync(userId, theirs.Id)));
        Assert.Equal("vehicleChecklist.notFound", await CodeAsync(() => checklists.ListRunsAsync(userId, theirs.Id)));
        Assert.Equal("vehicleChecklist.notFound", await CodeAsync(() => RunAsync(theirs.Id, t)));
        Assert.Equal("checklistRun.notFound", await CodeAsync(() => checklists.DeleteRunAsync(userId, theirRun.Run.Id)));

        // Nothing of theirs changed.
        Assert.Single(await checklists.ListRunsAsync(otherUserId, theirs.Id));
        Assert.True((await db.VehicleChecklists.SingleAsync()).IsEnabled);
    }

    [Fact]
    public async Task Delete_RemovesAnAttachmentWithoutRuns_AndRefusesOneWithRuns()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var empty = await AttachAsync(car, t.Id);
        await checklists.DeleteAsync(userId, empty.Id);
        Assert.Empty(await checklists.ListAsync(userId, car));

        var used = await AttachAsync(car, t.Id);
        await RunAsync(used.Id, t);
        Assert.Equal("vehicleChecklist.hasRuns", (await ErrorAsync(() => checklists.DeleteAsync(userId, used.Id))) is ConflictException c ? c.Code : null);
        Assert.Single(await checklists.ListAsync(userId, car));
    }

    // --- Criterion 2: status ---

    [Theory]
    [InlineData(899, DueStatus.Ok)]
    [InlineData(900, DueStatus.DueSoon)]   // 100 km left of 1,000 is exactly 10%
    [InlineData(1_000, DueStatus.DueSoon)] // 0 left is due now
    [InlineData(1_001, DueStatus.Overdue)]
    public async Task KmStatus_UsesA10PercentThreshold(int usedKm, DueStatus status)
    {
        var car = await CarAsync();
        var c = await AttachAsync(car, (await TemplateAsync()).Id, km: 1_000);
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(50_000 + usedKm, Today));

        var listed = Assert.Single(await checklists.ListAsync(userId, car));
        Assert.Equal((status, 1_000m - usedKm), (listed.Status, listed.RemainingKm));
        Assert.Equal(c.Id, listed.Id);
    }

    [Theory]
    [InlineData(26, DueStatus.Ok)]
    [InlineData(27, DueStatus.DueSoon)] // 3 days left of 30 is exactly 10%
    [InlineData(30, DueStatus.DueSoon)]
    [InlineData(31, DueStatus.Overdue)]
    public async Task DaysStatus_UsesA10PercentThreshold_CountingFromTheLastRun(int daysAgo, DueStatus status)
    {
        var car = await CarAsync();
        var c = await AttachAsync(car, (await TemplateAsync()).Id, days: 30);
        await SetLastRunAsync(c.Id, Today.AddDays(-daysAgo), 50_000);

        var listed = Assert.Single(await checklists.ListAsync(userId, car));
        Assert.Equal((status, 30 - daysAgo), (listed.Status, listed.RemainingDays));
    }

    [Fact]
    public async Task ManualOnlyAndOff_HaveNoStatus_AndAreNeverDue()
    {
        var car = await CarAsync();
        var manual = await AttachAsync(car, (await TemplateAsync("Manual")).Id);
        var off = await AttachAsync(car, (await TemplateAsync("Off")).Id, km: 100, days: 1);
        await checklists.UpdateAsync(userId, off.Id, new UpdateVehicleChecklistRequest(100, 1, false));
        await SetLastRunAsync(manual.Id, Today.AddDays(-3_000), 0);
        await SetLastRunAsync(off.Id, Today.AddDays(-3_000), 0);

        foreach (var c in await checklists.ListAsync(userId, car))
        {
            Assert.Equal((null, null, null, null), (c.Status, c.RemainingKm, c.RemainingDays, c.Progress));
        }
    }

    [Fact]
    public async Task List_IsMostUrgentFirst_ThenManualOnly_ThenOff_TiesByName()
    {
        var car = await CarAsync();
        async Task<Guid> Add(string name, int? days, int daysAgo = 0, bool enabled = true)
        {
            var c = await AttachAsync(car, (await TemplateAsync(name)).Id, days: days);
            if (!enabled) await checklists.UpdateAsync(userId, c.Id, new UpdateVehicleChecklistRequest(null, days, false));
            await SetLastRunAsync(c.Id, Today.AddDays(-daysAgo), 50_000);
            return c.Id;
        }

        var off = await Add("A off", 30, enabled: false);
        var manual = await Add("A manual", null);
        var okB = await Add("B ok", 30);
        var okA = await Add("A ok", 30);
        var soon = await Add("Z soon", 30, 28);
        var overdue = await Add("Z overdue", 30, 40);

        Assert.Equal([overdue, soon, okA, okB, manual, off], (await checklists.ListAsync(userId, car)).Select(c => c.Id));
    }

    // --- Criterion 3: flags ---

    [Theory]
    [InlineData("2.0", false)] // Min itself is inside
    [InlineData("2.6", false)] // Max itself is inside
    [InlineData("1.99", true)]
    [InlineData("2.61", true)]
    public async Task NumberOutsideMinMax_IsFlagged_TheBoundsAreInside(string value, bool flagged)
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        var run = (await RunAsync(c.Id, t, items: Answers(t, pressure: decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture)))).Run;

        Assert.Equal(flagged, run.Items[1].IsFlagged);
        Assert.Equal(flagged ? 1 : 0, run.FlaggedCount);
    }

    [Fact]
    public async Task NotOk_IsFlagged_AHandFlagIsKept_AndAnAutoFlagCantBeCleared()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        // Not OK and 1.8 bar with IsFlagged false from the client (it can't clear them); Notes flagged by hand.
        var run = (await RunAsync(c.Id, t, items: Answers(t, ok: false, pressure: 1.8m, text: " Scratch ", flagText: true))).Run;

        Assert.Equal([true, true, true], run.Items.Select(i => i.IsFlagged));
        Assert.Equal(3, run.FlaggedCount);
        Assert.Equal("Scratch", run.Items[2].TextValue);

        // Unanswered items and OK aren't flagged; a hand flag on any item is kept.
        var second = (await RunAsync(c.Id, t, items: Answers(t, ok: null, pressure: null, flagLights: true))).Run;
        Assert.Equal([true, false, false], second.Items.Select(i => i.IsFlagged));
        Assert.Equal((null, null, null), (second.Items[0].BoolValue, second.Items[1].NumberValue, second.Items[2].TextValue));
    }

    [Fact]
    public async Task Run_SnapshotsEachItem_InTemplateOrder_WhateverTheRequestOrder()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        var items = Answers(t, pressure: 2.4m);
        items.Reverse();

        var run = (await RunAsync(c.Id, t, items: items, notes: "  Before the trip  ")).Run;

        Assert.Equal(["Lights", "Tire pressure", "Notes"], run.Items.Select(i => i.Label));
        Assert.Equal((ChecklistItemType.Number, "bar", 2.0m, 2.6m, 2.4m), (run.Items[1].Type, run.Items[1].Unit, run.Items[1].MinValue, run.Items[1].MaxValue, run.Items[1].NumberValue));
        Assert.Equal("Before the trip", run.Notes);
        db.ChangeTracker.Clear();
        Assert.Equal(run, Assert.Single(await checklists.ListRunsAsync(userId, c.Id)), new RunComparer());
    }

    // --- Validation ---

    public static TheoryData<int, bool?, string?, string?, bool> ItemValues => new()
    {
        { 0, null, "1", null, false },          // number on a Check item
        { 0, null, null, "x", false },          // text on a Check item
        { 1, true, "2.2", null, false },        // OK on a Number item
        { 1, null, "2.123", null, false },      // 3 decimals
        { 1, null, "1000000.01", null, false },
        { 1, null, "-1000000.01", null, false },
        { 1, null, "1000000", null, true },
        { 1, null, "-1000000", null, true },
        { 2, false, null, null, false },        // Not OK on a Text item
        { 2, null, "1", null, false },          // number on a Text item
        { 2, null, null, "500", true },         // 500 characters
        { 2, null, null, "501", false },
    };

    [Theory]
    [MemberData(nameof(ItemValues))]
    public async Task ItemValues_MustFitTheItemType_WithTheIndex(int index, bool? boolValue, string? number, string? text, bool valid)
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        var items = Answers(t, ok: null, pressure: null);
        var textValue = text is "500" or "501" ? new string('a', int.Parse(text)) : text;
        items[index] = new ChecklistRunItemRequest(t.Items[index].Id, boolValue,
            number is null ? null : decimal.Parse(number, System.Globalization.CultureInfo.InvariantCulture), textValue);

        if (valid)
        {
            await RunAsync(c.Id, t, items: items);
            return;
        }

        var error = await ErrorAsync(() => RunAsync(c.Id, t, items: items));
        Assert.Equal(("checklistItem.invalidValue", (object?)index), (error.Code, error.Extensions["index"]));
        Assert.Empty(await db.ChecklistRuns.ToListAsync());
    }

    [Fact]
    public async Task Items_MustBeExactlyTheTemplatesCurrentItems()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        var other = await TemplateAsync("Other");
        var full = Answers(t);

        Assert.Equal("checklistRun.itemsChanged", await CodeAsync(() => RunAsync(c.Id, t, items: full[..2])));
        Assert.Equal("checklistRun.itemsChanged", await CodeAsync(() => RunAsync(c.Id, t, items: [.. full, new ChecklistRunItemRequest(other.Items[0].Id, true, null, null)])));
        Assert.Equal("checklistRun.itemsChanged", await CodeAsync(() => RunAsync(c.Id, t, items: [full[0], full[0], full[2]])));
        Assert.Equal("checklistRun.itemsChanged", await CodeAsync(() => RunAsync(c.Id, t, items: [full[0], full[1], null])));
        Assert.Equal("checklistRun.itemsChanged", await CodeAsync(() =>
            checklists.CreateRunAsync(userId, c.Id, new CreateChecklistRunRequest(Today, null, null, null))));

        // A form opened before a template edit (an item added) is told to reload.
        await templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest(t.Name, [
            .. t.Items.Select(i => new ChecklistTemplateItemRequest(i.Id, i.Label, i.Type.ToString(), i.Unit, i.MinValue, i.MaxValue)),
            new(null, "Wipers", "Check", null, null, null)
        ]));
        Assert.Equal("checklistRun.itemsChanged", await CodeAsync(() => RunAsync(c.Id, t, items: full)));
    }

    [Fact]
    public async Task Run_RejectsFutureDates_OdometerAndNotesOutOfRange_AndArchivedCars()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        Assert.Equal("checklistRun.futureDate", await CodeAsync(() => RunAsync(c.Id, t, runAt: Today.AddDays(2))));
        await RunAsync(c.Id, t, runAt: Today.AddDays(1)); // one day of slack for the client's local date
        Assert.Equal("checklistRun.invalidOdometer", await CodeAsync(() => RunAsync(c.Id, t, km: -1, confirm: true)));
        Assert.Equal("checklistRun.invalidOdometer", await CodeAsync(() => RunAsync(c.Id, t, km: 10_000_001)));
        await RunAsync(c.Id, t, runAt: Today.AddDays(1), km: 10_000_000);
        Assert.Equal("checklistRun.invalidNotes", await CodeAsync(() => RunAsync(c.Id, t, notes: new string('n', 1_001))));
        await RunAsync(c.Id, t, runAt: Today.AddDays(1), notes: new string('n', 1_000));

        await vehicles.ArchiveAsync(userId, car, true);
        Assert.Equal("vehicleChecklist.vehicleArchived", await CodeAsync(() => RunAsync(c.Id, t)));
        Assert.Equal(3, await db.ChecklistRuns.CountAsync());
    }

    // --- Criterion 4: last run, odometer, delete ---

    [Fact]
    public async Task RunWithOdometer_LogsAChecklistReading_UpdatesTheCar_AndMovesTheLastRun()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id, km: 5_000);

        var result = await RunAsync(c.Id, t, km: 51_000);

        var reading = await db.OdometerReadings.SingleAsync(r => r.Source == OdometerSource.Checklist);
        Assert.Equal((51_000m, Today, reading.Id), (reading.ValueKm, reading.ReadingDate, result.Run.OdometerReadingId));
        Assert.Equal(51_000m, (await vehicles.GetAsync(userId, car)).CurrentOdometerKm);
        Assert.Equal((Today, 51_000m, 1, 5_000m), (result.Checklist.LastRunDate, result.Checklist.LastRunOdometerKm, result.Checklist.RunCount, result.Checklist.RemainingKm));
    }

    [Fact]
    public async Task RunWithoutOdometer_StoresTheCurrentOdometer_AndAddsNoReading()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        var result = await RunAsync(c.Id, t);

        Assert.Equal((50_000m, null), (result.Run.OdometerKm, result.Run.OdometerReadingId));
        Assert.Equal(1, await db.OdometerReadings.CountAsync());
    }

    [Fact]
    public async Task RunOdometer_FollowsTheDateOrderRule_UnlessConfirmed()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        var error = await ErrorAsync(() => RunAsync(c.Id, t, km: 49_000));
        Assert.Equal(("odometer.lowerThanPrevious", (object?)50_000m), (error.Code, error.Extensions["previousKm"]));
        await odometer.AddAsync(userId, car, new AddOdometerReadingRequest(40_000, Today.AddDays(-10), ConfirmCorrection: true));
        error = await ErrorAsync(() => RunAsync(c.Id, t, runAt: Today.AddDays(-20), km: 45_000));
        Assert.Equal(("odometer.higherThanNext", (object?)40_000m), (error.Code, error.Extensions["nextKm"]));
        Assert.Empty(await db.ChecklistRuns.ToListAsync());

        var corrected = await RunAsync(c.Id, t, km: 49_000, confirm: true);
        Assert.Equal(49_000m, (await vehicles.GetAsync(userId, car)).CurrentOdometerKm);
        Assert.NotNull(corrected.Run.OdometerReadingId);
    }

    [Fact]
    public async Task AnOlderRun_DoesntMoveTheLastRun_ASameDayHigherOneDoes()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        var older = await RunAsync(c.Id, t, runAt: Today.AddDays(-5), km: 40_000, confirm: true);
        Assert.Equal((Today, 50_000m), (older.Checklist.LastRunDate, older.Checklist.LastRunOdometerKm));

        var newer = await RunAsync(c.Id, t, km: 50_500);
        Assert.Equal((Today, 50_500m), (newer.Checklist.LastRunDate, newer.Checklist.LastRunOdometerKm));
    }

    [Fact]
    public async Task LatestRunDate_IsTheLatestRun_ApartFromTheCountdownStart_AndNullWithoutRuns()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        Assert.Null(c.LatestRunDate);

        // Attached today, the only run dated last month: the countdown keeps the attach date (L110).
        var older = await RunAsync(c.Id, t, runAt: Today.AddDays(-30));
        Assert.Equal((Today.AddDays(-30), Today), (older.Checklist.LatestRunDate, older.Checklist.LastRunDate));
        Assert.Equal(Today.AddDays(-30), Assert.Single(await checklists.ListAsync(userId, car)).LatestRunDate);

        var newer = await RunAsync(c.Id, t, runAt: Today.AddDays(-1));
        Assert.Equal((Today.AddDays(-1), Today), (newer.Checklist.LatestRunDate, newer.Checklist.LastRunDate));

        await checklists.DeleteRunAsync(userId, newer.Run.Id);
        Assert.Equal(Today.AddDays(-30), Assert.Single(await checklists.ListAsync(userId, car)).LatestRunDate);
        await checklists.DeleteRunAsync(userId, older.Run.Id);
        Assert.Null(Assert.Single(await checklists.ListAsync(userId, car)).LatestRunDate);
    }

    [Fact]
    public async Task DeleteRun_RecomputesFromTheRemainingRuns_ThenTheStartValues_AndRemovesItsReading()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        await SetLastRunAsync(c.Id, Today.AddDays(-30), 45_000); // attached a month ago at 45,000
        var older = await RunAsync(c.Id, t, runAt: Today.AddDays(-10), km: 48_000, confirm: true);
        var latest = await RunAsync(c.Id, t, km: 52_000);
        Assert.Equal(52_000m, (await vehicles.GetAsync(userId, car)).CurrentOdometerKm);

        await checklists.DeleteRunAsync(userId, latest.Run.Id);

        var after = Assert.Single(await checklists.ListAsync(userId, car));
        Assert.Equal((Today.AddDays(-10), 48_000m, 1), (after.LastRunDate, after.LastRunOdometerKm, after.RunCount));
        Assert.Equal(50_000m, (await vehicles.GetAsync(userId, car)).CurrentOdometerKm);
        Assert.False(await db.OdometerReadings.AnyAsync(r => r.ValueKm == 52_000));
        Assert.Empty(await db.ChecklistRunItems.Where(i => i.RunId == latest.Run.Id).ToListAsync());

        await checklists.DeleteRunAsync(userId, older.Run.Id);

        after = Assert.Single(await checklists.ListAsync(userId, car));
        Assert.Equal((Today.AddDays(-30), 45_000m, 0), (after.LastRunDate, after.LastRunOdometerKm, after.RunCount));
        Assert.Equal(1, await db.OdometerReadings.CountAsync());
        Assert.Equal("checklistRun.notFound", await CodeAsync(() => checklists.DeleteRunAsync(userId, older.Run.Id)));
    }

    [Fact]
    public async Task DeleteRun_KeepsTheStartValues_WhenOnlyAnOlderRunRemains()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        await RunAsync(c.Id, t, runAt: Today.AddDays(-5), km: 40_000, confirm: true); // older than the attach
        var latest = await RunAsync(c.Id, t);

        await checklists.DeleteRunAsync(userId, latest.Run.Id);

        var after = Assert.Single(await checklists.ListAsync(userId, car));
        Assert.Equal((Today, 50_000m), (after.LastRunDate, after.LastRunOdometerKm));
    }

    [Fact]
    public async Task Runs_AreNewestFirst_ByDateThenCreationTime()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        var first = await RunAsync(c.Id, t);
        var old = await RunAsync(c.Id, t, runAt: Today.AddDays(-3));
        var second = await RunAsync(c.Id, t);

        Assert.Equal([second.Run.Id, first.Run.Id, old.Run.Id], (await checklists.ListRunsAsync(userId, c.Id)).Select(r => r.Id));
    }

    // --- Criterion 5: inUse, snapshots ---

    [Fact]
    public async Task TemplateDelete_IsRefusedWhileAttached_AndAllowedAfterRemoving()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);

        Assert.Equal("checklistTemplate.inUse", (await ErrorAsync(() => templates.DeleteAsync(userId, t.Id))) is ConflictException e ? e.Code : null);

        await checklists.DeleteAsync(userId, c.Id);
        await templates.DeleteAsync(userId, t.Id);
        Assert.Empty(await templates.ListAsync(userId));
    }

    [Fact]
    public async Task DeletingOrRenamingATemplateItem_KeepsOldRunsReadableFromTheirSnapshot()
    {
        var car = await CarAsync();
        var t = await TemplateAsync();
        var c = await AttachAsync(car, t.Id);
        var run = (await RunAsync(c.Id, t, items: Answers(t, pressure: 1.5m))).Run;

        // Rename Lights, drop Tire pressure, keep Notes.
        await templates.UpdateAsync(userId, t.Id, new ChecklistTemplateRequest(t.Name, [
            new(t.Items[0].Id, "Headlights", "Check", null, null, null),
            new(t.Items[2].Id, "Notes", "Text", null, null, null)
        ]));
        db.ChangeTracker.Clear();

        var old = Assert.Single(await checklists.ListRunsAsync(userId, c.Id));
        Assert.Equal(["Lights", "Tire pressure", "Notes"], old.Items.Select(i => i.Label));
        Assert.Equal([t.Items[0].Id, null, t.Items[2].Id], old.Items.Select(i => i.TemplateItemId));
        Assert.Equal((1.5m, "bar", true), (old.Items[1].NumberValue, old.Items[1].Unit, old.Items[1].IsFlagged));
        Assert.Equal(run.Id, old.Id);
    }

    // --- Dashboard ---

    [Fact]
    public async Task Dashboard_ListsEachActiveCarsEnabledChecklists_MostUrgentFirst_AndTheCountsStayTasksOnly()
    {
        var tasks = new MaintenanceTaskService(db, vehicles);
        var car = await CarAsync();
        var ok = await AttachAsync(car, (await TemplateAsync("A ok")).Id, days: 30);
        var overdue = await AttachAsync(car, (await TemplateAsync("B overdue")).Id, days: 30);
        await SetLastRunAsync(overdue.Id, Today.AddDays(-40), 50_000);
        var manual = await AttachAsync(car, (await TemplateAsync("C manual")).Id);
        var off = await AttachAsync(car, (await TemplateAsync("D off")).Id);
        await checklists.UpdateAsync(userId, off.Id, new UpdateVehicleChecklistRequest(null, null, false));
        var archived = await CarAsync(nickname: "Old");
        await AttachAsync(archived, (await TemplateAsync("E")).Id);
        await vehicles.ArchiveAsync(userId, archived, true);
        var other = await CarAsync(otherUserId);
        await AttachAsync(other, (await TemplateAsync(owner: otherUserId)).Id, owner: otherUserId);

        var dashboard = await tasks.DashboardAsync(userId, Today);

        var card = Assert.Single(dashboard.Vehicles);
        Assert.Equal([overdue.Id, ok.Id, manual.Id], card.Checklists.Select(c => c.Id));
        Assert.Equal((DueStatus.Overdue, "B overdue"), (card.Checklists[0].Status, card.Checklists[0].Name));
        Assert.Equal((0, 0, 0, 0), (dashboard.OverdueCount, dashboard.DueSoonCount, card.OverdueCount, card.DueSoonCount));
    }

    // Records hold lists, so compare them by value.
    private sealed class RunComparer : IEqualityComparer<ChecklistRunDto>
    {
        public bool Equals(ChecklistRunDto? a, ChecklistRunDto? b) =>
            a! with { Items = b!.Items, Attachments = b.Attachments } == b && a.Items.SequenceEqual(b.Items) && a.Attachments.SequenceEqual(b.Attachments);

        public int GetHashCode(ChecklistRunDto r) => r.Id.GetHashCode();
    }
}
