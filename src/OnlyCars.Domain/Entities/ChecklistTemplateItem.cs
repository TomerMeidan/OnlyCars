using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One item of a checklist template. Unit, MinValue and MaxValue are set on Number items only.</summary>
public class ChecklistTemplateItem : Entity
{
    public const int MaxLabelLength = 100;
    public const int MaxUnitLength = 20;
    public const decimal MaxAbsValue = 1_000_000;

    public Guid TemplateId { get; set; }
    public ChecklistTemplate? Template { get; set; }

    public required string Label { get; set; }
    public ChecklistItemType Type { get; set; }
    public string? Unit { get; set; }
    public decimal? MinValue { get; set; }
    public decimal? MaxValue { get; set; }

    /// <summary>The user's order, 0-based.</summary>
    public int SortOrder { get; set; }
}
