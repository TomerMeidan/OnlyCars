using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Reports.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Reports;

/// <summary>Cost reports (RPT-1, decisions.md "Cost reports, RPT-1"). Read-only, three queries.</summary>
public class ReportService(IAppDbContext db)
{
    private const int MinYear = 1900;

    public async Task<CostReportDto> CostsAsync(Guid userId, string? year, Guid? vehicleId, CancellationToken ct = default)
    {
        // A day of slack past UTC, as the dashboard: a client east of UTC asks for its new local year first.
        var maxYear = DateTime.UtcNow.AddDays(1).Year;
        if (!int.TryParse(year, NumberStyles.None, CultureInfo.InvariantCulture, out var y) || y < MinYear || y > maxYear)
        {
            throw new ValidationFailedException("report.invalidYear", $"The year must be a number from {MinYear} to {maxYear}.");
        }

        var vehicleQuery = db.Vehicles.Where(v => v.UserId == userId);
        if (vehicleId is { } id) vehicleQuery = vehicleQuery.Where(v => v.Id == id);
        var vehicles = await vehicleQuery.ToListAsync(ct);
        if (vehicleId is { } missing && vehicles.Count == 0)
        {
            throw new NotFoundException(nameof(Vehicle), missing);
        }
        var ids = vehicles.Select(v => v.Id).ToList();

        // shortcut: loads all of the user's non-voided records into memory, fine at personal-app scale; group in SQL if it gets slow.
        var records = await db.ServiceRecords.Where(r => ids.Contains(r.VehicleId) && !r.IsVoided)
            .Select(r => new { r.VehicleId, r.Date, Cost = InCents(r.TotalCost ?? 0), Priced = r.TotalCost != null,
                Categories = r.Tasks.Select(j => j.MaintenanceTask!.Category).ToList(),
                HasTires = db.Tires.Any(t => t.ServiceRecordId == r.Id) })
            .ToListAsync(ct);
        // The first reading by date, then save time.
        var firstKm = await db.OdometerReadings.Where(o => ids.Contains(o.VehicleId))
            .GroupBy(o => o.VehicleId)
            .Select(g => new { g.Key, g.OrderBy(o => o.ReadingDate).ThenBy(o => o.CreatedAt).First().ValueKm })
            .ToDictionaryAsync(g => g.Key, g => g.ValueKm, ct);

        var years = records.GroupBy(r => r.Date.Year).OrderByDescending(g => g.Key)
            .Select(g => new CostYearDto(g.Key, g.Sum(r => r.Cost), g.Count())).ToList();

        var inYear = records.Where(r => r.Date.Year == y).ToList();
        var byMonth = Enumerable.Range(1, 12).Select(m =>
        {
            var month = inYear.Where(r => r.Date.Month == m).ToList();
            return new CostMonthDto(m, month.Sum(r => r.Cost), month.Count);
        }).ToList();
        var byCategory = inYear.SelectMany(r => Split(r.Cost, r.Categories.Count == 0 && r.HasTires ? [TaskCategory.Tires] : r.Categories))
            .GroupBy(s => s.Category).Select(g => new CostCategoryDto(g.Key, g.Sum(s => s.Amount)))
            .Where(c => c.Total != 0).OrderByDescending(c => c.Total).ThenBy(c => c.Category?.ToString()).ToList();
        var byVehicle = vehicles.Select(v =>
            {
                var own = inYear.Where(r => r.VehicleId == v.Id).ToList();
                return new CostVehicleDto(v.Id, v.Nickname, v.IsArchived, own.Sum(r => r.Cost), own.Count);
            })
            .Where(c => c.Total != 0).OrderByDescending(c => c.Total).ThenBy(c => c.Nickname, StringComparer.InvariantCulture).ToList();

        var cars = vehicles.OrderBy(v => v.IsArchived).ThenBy(v => v.Nickname, StringComparer.InvariantCulture).Select(v =>
        {
            var serviceTotal = records.Where(r => r.VehicleId == v.Id).Sum(r => r.Cost);
            // An edited first reading can sit above the current odometer; that is no distance, not a negative one.
            var kmDriven = Math.Max(0, v.CurrentOdometerKm - firstKm.GetValueOrDefault(v.Id, v.CurrentOdometerKm));
            return new CostCarDto(v.Id, v.Nickname, v.IsArchived, serviceTotal, kmDriven,
                kmDriven == 0 ? null : Math.Round(serviceTotal / kmDriven, 4, MidpointRounding.AwayFromZero),
                v.PurchasePrice, v.PurchasePrice + serviceTotal);
        }).ToList();

        return new CostReportDto(years, y, inYear.Sum(r => r.Cost), inYear.Count, inYear.Count(r => !r.Priced),
            byMonth, byCategory, byVehicle, cars);
    }

    /// <summary>Money with its cents in the JSON: Postgres gives the 0 of a coalesce as 0.0, which SQL Server typed as 0.00. Adding 0.00 changes only the scale.</summary>
    public static decimal InCents(decimal value) => value + 0.00m;

    /// <summary>
    /// Splits a cost equally over the distinct categories (2 decimals, the remainder cents on the first category by name),
    /// so the parts add up to the cost. No categories: all of it under null (a Replace tires record, with no tasks, comes in as Tires).
    /// </summary>
    private static IEnumerable<(TaskCategory? Category, decimal Amount)> Split(decimal cost, IEnumerable<TaskCategory> categories)
    {
        var names = categories.Distinct().OrderBy(c => c.ToString(), StringComparer.Ordinal).ToList();
        if (names.Count == 0) return [(null, cost)];
        var share = Math.Round(cost / names.Count, 2, MidpointRounding.ToZero);
        return names.Select((c, i) => ((TaskCategory?)c, i == 0 ? cost - share * (names.Count - 1) : share));
    }
}
