using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class VehicleChecklistConfiguration : IEntityTypeConfiguration<VehicleChecklist>
{
    public void Configure(EntityTypeBuilder<VehicleChecklist> builder)
    {
        builder.Property(c => c.LastRunOdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(c => c.StartOdometerKm).HasColumnType("decimal(12,2)");

        builder.HasOne(c => c.Vehicle)
            .WithMany()
            .HasForeignKey(c => c.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        // User already cascades through the car, so this path can't (SQL Server); an attached template can't be deleted (inUse).
        builder.HasOne(c => c.Template)
            .WithMany()
            .HasForeignKey(c => c.TemplateId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasIndex(c => new { c.VehicleId, c.TemplateId }).IsUnique();
        // No interval check constraint: both null is "manual only" (decisions.md).
    }
}

public class ChecklistRunConfiguration : IEntityTypeConfiguration<ChecklistRun>
{
    public void Configure(EntityTypeBuilder<ChecklistRun> builder)
    {
        builder.Property(r => r.OdometerKm).HasColumnType("decimal(12,2)");
        builder.Property(r => r.Notes).HasMaxLength(ChecklistRun.MaxNotesLength);

        builder.HasOne(r => r.VehicleChecklist)
            .WithMany(c => c.Runs)
            .HasForeignKey(r => r.VehicleChecklistId)
            .OnDelete(DeleteBehavior.Cascade);

        // The car cascades to both readings and runs, so this path can't (SQL Server); VehicleChecklistService deletes the reading.
        builder.HasOne(r => r.OdometerReading)
            .WithMany()
            .HasForeignKey(r => r.OdometerReadingId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasIndex(r => new { r.VehicleChecklistId, r.RunAt })
            .IsDescending(false, true);
        builder.HasIndex(r => r.OdometerReadingId);
    }
}

public class ChecklistRunItemConfiguration : IEntityTypeConfiguration<ChecklistRunItem>
{
    public void Configure(EntityTypeBuilder<ChecklistRunItem> builder)
    {
        builder.Property(i => i.LabelSnapshot).IsRequired().HasMaxLength(ChecklistTemplateItem.MaxLabelLength);
        builder.Property(i => i.Unit).HasMaxLength(ChecklistTemplateItem.MaxUnitLength);
        builder.Property(i => i.MinValue).HasColumnType("decimal(12,2)");
        builder.Property(i => i.MaxValue).HasColumnType("decimal(12,2)");
        builder.Property(i => i.NumberValue).HasColumnType("decimal(12,2)");
        builder.Property(i => i.TextValue).HasMaxLength(ChecklistRunItem.MaxTextLength);

        builder.HasOne(i => i.Run)
            .WithMany(r => r.Items)
            .HasForeignKey(i => i.RunId)
            .OnDelete(DeleteBehavior.Cascade);

        // Second cascade path from the user (SQL Server): ChecklistTemplateService clears the link when it deletes an item.
        builder.HasOne(i => i.TemplateItem)
            .WithMany()
            .HasForeignKey(i => i.TemplateItemId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
