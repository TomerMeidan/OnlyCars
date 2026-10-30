using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Common;
using OnlyCars.Infrastructure.Auth;
using OnlyCars.Infrastructure.Persistence;
using OnlyCars.Infrastructure.Storage;

namespace OnlyCars.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlServer(configuration.GetConnectionString("Default")));
        services.AddScoped<IAppDbContext>(sp => sp.GetRequiredService<AppDbContext>());

        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.AddScoped<IJwtTokenService, JwtTokenService>();

        // Not registered without a client id, so Google sign-in stays off (AuthService then gets null).
        if (configuration[$"{GoogleOptions.SectionName}:ClientId"] is { Length: > 0 } googleClientId)
        {
            services.AddSingleton<IGoogleTokenValidator>(GoogleTokenValidator.Create(googleClientId));
        }

        services.AddOptions<StorageOptions>().Bind(configuration.GetSection(StorageOptions.SectionName))
            .Validate(o => o.UserQuotaBytes > 0, "Storage:UserQuotaBytes must be positive.").ValidateOnStart();

        // Not registered without the R2 settings, so a fresh clone still starts (VehicleService then gets null).
        if (R2FileStorage.FromConfiguration(configuration) is { } storage)
        {
            services.AddSingleton<IFileStorage>(storage);
        }

        return services;
    }
}
