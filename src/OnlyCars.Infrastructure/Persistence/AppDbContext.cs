using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence;

public class AppDbContext : DbContext, IAppDbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<Vehicle> Vehicles => Set<Vehicle>();
    public DbSet<OdometerReading> OdometerReadings => Set<OdometerReading>();
    public DbSet<TaskTemplate> TaskTemplates => Set<TaskTemplate>();
    public DbSet<MaintenanceTask> MaintenanceTasks => Set<MaintenanceTask>();
    public DbSet<ServiceRecord> ServiceRecords => Set<ServiceRecord>();
    public DbSet<ServiceRecordTask> ServiceRecordTasks => Set<ServiceRecordTask>();
    public DbSet<ServiceItem> ServiceItems => Set<ServiceItem>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<ChecklistTemplate> ChecklistTemplates => Set<ChecklistTemplate>();
    public DbSet<ChecklistTemplateItem> ChecklistTemplateItems => Set<ChecklistTemplateItem>();
    public DbSet<VehicleChecklist> VehicleChecklists => Set<VehicleChecklist>();
    public DbSet<ChecklistRun> ChecklistRuns => Set<ChecklistRun>();
    public DbSet<ChecklistRunItem> ChecklistRunItems => Set<ChecklistRunItem>();
    public DbSet<Issue> Issues => Set<Issue>();
    public DbSet<Tire> Tires => Set<Tire>();
    public DbSet<TireMeasurement> TireMeasurements => Set<TireMeasurement>();
    public DbSet<TireRotation> TireRotations => Set<TireRotation>();
    public DbSet<TireRotationMove> TireRotationMoves => Set<TireRotationMove>();
    public DbSet<VehicleDocument> VehicleDocuments => Set<VehicleDocument>();
    public DbSet<NotificationRule> NotificationRules => Set<NotificationRule>();
    public DbSet<Notification> Notifications => Set<Notification>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        base.OnModelCreating(modelBuilder);
    }
}
