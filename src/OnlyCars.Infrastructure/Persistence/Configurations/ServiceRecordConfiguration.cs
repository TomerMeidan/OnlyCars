using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class ServiceRecordConfiguration : IEntityTypeConfiguration<ServiceRecord>
{
    public void Configure(EntityTypeBuilder<ServiceRecord> builder)
    {
        builder.Property(r => r.OdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(r => r.TotalCost).HasColumnType("decimal(12,2)");
        builder.Property(r => r.ShopName).HasMaxLength(ServiceRecord.MaxShopNameLength);
        builder.Property(r => r.Notes).HasMaxLength(ServiceRecord.MaxNotesLength);

        builder.HasOne(r => r.Vehicle)
            .WithMany()
            .HasForeignKey(r => r.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        // Index ServiceRecord(VehicleId, Date DESC)
        builder.HasIndex(r => new { r.VehicleId, r.Date })
            .IsDescending(false, true);
    }
}

public class ServiceRecordTaskConfiguration : IEntityTypeConfiguration<ServiceRecordTask>
{
    public void Configure(EntityTypeBuilder<ServiceRecordTask> builder)
    {
        builder.Property(j => j.PreviousLastDoneOdometerKm).HasColumnType("decimal(12,2)");

        builder.HasOne(j => j.ServiceRecord)
            .WithMany(r => r.Tasks)
            .HasForeignKey(j => j.ServiceRecordId)
            .OnDelete(DeleteBehavior.Cascade);

        // Vehicle already cascades to tasks and records, so only one path here may cascade (SQL Server):
        // MaintenanceTaskService.DeleteAsync removes the join rows itself.
        builder.HasOne(j => j.MaintenanceTask)
            .WithMany()
            .HasForeignKey(j => j.MaintenanceTaskId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasIndex(j => new { j.ServiceRecordId, j.MaintenanceTaskId }).IsUnique();
        builder.HasIndex(j => j.MaintenanceTaskId);
    }
}
