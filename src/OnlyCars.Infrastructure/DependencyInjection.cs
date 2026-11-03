using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Common;
using OnlyCars.Application.Reminders;
using OnlyCars.Infrastructure.Auth;
using OnlyCars.Infrastructure.Email;
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

        // Not registered without a Resend key or an SMTP login, so a fresh clone and the tests send nothing (DigestService then gets null).
        var email = configuration.GetSection(EmailOptions.SectionName);
        services.Configure<EmailOptions>(email);
        var o = email.Get<EmailOptions>() ?? new EmailOptions();
        // Resend needs a From; without one it's skipped rather than stopping the site (deploy 2026-11-03 crashed on it).
        if (o is { ResendApiKey.Length: > 0, From.Length: > 0 })
        {
            services.AddSingleton<IEmailSender>(new ResendEmailSender(o.ResendApiKey, o.From));
        }
        else if (o is { SmtpUser.Length: > 0, SmtpPassword.Length: > 0 })
        {
            // Gmail sends only as the signed-in account, so From defaults to it.
            services.AddSingleton<IEmailSender>(new SmtpEmailSender(o.SmtpHost, o.SmtpPort, o.SmtpUser, o.SmtpPassword,
                o.From is { Length: > 0 } f ? f : $"OnlyCars <{o.SmtpUser}>"));
        }

        return services;
    }
}
