using Microsoft.Extensions.Options;
using OnlyCars.Application.Reminders;

namespace OnlyCars.Api.Common;

/// <summary>Runs the reminder email daily at Email:DigestHourLocal, Israel time (NOT-2). Registered only when email is configured.</summary>
public sealed class DailyDigestTimer(IServiceScopeFactory scopes, IOptions<EmailOptions> options, ILogger<DailyDigestTimer> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var hour = Math.Clamp(options.Value.DigestHourLocal, 0, 23);
        while (!stoppingToken.IsCancellationRequested)
        {
            var local = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, DigestService.Israel).DateTime;
            // Also at start-up after the hour: the free host sleeps when idle, so this catches up when it wakes. Sending is once a day anyway.
            if (local.Hour >= hour)
            {
                try
                {
                    using var scope = scopes.CreateScope();
                    await scope.ServiceProvider.GetRequiredService<DigestService>().RunAsync(DateOnly.FromDateTime(local), stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    logger.LogError("Daily digest run failed: {Error}", ex.GetType().Name); // the job endpoint or tomorrow retries
                }
            }

            var next = local.Date.AddDays(local.Hour >= hour ? 1 : 0).AddHours(hour);
            next = DigestService.Israel.IsInvalidTime(next) ? next.AddHours(1) : next; // the hour skipped when clocks go forward
            var wait = TimeZoneInfo.ConvertTimeToUtc(next, DigestService.Israel) - DateTime.UtcNow;
            await Task.Delay(wait > TimeSpan.FromMinutes(1) ? wait : TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
