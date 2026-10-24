using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using OnlyCars.Application.Account;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Issues;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Reports;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
        // Bounds memory (SEC-1 F1). Every entry must set Size; the login counters use 1 each.
        // shortcut: when full, new unknown-email counters aren't stored (uncounted) and new account counters fail closed (429)
        // until compaction or expiry frees room; raise it or move to Redis if that's ever hit.
        services.AddMemoryCache(o => o.SizeLimit = 100_000);
        services.AddScoped<AuthService>();
        services.AddScoped<VehicleService>();
        services.AddScoped<OdometerService>();
        services.AddScoped<MaintenanceTaskService>();
        services.AddScoped<ChecklistTemplateService>();
        services.AddScoped<VehicleChecklistService>();
        services.AddScoped<IssueService>();
        services.AddScoped<TireService>();
        services.AddScoped<ReportService>();
        services.AddScoped<VehicleDocumentService>();
        services.AddScoped<ReminderService>();
        services.AddScoped<ExportService>();
        services.AddScoped<AccountService>();

        return services;
    }
}
