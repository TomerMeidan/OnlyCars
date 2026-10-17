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
        // Every void and edit sets UpdatedAt, so whichever of two simultaneous voids/edits saves second matches no row (L34).
        builder.Property(r => r.UpdatedAt).IsConcurrencyToken();

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

public class ServiceItemConfiguration : IEntityTypeConfiguration<ServiceItem>
{
    public void Configure(EntityTypeBuilder<ServiceItem> builder)
    {
        builder.Property(i => i.Description).HasMaxLength(ServiceItem.MaxDescriptionLength);
        builder.Property(i => i.Brand).HasMaxLength(ServiceItem.MaxBrandLength);
        builder.Property(i => i.PartNumber).HasMaxLength(ServiceItem.MaxPartNumberLength);
        builder.Property(i => i.Quantity).HasColumnType("decimal(9,2)");
        builder.Property(i => i.UnitCost).HasColumnType("decimal(12,2)");

        builder.HasOne(i => i.ServiceRecord)
            .WithMany(r => r.Items)
            .HasForeignKey(i => i.ServiceRecordId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.ToTable(t =>
        {
            t.HasCheckConstraint("CK_ServiceItems_Quantity", "[Quantity] > 0");
            t.HasCheckConstraint("CK_ServiceItems_UnitCost", "[UnitCost] >= 0");
        });
    }
}

public class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.Property(a => a.FileUrl).HasMaxLength(300);
        builder.Property(a => a.FileName).HasMaxLength(Attachment.MaxFileNameLength);
        builder.Property(a => a.ContentType).HasMaxLength(100);

        builder.HasOne(a => a.ServiceRecord)
            .WithMany(r => r.Attachments)
            .HasForeignKey(a => a.ServiceRecordId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(a => a.ServiceRecordId);
    }
}
