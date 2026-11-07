using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class IssueConfiguration : IEntityTypeConfiguration<Issue>
{
    public void Configure(EntityTypeBuilder<Issue> builder)
    {
        builder.Property(i => i.Title).IsRequired().HasMaxLength(Issue.MaxTitleLength);
        builder.Property(i => i.Description).HasMaxLength(Issue.MaxDescriptionLength);

        builder.HasOne(i => i.Vehicle)
            .WithMany()
            .HasForeignKey(i => i.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        // The car also cascades to run items, so this path can't (SQL Server); VehicleChecklistService clears it when a run is deleted.
        builder.HasOne(i => i.SourceRunItem)
            .WithMany()
            .HasForeignKey(i => i.SourceRunItemId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasIndex(i => i.VehicleId);
        builder.HasIndex(i => i.SourceRunItemId).IsUnique().HasFilter("\"SourceRunItemId\" IS NOT NULL");
        builder.ToTable(t => t.HasCheckConstraint("CK_Issues_ResolvedAt",
            "(\"Status\" = 0 AND \"ResolvedAt\" IS NULL) OR (\"Status\" = 1 AND \"ResolvedAt\" IS NOT NULL)"));
    }
}
