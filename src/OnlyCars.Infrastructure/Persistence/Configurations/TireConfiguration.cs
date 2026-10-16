using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class TireSetConfiguration : IEntityTypeConfiguration<TireSet>
{
    public void Configure(EntityTypeBuilder<TireSet> builder)
    {
        builder.Property(s => s.Brand).IsRequired().HasMaxLength(TireSet.MaxBrandLength);
        builder.Property(s => s.Model).HasMaxLength(TireSet.MaxModelLength);
        builder.Property(s => s.Size).HasMaxLength(TireSet.MaxSizeLength);
        builder.Property(s => s.DotCode).HasMaxLength(TireSet.MaxDotCodeLength);
        builder.Property(s => s.Notes).HasMaxLength(TireSet.MaxNotesLength);

        builder.HasOne(s => s.User)
            .WithMany()
            .HasForeignKey(s => s.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class TireMountConfiguration : IEntityTypeConfiguration<TireMount>
{
    public void Configure(EntityTypeBuilder<TireMount> builder)
    {
        builder.Property(m => m.MountOdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(m => m.UnmountOdometerKm).HasColumnType("decimal(12,2)");

        builder.HasOne(m => m.TireSet)
            .WithMany(s => s.Mounts)
            .HasForeignKey(m => m.TireSetId)
            .OnDelete(DeleteBehavior.Cascade);

        // The user cascades through the set already, so this path can't (SQL Server); cars are archived, never hard-deleted.
        builder.HasOne(m => m.Vehicle)
            .WithMany()
            .HasForeignKey(m => m.VehicleId)
            .OnDelete(DeleteBehavior.NoAction);

        // At most one open mount per car and per set (spec "Indexes and Constraints").
        builder.HasIndex(m => m.VehicleId).IsUnique().HasFilter("[UnmountedAt] IS NULL").HasDatabaseName("IX_TireMounts_VehicleId_Open");
        builder.HasIndex(m => m.TireSetId).IsUnique().HasFilter("[UnmountedAt] IS NULL").HasDatabaseName("IX_TireMounts_TireSetId_Open");
        builder.HasIndex(m => new { m.TireSetId, m.MountedAt });
        builder.HasIndex(m => new { m.VehicleId, m.MountedAt });
        builder.ToTable(t => t.HasCheckConstraint("CK_TireMounts_Unmount",
            "([UnmountedAt] IS NULL AND [UnmountOdometerKm] IS NULL) OR ([UnmountedAt] >= [MountedAt] AND [UnmountOdometerKm] >= [MountOdometerKm])"));
    }
}
