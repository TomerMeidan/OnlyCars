using Microsoft.EntityFrameworkCore;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>
/// Runs the real migrations on a throwaway LocalDB database, because the InMemory provider
/// enforces neither check constraints nor database cascades.
/// shortcut: needs SQL Server LocalDB on the machine; switch to a container or CI database when there is a CI.
/// </summary>
public class MaintenanceSchemaTests : IAsyncLifetime
{
    private readonly AppDbContext db = new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer($@"Server=(localdb)\mssqllocaldb;Database=OnlyCars_Test_{Guid.NewGuid():N};Trusted_Connection=True;TrustServerCertificate=True")
        .Options);

    public async Task InitializeAsync() => await db.Database.MigrateAsync();

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    private async Task<Vehicle> AddCarAsync()
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = "Car" };
        db.Vehicles.Add(car);
        await db.SaveChangesAsync();
        return car;
    }

    [Fact]
    public async Task Migrations_SeedTwelveTemplates_EnforceIntervalCheck_AndCascadeVehicleDelete()
    {
        // Criterion 1: a fresh database has exactly the 12 templates, in seed order of their fixed ids.
        var keys = await db.TaskTemplates.OrderBy(t => t.Id).Select(t => t.Key).ToListAsync();
        Assert.Equal(["oilChange", "airFilter", "cabinFilter", "brakePads", "brakeFluid", "coolant",
            "transmissionFluid", "sparkPlugs", "timingBelt", "tireRotation", "battery", "wiperBlades"], keys);

        // Criterion 4: the check constraint rejects a task with neither interval.
        var car = await AddCarAsync();
        db.MaintenanceTasks.Add(new MaintenanceTask { VehicleId = car.Id, Name = "No interval", Category = TaskCategory.Other });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        db.ChangeTracker.Clear();

        // Criterion 10: deleting the vehicle in the database cascades to its tasks and leaves the template.
        var template = await db.TaskTemplates.FirstAsync();
        db.MaintenanceTasks.Add(new MaintenanceTask { VehicleId = car.Id, TemplateId = template.Id, Name = "Oil", IntervalKm = 1 });
        await db.SaveChangesAsync();
        await db.Vehicles.Where(v => v.Id == car.Id).ExecuteDeleteAsync();

        Assert.Equal(0, await db.MaintenanceTasks.CountAsync());
        Assert.Equal(12, await db.TaskTemplates.CountAsync());
    }
}
