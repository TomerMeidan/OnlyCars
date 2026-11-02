using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Common;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Reminders;

/// <summary>The daily reminder email (NOT-2): one per user per Israel-time day, only with something in it, unless the user turned it off.</summary>
public class DigestService(IAppDbContext db, ReminderService reminders, IOptions<EmailOptions> options, ILogger<DigestService> logger,
    IEmailSender? sender = null)
{
    public static readonly TimeZoneInfo Israel = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");

    // shortcut: one lock per process, so the timer and the job endpoint never overlap; fine for one instance, use a database lock if it scales out.
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static DateOnly LocalToday(DateTimeOffset utcNow) => DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, Israel).DateTime);

    /// <summary>Sends today's digests not sent yet; returns how many went out. A failed user is logged and retried on the next run.</summary>
    public async Task<int> RunAsync(DateOnly today, CancellationToken ct = default)
    {
        if (sender is null)
        {
            logger.LogInformation("Daily digest skipped: email is not configured.");
            return 0;
        }

        await Gate.WaitAsync(ct);
        try
        {
            // shortcut: all users in one list; page through them if there are ever more than a few thousand.
            var users = await db.Users.OrderBy(u => u.CreatedAt).Select(u => new { u.Id, u.Email, u.Locale, u.DistanceUnit }).ToListAsync(ct);
            var rules = await db.NotificationRules.Where(r => r.Channel == NotificationChannel.Email).ToDictionaryAsync(r => r.UserId, ct);
            var sent = 0;
            foreach (var user in users)
            {
                var rule = rules.GetValueOrDefault(user.Id);
                if (rule is { IsEnabled: false } || rule?.LastSentOn >= today)
                {
                    continue;
                }

                NotificationRule? added = null;
                try
                {
                    var due = await reminders.GetAsync(user.Id, today, ct);
                    if (due.Items.Count == 0 && due.OpenToDos.Count == 0)
                    {
                        continue;
                    }

                    var (subject, html) = DigestEmail.Render(due, user.Locale, user.DistanceUnit, options.Value.SiteUrl);
                    await sender.SendAsync(user.Email, subject, html, ct);

                    if (rule is null)
                    {
                        rule = added = new NotificationRule { UserId = user.Id, Channel = NotificationChannel.Email };
                        db.NotificationRules.Add(rule);
                    }

                    rule.LastSentOn = today;
                    rule.UpdatedAt = DateTimeOffset.UtcNow;
                    await db.SaveChangesAsync(ct);
                    sent++;
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    if (added is not null)
                    {
                        db.NotificationRules.Remove(added); // detaches a failed insert, so the next user's save doesn't retry it
                    }

                    // The user id only: no address, key or provider message, which can echo the address.
                    logger.LogError("Daily digest for user {UserId} failed: {Error} {Status}", user.Id, ex.GetType().Name,
                        (ex as HttpRequestException)?.StatusCode);
                }
            }

            logger.LogInformation("Daily digest for {Day}: {Sent} sent.", today, sent);
            return sent;
        }
        finally
        {
            Gate.Release();
        }
    }
}
