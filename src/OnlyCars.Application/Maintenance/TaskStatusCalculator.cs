using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Maintenance;

public record TaskStatusResult(DueStatus? Status, decimal? RemainingKm, int? RemainingDays, double? Progress);

/// <summary>Pure status rules from decisions.md (MVP2-B). No clock: the caller passes today (UTC).</summary>
public static class TaskStatusCalculator
{
    private static readonly TaskStatusResult None = new(null, null, null, null);

    public static TaskStatusResult Compute(MaintenanceTask task, decimal currentOdometerKm, DateOnly today)
    {
        if (!task.IsEnabled)
        {
            return None;
        }

        DueStatus? status = null;
        double? progress = null;
        decimal? remainingKm = null;
        int? remainingDays = null;

        if (task.IntervalKm is { } intervalKm)
        {
            var usedKm = Math.Max(0, currentOdometerKm - task.LastDoneOdometerKm);
            remainingKm = intervalKm - usedKm;
            status = Worse(status, StatusOf(remainingKm.Value, intervalKm, task.DueSoonPercent));
            progress = Math.Max(progress ?? 0, (double)(usedKm / intervalKm));
        }

        if (task.IntervalDays is { } intervalDays)
        {
            var usedDays = Math.Max(0, today.DayNumber - task.LastDoneDate.DayNumber);
            remainingDays = intervalDays - usedDays;
            status = Worse(status, StatusOf(remainingDays.Value, intervalDays, task.DueSoonPercent));
            progress = Math.Max(progress ?? 0, (double)usedDays / intervalDays);
        }

        return new TaskStatusResult(status, remainingKm, remainingDays, progress);
    }

    private static DueStatus StatusOf(decimal remaining, int interval, int dueSoonPercent) =>
        remaining < 0 ? DueStatus.Overdue
        : remaining * 100 <= (decimal)interval * dueSoonPercent ? DueStatus.DueSoon
        : DueStatus.Ok;

    private static DueStatus Worse(DueStatus? a, DueStatus b) => a is { } x && x > b ? x : b;
}
