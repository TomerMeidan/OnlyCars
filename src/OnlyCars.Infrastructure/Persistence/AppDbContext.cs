using Microsoft.EntityFrameworkCore;
using Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure;
using OnlyCars.Application.Common;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence;

public class AppDbContext : DbContext, IAppDbContext
{
    // Private on purpose: Supabase serves its public schema over a REST API to anyone with the project's public key (DB-1).
    public const string Schema = "onlycars";

    // ICU's root locale, built into Postgres: the sort order doesn't depend on the server's locale.
    private const string DefaultCollation = "und-x-icu";

    /// <summary>Case-insensitive, for Email and Vin only: Postgres 17 has no LIKE on a non-deterministic collation, so never on a searched column.</summary>
    public const string CaseInsensitiveCollation = "und_ci";

    /// <summary>Goes with every UseNpgsql: the history table is a provider option, not part of the model.</summary>
    public static void NpgsqlOptions(NpgsqlDbContextOptionsBuilder options) => options.MigrationsHistoryTable("__EFMigrationsHistory", Schema);

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
    public DbSet<DeviceToken> DeviceTokens => Set<DeviceToken>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder) =>
        configurationBuilder.Properties<string>().UseCollation(DefaultCollation);

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);
        modelBuilder.HasCollation(Schema, CaseInsensitiveCollation, locale: "und-u-ks-level2", provider: "icu", deterministic: false);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
        base.OnModelCreating(modelBuilder);
    }
}
