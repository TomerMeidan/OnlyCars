using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP3-C: GET /api/service-records filters, search, paging and totals. Criterion numbers refer to the ticket.</summary>
public class ServiceRecordSearchTests
{
    private static readonly DateOnly D = new(2025, 6, 15);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public ServiceRecordSearchTests()
    {
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
        string? q = null, int skip = 0, int take = 50, Guid? owner = null) =>
        tasks.SearchRecordsAsync(owner ?? userId, vehicleId, taskId, from, to, q, skip, take);

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
}
