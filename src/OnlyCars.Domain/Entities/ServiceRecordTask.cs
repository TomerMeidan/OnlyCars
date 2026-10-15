using OnlyCars.Domain.Common;

namespace OnlyCars.Domain.Entities;

/// <summary>Links a record to a task it reset. PreviousLastDone* is the task's value before the reset, restored on undo.</summary>
public class ServiceRecordTask : Entity
{
    public Guid ServiceRecordId { get; set; }
    public ServiceRecord? ServiceRecord { get; set; }

    public Guid MaintenanceTaskId { get; set; }
    public MaintenanceTask? MaintenanceTask { get; set; }

    public decimal PreviousLastDoneOdometerKm { get; set; }
    public DateOnly PreviousLastDoneDate { get; set; }
}
