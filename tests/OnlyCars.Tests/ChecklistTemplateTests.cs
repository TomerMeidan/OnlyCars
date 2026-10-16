using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>MVP5-A: checklist templates and items. Criterion numbers refer to the ticket.</summary>
public class ChecklistTemplateTests
{
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly ChecklistTemplateService service;
    private readonly Guid userId = Guid.NewGuid();

    public ChecklistTemplateTests() => service = new ChecklistTemplateService(db);

    private static ChecklistTemplateItemRequest Check(string label = "Lights", Guid? id = null) => new(id, label, "Check", null, null, null);
    private static ChecklistTemplateItemRequest Number(string label = "Tire pressure", string? unit = "bar", decimal? min = 2.0m, decimal? max = 2.6m, Guid? id = null) =>
        new(id, label, "Number", unit, min, max);
    private static ChecklistTemplateItemRequest Text(string label = "Notes", Guid? id = null) => new(id, label, "Text", null, null, null);

    private Task<ChecklistTemplateDto> CreateAsync(string name = "Monthly quick check", Guid? owner = null, params ChecklistTemplateItemRequest[] items) =>
        service.CreateAsync(owner ?? userId, new ChecklistTemplateRequest(name, [.. items]));

    private Task<ChecklistTemplateDto> UpdateAsync(Guid id, string name, params ChecklistTemplateItemRequest[] items) =>
        service.UpdateAsync(userId, id, new ChecklistTemplateRequest(name, [.. items]));

    private static async Task<string> CodeAsync(Func<Task> act) => (await Assert.ThrowsAnyAsync<AppException>(act)).Code;

    // --- Criterion 1: CRUD ---

    [Fact]
    public async Task Create_TrimsAndStoresItemsInOrder_AndGetAndListReturnThem()
    {
        var created = await CreateAsync("  Monthly quick check ", null, Check(" Lights "), Number(unit: "  bar "), Text());

        Assert.Equal("Monthly quick check", created.Name);
        Assert.Equal(3, created.ItemCount);
        Assert.Equal(["Lights", "Tire pressure", "Notes"], created.Items.Select(i => i.Label));
        Assert.Equal([ChecklistItemType.Check, ChecklistItemType.Number, ChecklistItemType.Text], created.Items.Select(i => i.Type));
        Assert.Equal(("bar", 2.0m, 2.6m), (created.Items[1].Unit, created.Items[1].MinValue, created.Items[1].MaxValue));

        db.ChangeTracker.Clear();
        var fetched = await service.GetAsync(userId, created.Id);
        Assert.Equal(created.Items, fetched.Items);
        var listed = Assert.Single(await service.ListAsync(userId));
        Assert.Equal(created.Items, listed.Items);
    }

    [Fact]
    public async Task Create_WithNoItems_IsAllowed_AndNullItemsIsEmpty()
    {
        Assert.Empty((await service.CreateAsync(userId, new ChecklistTemplateRequest("Empty", null))).Items);
    }

    [Fact]
    public async Task List_IsOnlyTheCallersTemplates_ByNameThenCreationTime()
    {
        var b = await CreateAsync("B");
        var a1 = await CreateAsync("A");
        var a2 = await CreateAsync("A");
        await CreateAsync("Other's", Guid.NewGuid());

        Assert.Equal([a1.Id, a2.Id, b.Id], (await service.ListAsync(userId)).Select(t => t.Id));
    }

