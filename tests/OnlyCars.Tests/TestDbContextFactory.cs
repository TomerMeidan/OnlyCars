using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

public static class TestDbContextFactory
{
    public static AppDbContext Create()
    {
        return new AppDbContext(Options(Guid.NewGuid().ToString()).Options);
    }

    // InMemory has no transactions; TireService's rotations use one on SQL Server (MaintenanceSchemaTests covers that).
    public static DbContextOptionsBuilder<AppDbContext> Options(string name, Microsoft.EntityFrameworkCore.Storage.InMemoryDatabaseRoot? root = null) =>
        new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning));
}
