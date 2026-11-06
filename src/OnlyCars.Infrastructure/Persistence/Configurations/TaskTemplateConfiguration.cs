using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class TaskTemplateConfiguration : IEntityTypeConfiguration<TaskTemplate>
{
    // Fixed values so the seed doesn't change on every migration.
    private static readonly DateTimeOffset SeededAt = new(2026, 10, 14, 0, 0, 0, TimeSpan.Zero);

    public void Configure(EntityTypeBuilder<TaskTemplate> builder)
    {
        builder.Property(t => t.Key).IsRequired().HasMaxLength(50);
        builder.Property(t => t.Name).IsRequired().HasMaxLength(MaintenanceTask.MaxNameLength);
        builder.Property(t => t.NameHe).IsRequired().HasMaxLength(MaintenanceTask.MaxNameLength);
        builder.HasIndex(t => t.Key).IsUnique();
        builder.ToTable(t => t.HasCheckConstraint("CK_TaskTemplates_Interval",
            "[DefaultIntervalKm] IS NOT NULL OR [DefaultIntervalDays] IS NOT NULL"));

        // NameHe must stay equal to the Hebrew templates.* texts in client/src/i18n.ts (decisions.md, SRCH-1).
        (string Key, string Name, string NameHe, TaskCategory Category, int? Km, int? Days)[] seed =
        [
            ("oilChange", "Engine oil and filter", "שמן מנוע ופילטר שמן", TaskCategory.Oil, 10_000, 365),
            ("airFilter", "Air filter", "פילטר אוויר", TaskCategory.Filters, 20_000, 730),
            ("cabinFilter", "Cabin filter", "פילטר מזגן", TaskCategory.Filters, 15_000, 365),
            ("brakePads", "Brake pads check", "בדיקת רפידות בלמים", TaskCategory.Brakes, 20_000, 365),
            ("brakeFluid", "Brake fluid", "נוזל בלמים", TaskCategory.Fluids, null, 730),
            ("coolant", "Coolant", "נוזל קירור", TaskCategory.Fluids, 60_000, 1_825),
            ("transmissionFluid", "Transmission fluid", "שמן גיר", TaskCategory.Fluids, 60_000, null),
            ("sparkPlugs", "Spark plugs", "מצתים", TaskCategory.Ignition, 60_000, null),
            ("timingBelt", "Timing belt", "רצועת טיימינג", TaskCategory.Belts, 100_000, 1_825),
            ("tireRotation", "Tire rotation", "רוטציית צמיגים", TaskCategory.Tires, 10_000, null),
            ("battery", "Battery check", "בדיקת מצבר", TaskCategory.Battery, null, 365),
            ("wiperBlades", "Wiper blades", "מגבים", TaskCategory.Other, null, 365),
        ];

        builder.HasData(seed.Select((t, i) => new TaskTemplate
        {
            Id = Guid.Parse($"7a5c0000-0000-4000-8000-{i + 1:D12}"),
            Key = t.Key,
            Name = t.Name,
            NameHe = t.NameHe,
            Category = t.Category,
            DefaultIntervalKm = t.Km,
            DefaultIntervalDays = t.Days,
            CreatedAt = SeededAt,
            UpdatedAt = SeededAt
        }));
    }
}
