using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP3-C and SRCH-1a: GET /api/service-records filters, search, sort, paging and totals. Criterion numbers refer to MVP3-C.</summary>
public class ServiceRecordSearchTests
{
    private static readonly DateOnly D = new(2025, 6, 15);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public ServiceRecordSearchTests()
    {
        db.Database.EnsureCreated(); // the 12 starter templates, for SRCH-1a's template-name search
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    private async Task<Guid> CreateCarAsync(Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, 50_000))).Id;

    private async Task<Guid> CreateTaskAsync(Guid car, Guid? owner = null) =>
        (await tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(null, "Oil", "Oil", 5_000, 365, 40_000, D))).Id;

    // Seeded directly: the search is read-only, so the record-creation rules are not under test here.
    private async Task<ServiceRecord> SeedAsync(Guid car, DateOnly date, decimal km = 45_000, decimal? cost = null, string? shop = null,
        string? notes = null, bool voided = false, Guid? taskId = null, ServiceItem? item = null, DateTimeOffset? createdAt = null)
    {
        var record = new ServiceRecord
        {
            VehicleId = car, Date = date, OdometerKm = km, TotalCost = cost, ShopName = shop, Notes = notes, IsVoided = voided,
            CreatedAt = createdAt ?? DateTimeOffset.UtcNow
        };
        if (taskId is { } t) record.Tasks.Add(new ServiceRecordTask { MaintenanceTaskId = t, PreviousLastDoneDate = D });
        if (item is not null) record.Items.Add(item);
        db.ServiceRecords.Add(record);
        await db.SaveChangesAsync();
        return record;
    }

    private Task<ServiceRecordPageDto> SearchAsync(Guid? vehicleId = null, Guid? taskId = null, DateOnly? from = null, DateOnly? to = null,
        string? q = null, int skip = 0, int take = 50, Guid? owner = null, string? sort = null, string? dir = null) =>
        tasks.SearchRecordsAsync(owner ?? userId, vehicleId, taskId, from, to, q, skip, take, default, sort, dir);

    private static List<Guid> Ids(ServiceRecordPageDto page) => page.Items.Select(r => r.Id).ToList();

    // --- Criterion 1 ---

    [Fact]
    public async Task NoFilters_ReturnsAllCarsNonVoided_ArchivedIncluded_NewestFirst_WithVehicleTasksItemsAndTotals()
    {
        var car = await CreateCarAsync();
        var archived = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var older = await SeedAsync(car, D.AddDays(-10), cost: 100.25m, taskId: task,
            item: new ServiceItem { Description = "Filter", Quantity = 1, UnitCost = 100.25m });
        var newer = await SeedAsync(archived, D, cost: null);
        await SeedAsync(car, D.AddDays(5), cost: 999, voided: true);
        await vehicles.ArchiveAsync(userId, archived, true);

        var page = await SearchAsync();

        Assert.Equal([newer.Id, older.Id], Ids(page));
        Assert.Equal(2, page.TotalCount);
        Assert.Equal(100.25m, page.TotalCost);
        Assert.Equal(archived, page.Items[0].VehicleId);
        var first = page.Items[1];
        Assert.Equal(car, first.VehicleId);
        Assert.Equal(task, Assert.Single(first.Tasks).Id);
        Assert.Equal("Filter", Assert.Single(first.Items).Description);
    }

    [Fact]
    public async Task Order_IsDateThenOdometerThenCreationTime_Descending()
    {
        var car = await CreateCarAsync();
        var now = DateTimeOffset.UtcNow;
        var lowKm = await SeedAsync(car, D, km: 45_000, createdAt: now.AddHours(1));
        var highKmOld = await SeedAsync(car, D, km: 46_000, createdAt: now);
        var highKmNew = await SeedAsync(car, D, km: 46_000, createdAt: now.AddMinutes(1));
        var later = await SeedAsync(car, D.AddDays(1), km: 44_000);

        Assert.Equal([later.Id, highKmNew.Id, highKmOld.Id, lowKm.Id], Ids(await SearchAsync()));
    }

    [Fact]
    public async Task NoRecords_ReturnsEmpty_WithZeroTotals()
    {
        var page = await SearchAsync();

        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
        Assert.Equal(0m, page.TotalCost);
    }

    // --- Criterion 2 ---

    [Fact]
    public async Task VehicleId_NarrowsToThatCar()
    {
        var a = await CreateCarAsync();
        var b = await CreateCarAsync();
        var inA = await SeedAsync(a, D, cost: 10);
        await SeedAsync(b, D, cost: 20);

        var page = await SearchAsync(vehicleId: a);

        Assert.Equal([inA.Id], Ids(page));
        Assert.Equal(10m, page.TotalCost);
    }

    [Fact]
    public async Task TaskId_NarrowsToRecordsLinkedToThatTask()
    {
        var car = await CreateCarAsync();
        var task = await CreateTaskAsync(car);
        var linked = await SeedAsync(car, D, taskId: task);
        await SeedAsync(car, D);

        Assert.Equal([linked.Id], Ids(await SearchAsync(taskId: task)));
    }

    [Fact]
    public async Task TaskIdOfAnotherOwnCar_WithVehicleId_ReturnsEmpty()
    {
        var a = await CreateCarAsync();
        var b = await CreateCarAsync();
        var taskOfB = await CreateTaskAsync(b);
        await SeedAsync(b, D, taskId: taskOfB);

        var page = await SearchAsync(vehicleId: a, taskId: taskOfB);

        Assert.Empty(page.Items);
        Assert.Equal(0, page.TotalCount);
    }

    [Fact]
    public async Task FromAndTo_AreInclusive_AloneAndTogether()
    {
        var car = await CreateCarAsync();
        var before = await SeedAsync(car, D.AddDays(-1));
        var onFrom = await SeedAsync(car, D);
        var onTo = await SeedAsync(car, D.AddDays(3));
        var after = await SeedAsync(car, D.AddDays(4));

        Assert.Equal([after.Id, onTo.Id, onFrom.Id], Ids(await SearchAsync(from: D)));
        Assert.Equal([onTo.Id, onFrom.Id, before.Id], Ids(await SearchAsync(to: D.AddDays(3))));
        Assert.Equal([onTo.Id, onFrom.Id], Ids(await SearchAsync(from: D, to: D.AddDays(3))));
        Assert.Equal([onFrom.Id], Ids(await SearchAsync(from: D, to: D)));
    }

    [Theory]
    [InlineData("speedy")]   // shop
    [InlineData("RATTLE")]   // notes
    [InlineData("Wiper")]    // item description
    [InlineData("bosch")]    // brand
    [InlineData("ab-12")]    // part number
    [InlineData("  bOsCh  ")] // trimmed
    public async Task Q_FindsAWordInShopNotesDescriptionBrandOrPartNumber_InAnyCase(string q)
    {
        var car = await CreateCarAsync();
        var shop = await SeedAsync(car, D.AddDays(-1), shop: "Speedy Garage");
        var notes = await SeedAsync(car, D.AddDays(-2), notes: "Fixed a rattle");
        var item = await SeedAsync(car, D.AddDays(-3),
            item: new ServiceItem { Description = "Wiper blades", Brand = "Bosch", PartNumber = "AB-1234", Quantity = 1, UnitCost = 1 });
        await SeedAsync(car, D.AddDays(-4), shop: "Other", notes: "Nothing");

        var expected = q.Trim().ToLower() switch
        {
            "speedy" => shop.Id,
            "rattle" => notes.Id,
            _ => item.Id
        };
        Assert.Equal([expected], Ids(await SearchAsync(q: q)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Q_BlankMeansNoSearch(string? q)
    {
        var car = await CreateCarAsync();
        await SeedAsync(car, D, shop: null);
        await SeedAsync(car, D.AddDays(-1), shop: "Garage");

        Assert.Equal(2, (await SearchAsync(q: q)).TotalCount);
    }

    [Fact]
    public async Task Filters_CombineWithAnd()
    {
        var a = await CreateCarAsync();
        var b = await CreateCarAsync();
        var task = await CreateTaskAsync(a);
        var match = await SeedAsync(a, D, shop: "Speedy", taskId: task, cost: 50);
        await SeedAsync(a, D, shop: "Other", taskId: task);                  // q misses
        await SeedAsync(a, D, shop: "Speedy");                                 // task misses
        await SeedAsync(a, D.AddDays(-30), shop: "Speedy", taskId: task);      // date misses
        await SeedAsync(b, D, shop: "Speedy");                                 // car misses

        var page = await SearchAsync(vehicleId: a, taskId: task, from: D.AddDays(-1), to: D, q: "speedy");

        Assert.Equal([match.Id], Ids(page));
        Assert.Equal(1, page.TotalCount);
        Assert.Equal(50m, page.TotalCost);
    }

    // --- Criterion 3 ---

    [Fact]
    public async Task Paging_IsStableAndNonOverlapping_WithEqualDates_AndTotalsCoverAllMatches()
    {
        var car = await CreateCarAsync();
        var createdAt = DateTimeOffset.UtcNow; // identical date, km and creation time: only the Id tie-break orders them
        var all = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            all.Add((await SeedAsync(car, D, cost: i == 0 ? null : 10.10m, createdAt: createdAt)).Id);
        }

        var pages = new[] { await SearchAsync(take: 2), await SearchAsync(skip: 2, take: 2), await SearchAsync(skip: 4, take: 2) };

        var seen = pages.SelectMany(Ids).ToList();
        Assert.Equal(5, seen.Distinct().Count());
        Assert.Equal(all.Order(), seen.Order());
        Assert.Equal([2, 2, 1], pages.Select(p => p.Items.Count));
        Assert.All(pages, p => Assert.Equal(5, p.TotalCount));
        Assert.All(pages, p => Assert.Equal(40.40m, p.TotalCost));
        Assert.Equal(seen, Ids(await SearchAsync(take: 5))); // same order as one big page
        Assert.Empty((await SearchAsync(skip: 5)).Items);
    }

    // --- Criterion 4 ---

    [Fact]
    public async Task AnotherUsersRecords_NeverAppear_EvenWithTheirVehicleIdOrTaskId()
    {
        var other = Guid.NewGuid();
        var theirCar = await CreateCarAsync(other);
        var theirTask = await CreateTaskAsync(theirCar, other);
        await SeedAsync(theirCar, D, shop: "Speedy", cost: 100, taskId: theirTask);
        var mine = await SeedAsync(await CreateCarAsync(), D, shop: "Mine");

        Assert.Equal([mine.Id], Ids(await SearchAsync()));
        Assert.Empty(Ids(await SearchAsync(q: "speedy")));
        foreach (var page in new[] { await SearchAsync(vehicleId: theirCar), await SearchAsync(taskId: theirTask) })
        {
            Assert.Empty(page.Items);
            Assert.Equal(0, page.TotalCount);
            Assert.Equal(0m, page.TotalCost);
        }
    }

    [Fact]
    public async Task FromAfterTo_IsInvalidDateRange()
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => SearchAsync(from: D.AddDays(1), to: D));
        Assert.Equal("serviceRecord.invalidDateRange", ex.Code);
    }

    [Fact]
    public async Task SearchOver100CharsAfterTrimming_IsSearchTooLong_And100IsAllowed()
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => SearchAsync(q: new string('a', 101)));
        Assert.Equal("serviceRecord.searchTooLong", ex.Code);

        Assert.Equal(0, (await SearchAsync(q: "  " + new string('a', 100) + "  ")).TotalCount);
    }

    [Theory]
    [InlineData(-1, 50)]
    [InlineData(0, 0)]
    [InlineData(0, 101)]
    public async Task BadSkipOrTake_IsInvalidPaging(int skip, int take)
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => SearchAsync(skip: skip, take: take));
        Assert.Equal("serviceRecord.invalidPaging", ex.Code);
    }

    [Fact]
    public async Task TakeOf1And100_AreAllowed()
    {
        await SearchAsync(take: 1);
        await SearchAsync(take: 100);
    }

    [Fact]
    public void Search_OnSqlServer_EscapesLikeWildcards()
    {
        // Same predicate shape as SearchRecordsAsync; ToQueryString needs no database.
        using var sql = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlServer("Server=none;Database=none").Options);
        var lower = "50%_[x".ToLower();

        var text = sql.ServiceRecords.Where(r => r.Notes != null && r.Notes.ToLower().Contains(lower)).ToQueryString();

        Assert.Contains(@"N'%50\%\_\[x%'", text);
        Assert.Contains(@"ESCAPE N'\'", text);
    }

    // --- SRCH-1a: words, task and template names, tire changes, sort, average and last date ---

    private static readonly Guid OilTemplate = Guid.Parse("7a5c0000-0000-4000-8000-000000000001");

    private async Task<Guid> CreateTaskAsync(Guid car, Guid? templateId, string name, Guid? owner = null) =>
        (await tasks.CreateAsync(owner ?? userId, car, new CreateMaintenanceTaskRequest(templateId, name, "Other", 5_000, 365, 40_000, D))).Id;

    private async Task<ServiceRecord> SeedTireChangeAsync(Guid car, DateOnly date, int tires, string? shop = null)
    {
        var record = await SeedAsync(car, date, shop: shop);
        for (var i = 0; i < tires; i++)
        {
            db.Tires.Add(new Tire { VehicleId = car, Position = (TirePosition)i, Brand = "Pirelli", FittedAt = date, ServiceRecordId = record.Id });
        }
        await db.SaveChangesAsync();
        return record;
    }

    [Theory]
    [InlineData("oil")]
    [InlineData("OIL")]
    [InlineData("שמן")]
    [InlineData("filter")]
    public async Task Q_FindsATaskByItsTemplatesNamesInBothLanguages_KeptRenamedOrTypedInHebrew(string q)
    {
        var car = await CreateCarAsync();
        var kept = await SeedAsync(car, D, taskId: await CreateTaskAsync(car, OilTemplate, "Engine oil and filter"));
        var renamed = await SeedAsync(car, D.AddDays(-1), taskId: await CreateTaskAsync(car, OilTemplate, "Shemen"));
        var hebrew = await SeedAsync(car, D.AddDays(-2), taskId: await CreateTaskAsync(car, OilTemplate, "שמן מנוע ופילטר שמן"));
        await SeedAsync(car, D.AddDays(-3), shop: "Garage", taskId: await CreateTaskAsync(car, null, "Brakes"));
        var other = Guid.NewGuid();
        var theirCar = await CreateCarAsync(other);
        await SeedAsync(theirCar, D, taskId: await CreateTaskAsync(theirCar, OilTemplate, "Engine oil and filter", other));

        Assert.Equal([kept.Id, renamed.Id, hebrew.Id], Ids(await SearchAsync(q: q)));
    }

    [Fact]
    public async Task Q_FindsATaskByItsOwnName_WithoutATemplate()
    {
        var car = await CreateCarAsync();
        var brakes = await SeedAsync(car, D, taskId: await CreateTaskAsync(car, null, "Front brakes"));
        await SeedAsync(car, D, taskId: await CreateTaskAsync(car, null, "Wipers"));

        Assert.Equal([brakes.Id], Ids(await SearchAsync(q: "BRAKES")));
    }

    [Theory]
    [InlineData("tire")]
    [InlineData("Tire change")]
    [InlineData("Tires")] // the English Tires chip
    [InlineData("צמיג")] // the Hebrew chip
    [InlineData("צמיגים")]
    [InlineData("החלפת צמיגים")]
    public async Task Q_FindsATireChangeByItsLabels_InBothLanguages_WithTireCount(string q)
    {
        var car = await CreateCarAsync();
        var change = await SeedTireChangeAsync(car, D, tires: 2);
        await SeedAsync(car, D, shop: "Garage");
        var other = Guid.NewGuid();
        await SeedTireChangeAsync(await CreateCarAsync(other), D, tires: 4);

        var page = await SearchAsync(q: q);

        Assert.Equal([change.Id], Ids(page));
        Assert.Equal(2, page.Items[0].TireCount);
    }

    [Fact]
    public async Task TireCount_IsZeroForANormalService_AndOnTheCarsRecordList()
    {
        var car = await CreateCarAsync();
        var change = await SeedTireChangeAsync(car, D, tires: 4);
        var normal = await SeedAsync(car, D.AddDays(-1));

        Assert.Equal([(change.Id, 4), (normal.Id, 0)], (await SearchAsync()).Items.Select(r => (r.Id, r.TireCount)));
        Assert.Equal([4, 0], (await tasks.ListRecordsAsync(userId, car)).Select(r => r.TireCount));
    }

    [Fact]
    public async Task Q_EveryWordMustMatch_InAnyField_InAnyOrder()
    {
        var car = await CreateCarAsync();
        var item = await SeedAsync(car, D, item: new ServiceItem { Description = "Oil filter", Quantity = 1, UnitCost = 1 });
        var acrossFields = await SeedAsync(car, D.AddDays(-1), shop: "Filter House", taskId: await CreateTaskAsync(car, null, "Oil"));
        await SeedAsync(car, D.AddDays(-2), notes: "oil only");
        await SeedAsync(car, D.AddDays(-3), notes: "filter only");

        Assert.Equal([item.Id, acrossFields.Id], Ids(await SearchAsync(q: "oil filter")));
        Assert.Equal([item.Id, acrossFields.Id], Ids(await SearchAsync(q: "  filter \t OIL ")));
        Assert.Empty((await SearchAsync(q: "oil filter missing")).Items);
    }

    [Fact]
    public async Task Q_MoreThan10Words_IsSearchTooManyWords_And10AreAllowed()
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => SearchAsync(q: "a b c d e f g h i j k"));
        Assert.Equal("serviceRecord.searchTooManyWords", ex.Code);

        Assert.Equal(0, (await SearchAsync(q: "a b c d e f g h i  j")).TotalCount);
    }

    // Five records; r3 and r5 tie on cost, r2 and r4 have none.
    private async Task<Guid[]> SeedSortCaseAsync()
    {
        var car = await CreateCarAsync();
        (int Days, decimal Km, decimal? Cost)[] rows = [(-4, 10_000, 300), (-3, 40_000, null), (-2, 20_000, 200), (-1, 30_000, null), (0, 50_000, 200)];
        var ids = new List<Guid>();
        foreach (var (days, km, cost) in rows)
        {
            ids.Add((await SeedAsync(car, D.AddDays(days), km: km, cost: cost)).Id);
        }
        return [.. ids];
    }

    [Theory]
    [InlineData(null, null, new[] { 5, 4, 3, 2, 1 })]
    [InlineData("date", "desc", new[] { 5, 4, 3, 2, 1 })]
    [InlineData("date", "asc", new[] { 1, 2, 3, 4, 5 })]
    [InlineData("cost", "desc", new[] { 1, 5, 3, 4, 2 })]   // tie 5/3 newest first, no cost last
    [InlineData("cost", "asc", new[] { 5, 3, 1, 4, 2 })]    // no cost still last
    [InlineData("odometer", "desc", new[] { 5, 2, 4, 3, 1 })]
    [InlineData("odometer", "asc", new[] { 1, 3, 4, 2, 5 })]
    public async Task Sort_OrdersEveryMatch_AcrossPages_WithNoRowMissingOrRepeated(string? sort, string? dir, int[] expected)
    {
        var r = await SeedSortCaseAsync();

        var paged = new List<Guid>();
        for (var skip = 0; skip < 5; skip += 2)
        {
            paged.AddRange(Ids(await SearchAsync(skip: skip, take: 2, sort: sort, dir: dir)));
        }

        Assert.Equal(expected.Select(n => r[n - 1]), paged);
    }

    [Theory]
    [InlineData("price", "desc")]
    [InlineData("Date", "desc")]
    [InlineData("date", "up")]
    [InlineData("", "asc")]
    public async Task BadSortOrDir_IsInvalidSort(string sort, string dir)
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => SearchAsync(sort: sort, dir: dir));
        Assert.Equal("serviceRecord.invalidSort", ex.Code);
    }

    [Fact]
    public async Task AverageCostAndLastDate_CoverEveryMatch_NotJustThePage_LeavingOutNoCost()
    {
        await SeedSortCaseAsync();

        var page = await SearchAsync(take: 1, sort: "date", dir: "asc");

        Assert.Single(page.Items);
        Assert.Equal((5, 700m, D), (page.TotalCount, page.TotalCost, page.LastDate));
        Assert.Equal(233.33m, page.AverageCost); // 700 / 3 with a cost (not / 5), rounded to cents
    }

    [Fact]
    public async Task AverageCostIsNull_WhenNoMatchHasACost_AndBothNull_WhenNothingMatches()
    {
        var car = await CreateCarAsync();
        await SeedAsync(car, D.AddDays(-1), shop: "Garage");
        await SeedAsync(car, D, shop: "Garage");

        var noCost = await SearchAsync(q: "garage");
        var none = await SearchAsync(q: "nothing");

        Assert.Equal((2, 0m, (decimal?)null, (DateOnly?)D), (noCost.TotalCount, noCost.TotalCost, noCost.AverageCost, noCost.LastDate));
        Assert.Equal((0, 0m, (decimal?)null, (DateOnly?)null), (none.TotalCount, none.TotalCost, none.AverageCost, none.LastDate));
    }
}
