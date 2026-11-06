using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>Global, read-only starter task. <see cref="Key"/> is stable; the client translates the name by it.</summary>
public class TaskTemplate : Entity
{
    public required string Key { get; set; }
    public required string Name { get; set; }

    /// <summary>Hebrew name, only for search; must match the client's Hebrew templates.* text in i18n.ts.</summary>
    public required string NameHe { get; set; }
    public TaskCategory Category { get; set; }
    public int? DefaultIntervalKm { get; set; }
    public int? DefaultIntervalDays { get; set; }
}
