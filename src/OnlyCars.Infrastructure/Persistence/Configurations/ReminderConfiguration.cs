using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class VehicleDocumentConfiguration : IEntityTypeConfiguration<VehicleDocument>
{
    public void Configure(EntityTypeBuilder<VehicleDocument> builder)
    {
        builder.Property(d => d.Cost).HasColumnType("decimal(12,2)");
        builder.Property(d => d.Notes).HasMaxLength(VehicleDocument.MaxNotesLength);
        // Every edit and file upload sets UpdatedAt, so overlapping uploads (or an upload and a delete) give one 409 (SCAN-2a).
        builder.Property(d => d.UpdatedAt).IsConcurrencyToken();

        builder.HasOne(d => d.Vehicle)
            .WithMany()
            .HasForeignKey(d => d.VehicleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(d => new { d.VehicleId, d.ExpiryDate });
        builder.ToTable(t => t.HasCheckConstraint("CK_VehicleDocuments_Cost", "\"Cost\" IS NULL OR \"Cost\" >= 0"));
    }
}

public class NotificationRuleConfiguration : IEntityTypeConfiguration<NotificationRule>
{
    public void Configure(EntityTypeBuilder<NotificationRule> builder)
    {
        builder.HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(r => new { r.UserId, r.Channel }).IsUnique();
        builder.ToTable(t => t.HasCheckConstraint("CK_NotificationRules_LeadDays",
            $"\"LeadDays\" BETWEEN {NotificationRule.MinLeadDays} AND {NotificationRule.MaxLeadDays}"));
    }
}

public class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.HasOne(n => n.User)
            .WithMany()
            .HasForeignKey(n => n.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(n => new { n.UserId, n.Kind, n.RefId }).IsUnique();
    }
}
