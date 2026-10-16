using Microsoft.EntityFrameworkCore;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Common;

/// <summary>
/// Abstraction over the EF Core DbContext so Application can query/persist
/// without taking a dependency on Infrastructure (which owns the SQL Server provider).
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
    DbSet<ChecklistTemplate> ChecklistTemplates { get; }
    DbSet<ChecklistTemplateItem> ChecklistTemplateItems { get; }
    DbSet<VehicleChecklist> VehicleChecklists { get; }
    DbSet<ChecklistRun> ChecklistRuns { get; }
    DbSet<ChecklistRunItem> ChecklistRunItems { get; }

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
