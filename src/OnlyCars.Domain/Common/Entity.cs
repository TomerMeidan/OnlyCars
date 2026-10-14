namespace OnlyCars.Domain.Common;

/// <summary>Base class for every entity: Id, CreatedAt, UpdatedAt as specified in the data model.</summary>
public abstract class Entity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
