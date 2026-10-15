using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A user's named inspection checklist (MVP5-A).</summary>
public class ChecklistTemplate : Entity
{
    public const int MaxNameLength = 100;
    public const int MaxTemplatesPerUser = 100;
    public const int MaxItems = 50;

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public required string Name { get; set; }

    public List<ChecklistTemplateItem> Items { get; set; } = [];
}
