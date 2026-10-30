using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Infrastructure.Persistence.Configurations;

public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.Property(u => u.Email).IsRequired().HasMaxLength(256);
        builder.Property(u => u.PasswordHash).IsRequired();
        builder.Property(u => u.Currency).IsRequired().HasMaxLength(3);

        builder.HasIndex(u => u.Email).IsUnique();
        builder.Property(u => u.GoogleSubject).HasMaxLength(255);
        builder.HasIndex(u => u.GoogleSubject).IsUnique().HasFilter("[GoogleSubject] IS NOT NULL");
    }
}
