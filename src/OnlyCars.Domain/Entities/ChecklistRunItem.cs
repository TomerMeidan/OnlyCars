using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>One answered item of a run. Label, type, unit, min and max are snapshots, so the run stays readable after template edits.</summary>
public class ChecklistRunItem : Entity
{
    public const int MaxTextLength = 500;

    public Guid RunId { get; set; }
    public ChecklistRun? Run { get; set; }

    /// <summary>Cleared when the template item is deleted.</summary>
    public Guid? TemplateItemId { get; set; }
    public ChecklistTemplateItem? TemplateItem { get; set; }

    public required string LabelSnapshot { get; set; }
    public ChecklistItemType Type { get; set; }
    public string? Unit { get; set; }
    public decimal? MinValue { get; set; }
    public decimal? MaxValue { get; set; }

    /// <summary>The template order at run time, 0-based.</summary>
    public int SortOrder { get; set; }

    public bool? BoolValue { get; set; }
    public decimal? NumberValue { get; set; }
    public string? TextValue { get; set; }
    public bool IsFlagged { get; set; }
}
