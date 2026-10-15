using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>A part or labour line of a service record. On a labour row Quantity is hours.</summary>
public class ServiceItem : Entity
{
    public const int MaxDescriptionLength = 100;
    public const int MaxBrandLength = 100;
    public const int MaxPartNumberLength = 50;
    public const decimal MaxQuantity = 10_000;
    public const int MaxItemsPerRecord = 50;

    public Guid ServiceRecordId { get; set; }
    public ServiceRecord? ServiceRecord { get; set; }

    public string Description { get; set; } = string.Empty;
    public string? Brand { get; set; }
    public string? PartNumber { get; set; }
    public decimal Quantity { get; set; }
    public decimal UnitCost { get; set; }
    public bool IsLabor { get; set; }

    /// <summary>The user's order, 0-based.</summary>
    public int SortOrder { get; set; }
}
