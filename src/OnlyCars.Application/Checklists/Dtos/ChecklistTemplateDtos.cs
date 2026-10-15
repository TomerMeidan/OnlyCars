using OnlyCars.Domain;

namespace OnlyCars.Application.Checklists.Dtos;

// Items are in SortOrder; ItemCount is Items.Count.
public record ChecklistTemplateDto(Guid Id, string Name, int ItemCount, List<ChecklistTemplateItemDto> Items);

public record ChecklistTemplateItemDto(Guid Id, string Label, ChecklistItemType Type, string? Unit, decimal? MinValue, decimal? MaxValue);

// POST and PUT. Items replaces the whole list in array order (null is an empty list).
public record ChecklistTemplateRequest(string? Name, List<ChecklistTemplateItemRequest>? Items);

// Id (PUT only) keeps an existing item of this template; Type is a string so an unknown value gets a coded error.
public record ChecklistTemplateItemRequest(Guid? Id, string? Label, string? Type, string? Unit, decimal? MinValue, decimal? MaxValue);
