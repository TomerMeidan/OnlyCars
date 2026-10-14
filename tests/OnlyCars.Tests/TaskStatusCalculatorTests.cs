using OnlyCars.Application.Maintenance;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

public class TaskStatusCalculatorTests
{
    private static readonly DateOnly Today = new(2026, 6, 1);

    private static MaintenanceTask Task(int? km, int? days, decimal lastKm = 0, int daysAgo = 0, int percent = 10, bool enabled = true) =>
        new()
        {
            Name = "T", IntervalKm = km, IntervalDays = days, LastDoneOdometerKm = lastKm,
            LastDoneDate = Today.AddDays(-daysAgo), DueSoonPercent = percent, IsEnabled = enabled
        };

    [Theory]
    [InlineData(8_999, 1_001, DueStatus.Ok)]
    [InlineData(9_000, 1_000, DueStatus.DueSoon)] // exactly 10% left
    [InlineData(10_000, 0, DueStatus.DueSoon)]    // due now
    [InlineData(10_001, -1, DueStatus.Overdue)]
    public void KmOnly_ThresholdBoundaries(int currentKm, int remaining, DueStatus status)
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, null), currentKm, Today);

        Assert.Equal((status, (decimal?)remaining, (int?)null), (r.Status!.Value, r.RemainingKm, r.RemainingDays));
        Assert.Equal(currentKm / 10_000.0, r.Progress!.Value, 10);
    }

    [Theory]
    [InlineData(328, 37, DueStatus.Ok)]
    [InlineData(329, 36, DueStatus.DueSoon)] // 36 * 100 <= 3,650
    [InlineData(365, 0, DueStatus.DueSoon)]
    [InlineData(366, -1, DueStatus.Overdue)]
    public void DaysOnly_ThresholdBoundaries(int daysAgo, int remaining, DueStatus status)
    {
        var r = TaskStatusCalculator.Compute(Task(null, 365, daysAgo: daysAgo), 0, Today);

        Assert.Equal((status, (decimal?)null, (int?)remaining), (r.Status!.Value, r.RemainingKm, r.RemainingDays));
        Assert.Equal(daysAgo / 365.0, r.Progress!.Value, 10);
    }

    [Fact]
    public void Both_Ok_ProgressIsTheLargerShare()
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, 365, lastKm: 50_000, daysAgo: 73), 53_000, Today);

        Assert.Equal((DueStatus.Ok, (decimal?)7_000, (int?)292), (r.Status!.Value, r.RemainingKm, r.RemainingDays));
        Assert.Equal(0.3, r.Progress!.Value, 10); // km share 0.3 beats days share 0.2
    }

    [Fact]
    public void Both_KmOverdue_DaysOk_IsOverdue()
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, 365, daysAgo: 165), 10_500, Today);

        Assert.Equal((DueStatus.Overdue, (decimal?)-500, (int?)200), (r.Status!.Value, r.RemainingKm, r.RemainingDays));
        Assert.Equal(1.05, r.Progress!.Value, 10);
    }

    [Fact]
    public void Both_KmOk_DaysDueSoon_IsDueSoon()
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, 365, daysAgo: 340), 1_000, Today);

        Assert.Equal((DueStatus.DueSoon, (decimal?)9_000, (int?)25), (r.Status!.Value, r.RemainingKm, r.RemainingDays));
    }

    [Fact]
    public void OdometerBelowLastDone_CountsAsZeroUsed()
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, null, lastKm: 60_000), 59_000, Today);

        Assert.Equal((DueStatus.Ok, (decimal?)10_000, 0.0), (r.Status!.Value, r.RemainingKm, r.Progress!.Value));
    }

    [Fact]
    public void LastDoneTomorrow_CountsAsZeroUsed()
    {
        var r = TaskStatusCalculator.Compute(Task(null, 365, daysAgo: -1), 0, Today);

        Assert.Equal((DueStatus.Ok, (int?)365, 0.0), (r.Status!.Value, r.RemainingDays, r.Progress!.Value));
    }

    [Theory]
    [InlineData(1, 9_900, DueStatus.DueSoon)] // 100 left = 1%
    [InlineData(1, 9_899, DueStatus.Ok)]
    [InlineData(50, 5_000, DueStatus.DueSoon)] // 5,000 left = 50%
    [InlineData(50, 4_999, DueStatus.Ok)]
    public void DueSoonPercent_1And50_Boundaries(int percent, int currentKm, DueStatus status)
    {
        Assert.Equal(status, TaskStatusCalculator.Compute(Task(10_000, null, percent: percent), currentKm, Today).Status);
    }

    [Fact]
    public void Overdue_ProgressAboveOne()
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, 365, daysAgo: 730), 15_000, Today);

        Assert.Equal(DueStatus.Overdue, r.Status);
        Assert.Equal(2.0, r.Progress!.Value, 10);
    }

    [Fact]
    public void Disabled_HasNoStatusOrRemainingValues()
    {
        var r = TaskStatusCalculator.Compute(Task(10_000, 365, daysAgo: 730, enabled: false), 15_000, Today);

        Assert.Equal(new TaskStatusResult(null, null, null, null), r);
    }
}
