using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Common;

/// <summary>
/// Abstraction over the EF Core DbContext so Application can query/persist
/// without taking a dependency on Infrastructure (which owns the Postgres provider).
/// </summary>
public interface IAppDbContext
{
    DbSet<User> Users { get; }
    DbSet<Vehicle> Vehicles { get; }
    DbSet<OdometerReading> OdometerReadings { get; }
    DbSet<TaskTemplate> TaskTemplates { get; }
    DbSet<MaintenanceTask> MaintenanceTasks { get; }
    DbSet<ServiceRecord> ServiceRecords { get; }
    DbSet<ServiceRecordTask> ServiceRecordTasks { get; }
    DbSet<ServiceItem> ServiceItems { get; }
    DbSet<Attachment> Attachments { get; }
    DbSet<ChecklistTemplate> ChecklistTemplates { get; }
    DbSet<ChecklistTemplateItem> ChecklistTemplateItems { get; }
    DbSet<VehicleChecklist> VehicleChecklists { get; }
    DbSet<ChecklistRun> ChecklistRuns { get; }
    DbSet<ChecklistRunItem> ChecklistRunItems { get; }
    DbSet<Issue> Issues { get; }
    DbSet<Tire> Tires { get; }
    DbSet<TireMeasurement> TireMeasurements { get; }
    DbSet<TireRotation> TireRotations { get; }
    DbSet<TireRotationMove> TireRotationMoves { get; }
    DbSet<VehicleDocument> VehicleDocuments { get; }
    DbSet<NotificationRule> NotificationRules { get; }
    DbSet<Notification> Notifications { get; }
    DbSet<DeviceToken> DeviceTokens { get; }

    DatabaseFacade Database { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
