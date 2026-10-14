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
        services.AddScoped<AuthService>();
        services.AddScoped<VehicleService>();
        services.AddScoped<OdometerService>();
        services.AddScoped<MaintenanceTaskService>();

        return services;
    }
}
