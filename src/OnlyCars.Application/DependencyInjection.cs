using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
        // Bounds memory (SEC-1 F1). Every entry must set Size; the login counters use 1 each.
        // shortcut: when full, new counters aren't stored, so unseen emails go uncounted until entries expire; raise it or move to Redis if that's ever hit.
        services.AddMemoryCache(o => o.SizeLimit = 100_000);
        services.AddScoped<AuthService>();
        services.AddScoped<VehicleService>();
        services.AddScoped<OdometerService>();
        services.AddScoped<MaintenanceTaskService>();

        return services;
    }
}