    [Fact]
    public async Task Delete_RemovesTheTemplateAndCascadesItsItems()
    {
        var kept = await CreateAsync("Kept", null, Check());
        var gone = await CreateAsync("Gone", null, Check(), Text());

        await service.DeleteAsync(userId, gone.Id);

        db.ChangeTracker.Clear();
        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => service.GetAsync(userId, gone.Id)));
        Assert.Equal(kept.Items.Single().Id, (await db.ChecklistTemplateItems.SingleAsync()).Id);
    }

    // --- Criterion 1: ownership ---

    [Fact]
    public async Task AnotherUsersTemplate_IsNotFound_OnEveryEndpoint_AndIsUnchanged()
    {
        var other = Guid.NewGuid();
        var theirs = await CreateAsync("Theirs", other, Check());

        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => service.GetAsync(userId, theirs.Id)));
        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => UpdateAsync(theirs.Id, "Mine now")));
        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => service.DeleteAsync(userId, theirs.Id)));
        Assert.Empty(await service.ListAsync(userId));

        db.ChangeTracker.Clear();
        var stored = await service.GetAsync(other, theirs.Id);
        Assert.Equal(("Theirs", 1), (stored.Name, stored.ItemCount));
    }

    [Fact]
    public async Task UnknownTemplate_IsNotFound()
    {
        Assert.Equal("checklistTemplate.notFound", await CodeAsync(() => service.GetAsync(userId, Guid.NewGuid())));
    }

    // --- Criterion 2: in-place update ---

    [Fact]
    public async Task Update_KeepsIds_Reorders_RenamesAndRetypes_AddsNew_AndDeletesMissing()
    {
        var created = await CreateAsync("Monthly", null, Check("A"), Number("B"), Text("C"));
        var (a, b, c) = (created.Items[0].Id, created.Items[1].Id, created.Items[2].Id);

        var updated = await UpdateAsync(created.Id, "Monthly v2",
            Text("C renamed", c), Check("New"), new ChecklistTemplateItemRequest(a, "A", "Number", "psi", 30, 35));

        Assert.Equal("Monthly v2", updated.Name);
        Assert.Equal(["C renamed", "New", "A"], updated.Items.Select(i => i.Label));
        Assert.Equal(c, updated.Items[0].Id);
        Assert.DoesNotContain(updated.Items[1].Id, new[] { a, b, c });
        Assert.Equal((a, ChecklistItemType.Number, "psi", 30m, 35m),
            (updated.Items[2].Id, updated.Items[2].Type, updated.Items[2].Unit, updated.Items[2].MinValue, updated.Items[2].MaxValue));

        db.ChangeTracker.Clear();
        Assert.Equal(updated.Items, (await service.GetAsync(userId, created.Id)).Items);
        Assert.False(await db.ChecklistTemplateItems.AnyAsync(i => i.Id == b));
        Assert.Equal([0, 1, 2], await db.ChecklistTemplateItems.OrderBy(i => i.SortOrder).Select(i => i.SortOrder).ToListAsync());
    }

    [Fact]
    public async Task Update_NumberToCheck_ClearsUnitAndRange()
    {
        var created = await CreateAsync("T", null, Number());

        var updated = await UpdateAsync(created.Id, "T", Check("Tire pressure", created.Items[0].Id));

        Assert.Equal((ChecklistItemType.Check, (string?)null, (decimal?)null, (decimal?)null),
            (updated.Items[0].Type, updated.Items[0].Unit, updated.Items[0].MinValue, updated.Items[0].MaxValue));
    }

    [Fact]
    public async Task Update_WithAnotherTemplatesItemId_Is400_AndChangesNothing()
    {
        var mine = await CreateAsync("Mine", null, Check("Keep"));
        var other = await CreateAsync("Other", null, Check("Foreign"));

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            UpdateAsync(mine.Id, "Renamed", Text("New"), Check("Stolen", other.Items[0].Id)));

        Assert.Equal("checklistItem.invalidId", ex.Code);
        Assert.Equal(1, ex.Extensions["index"]);
        db.ChangeTracker.Clear();
        var stored = await service.GetAsync(userId, mine.Id);
        Assert.Equal("Mine", stored.Name);
        Assert.Equal(mine.Items, stored.Items);
        Assert.Equal(other.Items, (await service.GetAsync(userId, other.Id)).Items);
    }

    [Fact]
    public async Task Update_WithTheSameItemIdTwice_Is400()
    {
        var created = await CreateAsync("T", null, Check());
        var id = created.Items[0].Id;

        Assert.Equal("checklistItem.invalidId", await CodeAsync(() => UpdateAsync(created.Id, "T", Check("1", id), Check("2", id))));
    }

    [Fact]
    public async Task Create_WithAnItemId_Is400()
    {
        Assert.Equal("checklistItem.invalidId", await CodeAsync(() => CreateAsync("T", null, Check(id: Guid.NewGuid()))));
    }

    // --- Criterion 1: validation at the boundaries ---

    [Fact]
    public async Task Name_MustBe1To100AfterTrim()
    {
        await CreateAsync(new string('n', 100));
        Assert.Equal("checklistTemplate.invalidName", await CodeAsync(() => CreateAsync(new string('n', 101))));
        Assert.Equal("checklistTemplate.invalidName", await CodeAsync(() => CreateAsync("   ")));
        Assert.Equal("checklistTemplate.invalidName", await CodeAsync(() => service.CreateAsync(userId, new ChecklistTemplateRequest(null, null))));

        var created = await CreateAsync("T");
        Assert.Equal("checklistTemplate.invalidName", await CodeAsync(() => UpdateAsync(created.Id, "")));
    }

    [Fact]
    public async Task AtMost100TemplatesPerUser_OtherUsersDontCount()
    {
        for (var i = 0; i < 99; i++)
        {
            db.ChecklistTemplates.Add(new ChecklistTemplate { UserId = userId, Name = $"T{i}" });
        }

        await db.SaveChangesAsync();
        await CreateAsync("100th");

        Assert.Equal("checklistTemplate.tooMany", await CodeAsync(() => CreateAsync("101st")));
        await CreateAsync("Other user's", Guid.NewGuid());
    }

    [Fact]
    public async Task AtMost50Items()
    {
        var fifty = Enumerable.Range(0, 50).Select(i => Check($"I{i}")).ToArray();
        var created = await CreateAsync("T", null, fifty);
        Assert.Equal(50, created.ItemCount);

        Assert.Equal("checklistTemplate.tooManyItems", await CodeAsync(() => CreateAsync("T", null, [.. fifty, Check()])));
        Assert.Equal("checklistTemplate.tooManyItems", await CodeAsync(() => UpdateAsync(created.Id, "T", [.. fifty, Check()])));
    }

    [Fact]
    public async Task Label_MustBe1To100AfterTrim_AndTheErrorNamesTheRow()
    {
        await CreateAsync("T", null, Check(new string('l', 100)));

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => CreateAsync("T", null, Check(), Check(new string('l', 101))));
        Assert.Equal(("checklistItem.invalidLabel", (object?)1), (ex.Code, ex.Extensions["index"]));
        Assert.Equal("checklistItem.invalidLabel", await CodeAsync(() => CreateAsync("T", null, Check("  "))));
        Assert.Equal("checklistItem.invalidLabel", await CodeAsync(() => CreateAsync("T", null, new ChecklistTemplateItemRequest(null, null, "Check", null, null, null))));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("check")]
    [InlineData("1")]
    [InlineData("Photo")]
    public async Task Type_MustBeCheckNumberOrText(string? type)
    {
        Assert.Equal("checklistItem.invalidType",
            await CodeAsync(() => CreateAsync("T", null, new ChecklistTemplateItemRequest(null, "L", type, null, null, null))));
    }

    [Fact]
    public async Task Unit_UpTo20AfterTrim_EmptyBecomesNull()
    {
        var created = await CreateAsync("T", null, Number(unit: new string('u', 20)), Number(unit: "   "));
        Assert.Equal([new string('u', 20), null], created.Items.Select(i => i.Unit));

        Assert.Equal("checklistItem.invalidUnit", await CodeAsync(() => CreateAsync("T", null, Number(unit: new string('u', 21)))));
    }

    [Theory]
    [InlineData(-1_000_000.0, 1_000_000.0, true)]
    [InlineData(2.6, 2.6, true)]
    [InlineData(null, 5.0, true)]
    [InlineData(5.0, null, true)]
    [InlineData(-1_000_000.01, null, false)]
    [InlineData(null, 1_000_000.01, false)]
    [InlineData(1.005, null, false)]
    [InlineData(null, 0.001, false)]
    [InlineData(2.61, 2.6, false)]
    public async Task Range_EachWithinAMillion_2Decimals_MinNotAboveMax(double? min, double? max, bool ok)
    {
        var request = Number(min: (decimal?)min, max: (decimal?)max);
        if (ok)
        {
            var item = (await CreateAsync("T", null, request)).Items[0];
            Assert.Equal(((decimal?)min, (decimal?)max), (item.MinValue, item.MaxValue));
        }
        else
        {
            Assert.Equal("checklistItem.invalidRange", await CodeAsync(() => CreateAsync("T", null, request)));
        }
    }

    [Theory]
    [InlineData("Check", "bar", null, null)]
    [InlineData("Text", null, 1.0, null)]
    [InlineData("Check", null, null, 1.0)]
    public async Task UnitMinMax_OnACheckOrTextItem_Is400(string type, string? unit, double? min, double? max)
    {
        Assert.Equal("checklistItem.numberOnly", await CodeAsync(() =>
            CreateAsync("T", null, new ChecklistTemplateItemRequest(null, "L", type, unit, (decimal?)min, (decimal?)max))));
    }

    [Fact]
    public async Task WhitespaceOnlyUnit_OnACheckItem_IsNoUnit()
    {
        var created = await CreateAsync("T", null, new ChecklistTemplateItemRequest(null, "L", "Check", "   ", null, null));

        Assert.Null(Assert.Single(created.Items).Unit);
    }

    [Fact]
    public async Task FailedValidation_OnUpdate_ChangesNothing()
    {
        var created = await CreateAsync("T", null, Check("A"), Text("B"));

        Assert.Equal("checklistItem.invalidRange", await CodeAsync(() =>
            UpdateAsync(created.Id, "Renamed", Check("A", created.Items[0].Id), Number(min: 3, max: 2))));

        db.ChangeTracker.Clear();
        var stored = await service.GetAsync(userId, created.Id);
        Assert.Equal("T", stored.Name);
        Assert.Equal(created.Items, stored.Items);
    }
}
