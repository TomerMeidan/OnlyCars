using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class TireConfiguration : IEntityTypeConfiguration<Tire>
{
    public void Configure(EntityTypeBuilder<Tire> builder)
    {
        builder.Property(t => t.Brand).IsRequired().HasMaxLength(Tire.MaxBrandLength);
        builder.Property(t => t.Model).HasMaxLength(Tire.MaxModelLength);
        builder.Property(t => t.Size).HasMaxLength(Tire.MaxSizeLength);
        builder.Property(t => t.DotCode).HasMaxLength(Tire.MaxDotCodeLength);
        builder.Property(t => t.Notes).HasMaxLength(Tire.MaxNotesLength);
        builder.Property(t => t.FittedOdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(t => t.RemovedOdometerKm).HasColumnType("decimal(12,2)");
        // Every change sets UpdatedAt, so a replace or rotation racing another on the same tire matches no row (409).
        builder.Property(t => t.UpdatedAt).IsConcurrencyToken();

        builder.HasOne(t => t.Vehicle)
            .WithMany()
            .HasForeignKey(t => t.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        // The car already cascades to its records, so this path can't (SQL Server): MaintenanceTaskService.VoidAsync nulls it in code.
        builder.HasOne(t => t.ServiceRecord)
            .WithMany(r => r.Tires)
            .HasForeignKey(t => t.ServiceRecordId)
            .OnDelete(DeleteBehavior.NoAction);

        // At most one tire on the car per wheel.
        builder.HasIndex(t => new { t.VehicleId, t.Position }).IsUnique().HasFilter("\"RemovedAt\" IS NULL")
            .HasDatabaseName("IX_Tires_VehicleId_Position_OnCar");
        builder.ToTable(t => t.HasCheckConstraint("CK_Tires_Removal",
            "(\"RemovedAt\" IS NULL AND \"RemovedOdometerKm\" IS NULL) OR (\"RemovedAt\" >= \"FittedAt\" AND \"RemovedOdometerKm\" >= \"FittedOdometerKm\")"));
    }
}

public class TireMeasurementConfiguration : IEntityTypeConfiguration<TireMeasurement>
{
    public void Configure(EntityTypeBuilder<TireMeasurement> builder)
    {
        builder.Property(m => m.PressureBar).HasColumnType("decimal(4,2)");
        builder.Property(m => m.TreadDepthMm).HasColumnType("decimal(4,1)");

        builder.HasOne(m => m.Tire)
            .WithMany(t => t.Measurements)
            .HasForeignKey(m => m.TireId)
            .OnDelete(DeleteBehavior.Cascade);

        // One measurement per tire per date; a simultaneous second one fails here.
        builder.HasIndex(m => new { m.TireId, m.MeasuredAt }).IsUnique();
        builder.ToTable(t => t.HasCheckConstraint("CK_TireMeasurements_Values",
            "(\"PressureBar\" IS NOT NULL OR \"TreadDepthMm\" IS NOT NULL) AND (\"PressureBar\" IS NULL OR \"PressureBar\" BETWEEN 0.5 AND 6.0) AND (\"TreadDepthMm\" IS NULL OR \"TreadDepthMm\" BETWEEN 0 AND 20)"));
    }
}

public class TireRotationConfiguration : IEntityTypeConfiguration<TireRotation>
{
    public void Configure(EntityTypeBuilder<TireRotation> builder)
    {
        builder.Property(r => r.OdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(r => r.Notes).HasMaxLength(TireRotation.MaxNotesLength);

        builder.HasOne(r => r.Vehicle)
            .WithMany()
            .HasForeignKey(r => r.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(r => new { r.VehicleId, r.Date });
    }
}

public class TireRotationMoveConfiguration : IEntityTypeConfiguration<TireRotationMove>
{
    public void Configure(EntityTypeBuilder<TireRotationMove> builder)
    {
        builder.HasOne(m => m.TireRotation)
            .WithMany(r => r.Moves)
            .HasForeignKey(m => m.TireRotationId)
            .OnDelete(DeleteBehavior.Cascade);

        // The car already cascades to the tire through Tires, so this path can't (SQL Server); a moved tire can't be deleted (tire.rotated).
        builder.HasOne(m => m.Tire)
            .WithMany()
            .HasForeignKey(m => m.TireId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasIndex(m => new { m.TireRotationId, m.TireId }).IsUnique();
    }
}
