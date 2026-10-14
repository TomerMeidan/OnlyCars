using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class VehicleConfiguration : IEntityTypeConfiguration<Vehicle>
{
    public void Configure(EntityTypeBuilder<Vehicle> builder)
    {
        builder.Property(v => v.Nickname).IsRequired().HasMaxLength(100);
        builder.Property(v => v.Make).HasMaxLength(100);
        builder.Property(v => v.Model).HasMaxLength(100);
        builder.Property(v => v.Vin).HasMaxLength(32);
        builder.Property(v => v.Plate).HasMaxLength(32);
        builder.Property(v => v.PurchasePrice).HasColumnType("decimal(12,2)");
        builder.Property(v => v.CurrentOdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(v => v.AvgKmPerDay).HasColumnType("decimal(12,2)");

        builder.HasOne(v => v.User)
            .WithMany(u => u.Vehicles)
            .HasForeignKey(v => v.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Unique Vehicle(UserId, Vin) where Vin is not null
        builder.HasIndex(v => new { v.UserId, v.Vin })
            .IsUnique()
            .HasFilter("[Vin] IS NOT NULL");
    }
}
