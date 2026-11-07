using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using OnlyCars.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

namespace OnlyCars.Tests;

public static class TestDbContextFactory
{
    public static AppDbContext Create()
    {
        return new AppDbContext(Options(Guid.NewGuid().ToString()).Options);
    }

    // InMemory has no transactions; TireService's rotations use one on Postgres (MaintenanceSchemaTests covers that).
    public static DbContextOptionsBuilder<AppDbContext> Options(string name, Microsoft.EntityFrameworkCore.Storage.InMemoryDatabaseRoot? root = null) =>
        new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(name, root)
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning));

    // One container per run, on a random host port; Testcontainers removes it when the run ends. The only source of a real connection string.
    private static readonly Lazy<PostgreSqlContainer> Container = new(() =>
    {
        // Every test gets its own database, so more connections than the default 100.
        var container = new PostgreSqlBuilder("postgres:17").WithCommand("-c", "max_connections=500").Build();
        container.StartAsync().GetAwaiter().GetResult();
        return container;
    });

    /// <summary>The container's superuser, on its maintenance database.</summary>
    public static string AdminConnection => Container.Value.GetConnectionString();

    /// <summary>A database name of its own in the container; MigrateAsync creates it, EnsureDeletedAsync drops it.</summary>
    public static string NewPostgresConnection() =>
        new NpgsqlConnectionStringBuilder(AdminConnection) { Database = $"onlycars_test_{Guid.NewGuid():N}" }.ConnectionString;

    public static DbContextOptionsBuilder<AppDbContext> PostgresOptions(string connection) =>
        new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(connection, AppDbContext.NpgsqlOptions);
}
