using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Checklists;

public class ChecklistTemplateService(IAppDbContext db)
{
    public async Task<List<ChecklistTemplateDto>> ListAsync(Guid userId, CancellationToken ct = default)
    {
        var templates = await db.ChecklistTemplates
            .Where(t => t.UserId == userId)
            .Include(t => t.Items)
            .OrderBy(t => t.Name).ThenBy(t => t.CreatedAt)
            .ToListAsync(ct);
        return templates.Select(ToDto).ToList();
    }

    public async Task<ChecklistTemplateDto> GetAsync(Guid userId, Guid id, CancellationToken ct = default) =>
        ToDto(await FindOwnedAsync(userId, id, ct));

    public async Task<ChecklistTemplateDto> CreateAsync(Guid userId, ChecklistTemplateRequest request, CancellationToken ct = default)
    {
        var name = ValidateName(request.Name);
        var items = ValidateItems(request.Items);
        // A new template has no items yet, so any id is foreign.
        if (items.FirstOrDefault(i => i.Request.Id is not null) is { } withId)
        {
            throw ItemError("checklistItem.invalidId", "The item doesn't belong to this checklist.", withId.Index);
        }

        if (await db.ChecklistTemplates.CountAsync(t => t.UserId == userId, ct) >= ChecklistTemplate.MaxTemplatesPerUser)
        {
            throw new ValidationFailedException("checklistTemplate.tooMany",
                $"You can have up to {ChecklistTemplate.MaxTemplatesPerUser} checklists.");
        }

        var template = new ChecklistTemplate { UserId = userId, Name = name };
        template.Items.AddRange(items.Select(i => Apply(new ChecklistTemplateItem { Label = "" }, i)));

        db.ChecklistTemplates.Add(template);
        await db.SaveChangesAsync(ct);
        return ToDto(template);
    }

    public async Task<ChecklistTemplateDto> UpdateAsync(Guid userId, Guid id, ChecklistTemplateRequest request, CancellationToken ct = default)
    {
        var template = await FindOwnedAsync(userId, id, ct);
        var name = ValidateName(request.Name);
        var items = ValidateItems(request.Items);

        // Resolve every id before changing anything, so a foreign or repeated id saves nothing.
        var existing = template.Items.ToDictionary(i => i.Id);
        var kept = new HashSet<Guid>();
        foreach (var item in items)
        {
            if (item.Request.Id is { } itemId && (!existing.ContainsKey(itemId) || !kept.Add(itemId)))
            {
                throw ItemError("checklistItem.invalidId", "The item doesn't belong to this checklist.", item.Index);
            }
        }

        var now = DateTimeOffset.UtcNow;
        template.Name = name;
        template.UpdatedAt = now;

        var removed = template.Items.Where(i => !kept.Contains(i.Id)).ToList();
        // The run item link doesn't cascade (SQL Server's one-path rule): clear it here; runs keep their snapshot.
        var removedIds = removed.Select(i => i.Id).ToList();
        foreach (var runItem in await db.ChecklistRunItems.Where(r => r.TemplateItemId != null && removedIds.Contains(r.TemplateItemId.Value)).ToListAsync(ct))
        {
            runItem.TemplateItemId = null;
            runItem.UpdatedAt = now;
        }
        db.ChecklistTemplateItems.RemoveRange(removed);
        removed.ForEach(i => template.Items.Remove(i));

        foreach (var item in items)
        {
            if (item.Request.Id is { } itemId)
            {
                Apply(existing[itemId], item).UpdatedAt = now;
                continue;
            }

            // Added through the DbSet (fix-up puts it in template.Items): a client-generated Guid found only via the
            // navigation would be taken as an existing row.
            db.ChecklistTemplateItems.Add(Apply(new ChecklistTemplateItem { Label = "", TemplateId = template.Id }, item));
        }

        await db.SaveChangesAsync(ct);
        return ToDto(template);
    }

    public async Task DeleteAsync(Guid userId, Guid id, CancellationToken ct = default)
    {
        var template = await FindOwnedAsync(userId, id, ct);
        // Also keeps runs safe: runs only exist under an attachment, and an attachment with runs can't be removed.
        if (await db.VehicleChecklists.AnyAsync(c => c.TemplateId == template.Id, ct))
        {
            throw new ConflictException("checklistTemplate.inUse", "This checklist is attached to a car. Remove it from the car first.");
        }

        db.ChecklistTemplates.Remove(template); // items cascade
        await db.SaveChangesAsync(ct);
    }

