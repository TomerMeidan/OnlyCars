using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

public class MaintenanceTaskServiceTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly VehicleService vehicles;
    private readonly MaintenanceTaskService tasks;
    private readonly Guid userId = Guid.NewGuid();

    public MaintenanceTaskServiceTests()
    {
        db.Database.EnsureCreated(); // applies the HasData template seed
        vehicles = new VehicleService(db);
        tasks = new MaintenanceTaskService(db, vehicles);
    }

    private async Task<Guid> CreateCarAsync(decimal km = 50_000, Guid? owner = null) =>
        (await vehicles.CreateAsync(owner ?? userId, new CreateVehicleRequest(
            "Car", null, null, null, null, null, null, null, null, null, km))).Id;

    private static CreateMaintenanceTaskRequest Custom(string? name = "Wash", string? category = "Other", int? km = 5_000,
        int? days = 90, decimal? lastKm = 40_000, DateOnly? lastDate = null, Guid? templateId = null) =>
        new(templateId, name, category, km, days, lastKm, lastDate ?? Today.AddDays(-10));

    private static UpdateMaintenanceTaskRequest Update(string name = "Wash", string category = "Other", int? km = 5_000,
        int? days = 90, decimal lastKm = 40_000, bool? enabled = null) =>
        new(name, category, km, days, lastKm, Today.AddDays(-5), enabled);

    // --- Templates (criterion 1) ---

    [Fact]
    public async Task Templates_AreTheTwelveSeeded_OrderedByCategoryThenKey()
    {
        var templates = await tasks.TemplatesAsync();

        Assert.Equal(12, templates.Count);
        var timingBelt = templates.Single(t => t.Key == "timingBelt");
        Assert.Equal(("Timing belt", TaskCategory.Belts, 100_000, 1_825),
            (timingBelt.Name, timingBelt.Category, timingBelt.DefaultIntervalKm!.Value, timingBelt.DefaultIntervalDays!.Value));
        Assert.Null(templates.Single(t => t.Key == "brakeFluid").DefaultIntervalKm);
        Assert.Null(templates.Single(t => t.Key == "sparkPlugs").DefaultIntervalDays);
        Assert.Equal(templates.OrderBy(t => t.Category).ThenBy(t => t.Key, StringComparer.Ordinal).Select(t => t.Key),
            templates.Select(t => t.Key));
    }

    // --- Create (criteria 3, 4) ---

    [Fact]
    public async Task Create_FromTemplate_LinksTemplate_AndStoresWhatClientSent()
    {
        var car = await CreateCarAsync();
        var template = (await tasks.TemplatesAsync()).Single(t => t.Key == "oilChange");

        var task = await tasks.CreateAsync(userId, car, Custom(name: "  שמן מנוע  ", category: "Oil", km: 15_000, days: null, templateId: template.Id));

        Assert.Equal(template.Id, task.TemplateId);
        Assert.Equal("שמן מנוע", task.Name);
        Assert.Equal((TaskCategory.Oil, 15_000, (int?)null, 10, true), (task.Category, task.IntervalKm!.Value, task.IntervalDays, task.DueSoonPercent, task.IsEnabled));
        Assert.Single(await tasks.ListAsync(userId, car));
    }

    [Theory]
    [InlineData(5_000, null)]
    [InlineData(null, 90)]
    [InlineData(5_000, 90)]
    public async Task Create_Custom_AcceptsEitherOrBothIntervals_WithNullTemplate(int? km, int? days)
    {
        var car = await CreateCarAsync();

        var task = await tasks.CreateAsync(userId, car, Custom(km: km, days: days));

        Assert.Null(task.TemplateId);
        Assert.Equal((km, days), (task.IntervalKm, task.IntervalDays));
    }

    [Fact]
    public async Task Create_SameTemplateTwice_IsAllowed()
    {
        var car = await CreateCarAsync();
        var id = (await tasks.TemplatesAsync())[0].Id;

        await tasks.CreateAsync(userId, car, Custom(templateId: id));
        await tasks.CreateAsync(userId, car, Custom(templateId: id));

        Assert.Equal(2, (await tasks.ListAsync(userId, car)).Count);
    }

    [Fact]
    public async Task Create_LastDoneAtCurrentOdometerAndTomorrow_IsAccepted()
    {
        var car = await CreateCarAsync(50_000);

        var task = await tasks.CreateAsync(userId, car, Custom(lastKm: 50_000, lastDate: Today.AddDays(1)));

        Assert.Equal(50_000, task.LastDoneOdometerKm);
    }

    // --- Validation (criteria 4, 5): every bad value saves nothing ---

    public static TheoryData<string, CreateMaintenanceTaskRequest> BadRequests => new()
    {
        { "task.intervalRequired", Custom(km: null, days: null) },
        { "task.invalidInterval", Custom(km: 0) },
        { "task.invalidInterval", Custom(km: 1_000_001) },
        { "task.invalidInterval", Custom(days: 0) },
        { "task.invalidInterval", Custom(days: 7_301) },
        { "task.nameRequired", Custom(name: "") },
        { "task.nameRequired", Custom(name: "   ") },
        { "task.nameRequired", Custom(name: null) },
        { "task.nameRequired", Custom(name: new string('x', 101)) },
        { "task.invalidCategory", Custom(category: "Wheels") },
        { "task.invalidCategory", Custom(category: "3") },
        { "task.invalidCategory", Custom(category: "oil") },
        { "task.invalidCategory", Custom(category: null) },
        { "task.invalidLastDone", Custom(lastKm: -1) },
        { "task.invalidLastDone", Custom(lastKm: 50_000.01m) },
        { "task.invalidLastDone", Custom(lastKm: null) },
        { "task.futureDate", Custom(lastDate: Today.AddDays(2)) },
        { "task.invalidTemplate", Custom(templateId: Guid.NewGuid()) },
    };

    [Theory]
    [MemberData(nameof(BadRequests))]
    public async Task Create_InvalidValue_ThrowsCode_AndSavesNothing(string code, CreateMaintenanceTaskRequest request)
    {
        var car = await CreateCarAsync(50_000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.CreateAsync(userId, car, request));

        Assert.Equal(code, ex.Code);
        Assert.Empty(db.MaintenanceTasks);
    }

    [Fact]
    public async Task Create_LastDoneAboveCurrentOdometer_ReturnsCurrentKm()
    {
        var car = await CreateCarAsync(50_000);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => tasks.CreateAsync(userId, car, Custom(lastKm: 60_000)));

        Assert.Equal(50_000m, ex.Extensions["currentKm"]);
    }

    [Fact]
    public async Task Create_NameOf100CharsAfterTrim_IsAccepted()
    {
        var car = await CreateCarAsync();

        var task = await tasks.CreateAsync(userId, car, Custom(name: " " + new string('x', 100) + " "));

        Assert.Equal(100, task.Name.Length);
    }

    // --- Update (criteria 6, 7) ---

    [Fact]
    public async Task Update_ChangesEveryField_AndKeepsTemplate()
    {
        var car = await CreateCarAsync();
        var templateId = (await tasks.TemplatesAsync())[0].Id;
        var created = await tasks.CreateAsync(userId, car, Custom(templateId: templateId));

        var updated = await tasks.UpdateAsync(userId, car, created.Id,
            new UpdateMaintenanceTaskRequest("Brakes", "Brakes", null, 180, 45_000, Today.AddDays(-1), false));

        Assert.Equal(("Brakes", TaskCategory.Brakes, (int?)null, (int?)180, 45_000m, Today.AddDays(-1), false, (Guid?)templateId),
            (updated.Name, updated.Category, updated.IntervalKm, updated.IntervalDays, updated.LastDoneOdometerKm, updated.LastDoneDate, updated.IsEnabled, updated.TemplateId));
    }

    [Fact]
    public async Task Update_Disable_KeepsTaskListedAfterEnabledOnes_AndNullKeepsEnabledState()
    {
        var car = await CreateCarAsync();
        var a = await tasks.CreateAsync(userId, car, Custom(name: "A"));
        await tasks.CreateAsync(userId, car, Custom(name: "B"));

        await tasks.UpdateAsync(userId, car, a.Id, Update(name: "A", enabled: false));
        var list = await tasks.ListAsync(userId, car);
        Assert.Equal(["B", "A"], list.Select(t => t.Name));
        Assert.False(list[1].IsEnabled);

        var unchanged = await tasks.UpdateAsync(userId, car, a.Id, Update(name: "A", enabled: null));
        Assert.False(unchanged.IsEnabled);

        var back = await tasks.UpdateAsync(userId, car, a.Id, Update(name: "A", enabled: true));
        Assert.True(back.IsEnabled);
    }

    [Fact]
    public async Task Update_InvalidValue_ThrowsCode_AndChangesNothing()
    {
        var car = await CreateCarAsync();
        var task = await tasks.CreateAsync(userId, car, Custom());

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            tasks.UpdateAsync(userId, car, task.Id, Update(name: "New", km: null, days: null)));

        Assert.Equal("task.intervalRequired", ex.Code);
        Assert.Equal("Wash", db.MaintenanceTasks.Single().Name);
    }

    // --- Delete (criteria 8, 10) ---

    [Fact]
    public async Task Delete_RemovesTask_AndKeepsTemplate()
    {
        var car = await CreateCarAsync();
        var templateId = (await tasks.TemplatesAsync())[0].Id;
        var task = await tasks.CreateAsync(userId, car, Custom(templateId: templateId));

        await tasks.DeleteAsync(userId, car, task.Id);

        Assert.Empty(db.MaintenanceTasks);
        Assert.Equal(12, db.TaskTemplates.Count());
    }

    // --- Isolation (criterion 9) ---

    [Fact]
    public async Task OtherUsersCar_IsNotFound_OnEveryCall_AndNothingChanges()
    {
        var otherCar = await CreateCarAsync(owner: Guid.NewGuid());
        var mine = await CreateCarAsync();
        var myTask = await tasks.CreateAsync(userId, mine, Custom());

        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.ListAsync(userId, otherCar))).Code);
        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.CreateAsync(userId, otherCar, Custom()))).Code);
        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.UpdateAsync(userId, otherCar, myTask.Id, Update()))).Code);
        Assert.Equal("vehicle.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAsync(userId, otherCar, myTask.Id))).Code);
        Assert.Single(db.MaintenanceTasks);
    }

    [Fact]
    public async Task TaskFromAnotherCar_IsNotFound_OnUpdateAndDelete_AndNothingChanges()
    {
        var car1 = await CreateCarAsync();
        var car2 = await CreateCarAsync();
        var task = await tasks.CreateAsync(userId, car1, Custom());

        Assert.Equal("maintenanceTask.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.UpdateAsync(userId, car2, task.Id, Update(name: "X")))).Code);
        Assert.Equal("maintenanceTask.notFound", (await Assert.ThrowsAsync<NotFoundException>(() => tasks.DeleteAsync(userId, car2, task.Id))).Code);
        Assert.Equal("Wash", db.MaintenanceTasks.Single().Name);
        Assert.Empty(await tasks.ListAsync(userId, car2));
    }
}
