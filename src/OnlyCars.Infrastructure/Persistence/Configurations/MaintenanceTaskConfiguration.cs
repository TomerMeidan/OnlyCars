using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class MaintenanceTaskConfiguration : IEntityTypeConfiguration<MaintenanceTask>
{
    public void Configure(EntityTypeBuilder<MaintenanceTask> builder)
    {
        builder.Property(t => t.Name).IsRequired().HasMaxLength(MaintenanceTask.MaxNameLength);
        builder.Property(t => t.LastDoneOdometerKm).HasColumnType("decimal(12,2)");

        builder.HasOne(t => t.Vehicle)
            .WithMany(v => v.MaintenanceTasks)
            .HasForeignKey(t => t.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        // Deleting a task never touches its template; templates are never deleted.
        builder.HasOne(t => t.Template)
            .WithMany()
            .HasForeignKey(t => t.TemplateId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(t => new { t.VehicleId, t.IsEnabled });

        builder.ToTable(t => t.HasCheckConstraint("CK_MaintenanceTasks_Interval",
            "\"IntervalKm\" IS NOT NULL OR \"IntervalDays\" IS NOT NULL"));
    }
}
