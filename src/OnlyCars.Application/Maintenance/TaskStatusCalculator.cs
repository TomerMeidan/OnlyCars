using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Maintenance;

public record TaskStatusResult(DueStatus? Status, decimal? RemainingKm, int? RemainingDays, double? Progress);

/// <summary>Pure status rules from decisions.md (MVP2-B), also used by checklists (MVP5-B). No clock: the caller passes today (UTC).</summary>
public static class TaskStatusCalculator
{
    private static readonly TaskStatusResult None = new(null, null, null, null);

    public static TaskStatusResult Compute(MaintenanceTask task, decimal currentOdometerKm, DateOnly today) =>
        Compute(task.IsEnabled, task.IntervalKm, task.IntervalDays, task.DueSoonPercent, task.LastDoneOdometerKm, task.LastDoneDate,
            currentOdometerKm, today);

    // Both intervals null (a manual-only checklist) gives no status, like a disabled task.
    public static TaskStatusResult Compute(bool isEnabled, int? intervalKm, int? intervalDays, int dueSoonPercent,
        decimal lastDoneKm, DateOnly lastDoneDate, decimal currentOdometerKm, DateOnly today)
    {
        if (!isEnabled)
        {
            return None;
        }

        DueStatus? status = null;
        double? progress = null;
        decimal? remainingKm = null;
        int? remainingDays = null;

        if (intervalKm is { } km)
        {
            var usedKm = Math.Max(0, currentOdometerKm - lastDoneKm);
            remainingKm = km - usedKm;
            status = Worse(status, StatusOf(remainingKm.Value, km, dueSoonPercent));
            progress = Math.Max(progress ?? 0, (double)(usedKm / km));
        }

        if (intervalDays is { } days)
        {
            var usedDays = Math.Max(0, today.DayNumber - lastDoneDate.DayNumber);
            remainingDays = days - usedDays;
            status = Worse(status, StatusOf(remainingDays.Value, days, dueSoonPercent));
            progress = Math.Max(progress ?? 0, (double)usedDays / days);
        }

        return new TaskStatusResult(status, remainingKm, remainingDays, progress);
    }

    /// <summary>
    /// PRED-1 in decisions.md: today + ceil(remaining km / km a day), or the time due date when earlier; null when disabled,
    /// Overdue, without IntervalKm, without an average above 0, or more than 730 days out.
    /// </summary>
    public static DateOnly? PredictDueDate(TaskStatusResult s, decimal? avgKmPerDay, DateOnly today)
    {
        if (s.Status is null or DueStatus.Overdue || s.RemainingKm is not { } km || avgKmPerDay is not > 0)
        {
            return null;
        }

        var days = Math.Min(Math.Ceiling(km / avgKmPerDay.Value), s.RemainingDays ?? decimal.MaxValue);
        return days > PredictionMaxDays ? null : today.AddDays((int)days);
    }

    private const int PredictionMaxDays = 730;

    private static DueStatus StatusOf(decimal remaining, int interval, int dueSoonPercent) =>
        remaining < 0 ? DueStatus.Overdue
        : remaining * 100 <= (decimal)interval * dueSoonPercent ? DueStatus.DueSoon
        : DueStatus.Ok;

    private static DueStatus Worse(DueStatus? a, DueStatus b) => a is { } x && x > b ? x : b;
}
