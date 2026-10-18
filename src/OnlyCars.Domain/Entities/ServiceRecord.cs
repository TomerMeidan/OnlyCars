using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

public class ServiceRecord : Entity
{
    public const int MaxShopNameLength = 100;
    public const int MaxNotesLength = 1_000;
    public const decimal MaxCost = 1_000_000;
    public const int MaxPerVehicle = 2_000;

    public Guid VehicleId { get; set; }
    public Vehicle? Vehicle { get; set; }

    public DateOnly Date { get; set; }
    public decimal OdometerKm { get; set; }

    /// <summary>Null means DIY.</summary>
    public string? ShopName { get; set; }

    /// <summary>Null when the user skipped the cost.</summary>
    public decimal? TotalCost { get; set; }
    public string? Notes { get; set; }
    public bool IsVoided { get; set; }

    public ICollection<ServiceRecordTask> Tasks { get; set; } = new List<ServiceRecordTask>();
    public ICollection<ServiceItem> Items { get; set; } = new List<ServiceItem>();
    public ICollection<Attachment> Attachments { get; set; } = new List<Attachment>();
}