    // Scoped to the caller, so another user's template is simply not found.
    private async Task<ChecklistTemplate> FindOwnedAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.ChecklistTemplates.Include(t => t.Items).FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId, ct)
        ?? throw new NotFoundException(nameof(ChecklistTemplate), id);

    private static string ValidateName(string? name)
    {
        var trimmed = name?.Trim() ?? "";
        if (trimmed.Length is 0 or > ChecklistTemplate.MaxNameLength)
        {
            throw new ValidationFailedException("checklistTemplate.invalidName",
                $"The name must be 1 to {ChecklistTemplate.MaxNameLength} characters.");
        }

        return trimmed;
    }

    private sealed record ValidItem(int Index, ChecklistTemplateItemRequest Request, string Label, ChecklistItemType Type, string? Unit);

    /// <summary>Checks every item in order; each item error names its 0-based row in an <c>index</c> extension.</summary>
    private static List<ValidItem> ValidateItems(List<ChecklistTemplateItemRequest>? requests)
    {
        requests ??= [];
        if (requests.Count > ChecklistTemplate.MaxItems)
        {
            throw new ValidationFailedException("checklistTemplate.tooManyItems",
                $"A checklist can have up to {ChecklistTemplate.MaxItems} items.");
        }

        return requests.Select(ValidateItem).ToList();
    }

    private static ValidItem ValidateItem(ChecklistTemplateItemRequest? request, int index)
    {
        var label = request?.Label?.Trim() ?? "";
        if (request is null || label.Length is 0 or > ChecklistTemplateItem.MaxLabelLength)
        {
            throw ItemError("checklistItem.invalidLabel", $"The label must be 1 to {ChecklistTemplateItem.MaxLabelLength} characters.", index);
        }

        // Exact enum names only: Enum.TryParse would also accept numbers like "1".
        if (request.Type is null || !Enum.GetNames<ChecklistItemType>().Contains(request.Type))
        {
            throw ItemError("checklistItem.invalidType", "The type must be Check, Number or Text.", index);
        }

        var type = Enum.Parse<ChecklistItemType>(request.Type);
        var unit = request.Unit?.Trim() is { Length: > 0 } u ? u : null;
        if (type != ChecklistItemType.Number)
        {
            if (unit is not null || request.MinValue is not null || request.MaxValue is not null)
            {
                throw ItemError("checklistItem.numberOnly", "Unit, min and max apply to Number items only.", index);
            }

            return new ValidItem(index, request, label, type, null);
        }

        if (unit?.Length > ChecklistTemplateItem.MaxUnitLength)
        {
            throw ItemError("checklistItem.invalidUnit", $"The unit can be up to {ChecklistTemplateItem.MaxUnitLength} characters.", index);
        }

        if (!InRange(request.MinValue) || !InRange(request.MaxValue) || request.MinValue > request.MaxValue)
        {
            throw ItemError("checklistItem.invalidRange",
                $"Min and max must be -{ChecklistTemplateItem.MaxAbsValue} to {ChecklistTemplateItem.MaxAbsValue} with at most 2 decimals, and min not above max.", index);
        }

        return new ValidItem(index, request, label, type, unit);
    }

    private static bool InRange(decimal? value) =>
        value is not { } v || Math.Abs(v) <= ChecklistTemplateItem.MaxAbsValue && decimal.Round(v, 2) == v;

    private static ChecklistTemplateItem Apply(ChecklistTemplateItem item, ValidItem valid)
    {
        item.Label = valid.Label;
        item.Type = valid.Type;
        item.Unit = valid.Unit;
        item.MinValue = valid.Request.MinValue;
        item.MaxValue = valid.Request.MaxValue;
        item.SortOrder = valid.Index;
        return item;
    }

    internal static ValidationFailedException ItemError(string code, string message, int index)
    {
        var ex = new ValidationFailedException(code, $"Item {index + 1}: {message}");
        ex.Extensions["index"] = index;
        return ex;
    }

    private static ChecklistTemplateDto ToDto(ChecklistTemplate t) => new(t.Id, t.Name, t.Items.Count,
        t.Items.OrderBy(i => i.SortOrder)
            .Select(i => new ChecklistTemplateItemDto(i.Id, i.Label, i.Type, i.Unit, i.MinValue, i.MaxValue)).ToList());
}
