using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class OdometerReadingConfiguration : IEntityTypeConfiguration<OdometerReading>
{
    public void Configure(EntityTypeBuilder<OdometerReading> builder)
    {
        builder.Property(o => o.ValueKm).HasColumnType("decimal(12,2)");

        builder.HasOne(o => o.Vehicle)
            .WithMany(v => v.OdometerReadings)
            .HasForeignKey(o => o.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        // Vehicle already cascades to readings and records, so this path can't (SQL Server); records are never hard-deleted.
        builder.HasOne(o => o.ServiceRecord)
            .WithMany()
            .HasForeignKey(o => o.ServiceRecordId)
            .OnDelete(DeleteBehavior.NoAction);

        // Index OdometerReading(VehicleId, ReadingDate DESC)
        builder.HasIndex(o => new { o.VehicleId, o.ReadingDate })
            .IsDescending(false, true);

        // One reading per client request id and car (OFF-1); readings without an id are not limited.
        builder.HasIndex(o => new { o.VehicleId, o.ClientRequestId })
            .IsUnique()
            .HasFilter("[ClientRequestId] IS NOT NULL");
    }
}
