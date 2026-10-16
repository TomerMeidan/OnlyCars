using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class ChecklistTemplateConfiguration : IEntityTypeConfiguration<ChecklistTemplate>
{
    public void Configure(EntityTypeBuilder<ChecklistTemplate> builder)
    {
        builder.Property(t => t.Name).IsRequired().HasMaxLength(ChecklistTemplate.MaxNameLength);
        // Every edit sets UpdatedAt, so of two simultaneous edits the second matches no row and is a 409 concurrency.conflict (L38).
        builder.Property(t => t.UpdatedAt).IsConcurrencyToken();

        builder.HasOne(t => t.User)
            .WithMany()
            .HasForeignKey(t => t.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}

public class ChecklistTemplateItemConfiguration : IEntityTypeConfiguration<ChecklistTemplateItem>
{
    public void Configure(EntityTypeBuilder<ChecklistTemplateItem> builder)
    {
        builder.Property(i => i.Label).IsRequired().HasMaxLength(ChecklistTemplateItem.MaxLabelLength);
        builder.Property(i => i.Unit).HasMaxLength(ChecklistTemplateItem.MaxUnitLength);
        builder.Property(i => i.MinValue).HasColumnType("decimal(12,2)");
        builder.Property(i => i.MaxValue).HasColumnType("decimal(12,2)");

        builder.HasOne(i => i.Template)
            .WithMany(t => t.Items)
            .HasForeignKey(i => i.TemplateId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.ToTable(t => t.HasCheckConstraint("CK_ChecklistTemplateItems_Range",
            "[MinValue] IS NULL OR [MaxValue] IS NULL OR [MinValue] <= [MaxValue]"));
    }
}
