using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Maintenance;

public class MaintenanceTaskService(IAppDbContext db, VehicleService vehicleService)
{
    public async Task<List<TaskTemplateDto>> TemplatesAsync(CancellationToken ct = default)
    {
        var templates = await db.TaskTemplates.OrderBy(t => t.Category).ThenBy(t => t.Key).ToListAsync(ct);
        return templates.Select(t => new TaskTemplateDto(t.Id, t.Key, t.Name, t.Category, t.DefaultIntervalKm, t.DefaultIntervalDays)).ToList();
    }

    public async Task<List<MaintenanceTaskDto>> ListAsync(Guid userId, Guid vehicleId, CancellationToken ct = default)
    {
        await vehicleService.FindOwnedAsync(userId, vehicleId, ct);

        // The client re-sorts names with a culture-aware compare in the UI language.
        var tasks = await db.MaintenanceTasks
            .Where(t => t.VehicleId == vehicleId)
            .OrderByDescending(t => t.IsEnabled)
            .ThenBy(t => t.Name)
            .ToListAsync(ct);

        return tasks.Select(ToDto).ToList();
    }

    public async Task<MaintenanceTaskDto> CreateAsync(Guid userId, Guid vehicleId, CreateMaintenanceTaskRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var (name, category) = Validate(vehicle, request.Name, request.Category, request.IntervalKm, request.IntervalDays,
            request.LastDoneOdometerKm, request.LastDoneDate);

        if (request.TemplateId is { } templateId && !await db.TaskTemplates.AnyAsync(t => t.Id == templateId, ct))
        {
            throw new ValidationFailedException("task.invalidTemplate", "The template doesn't exist.");
        }

        var task = new MaintenanceTask
        {
            VehicleId = vehicle.Id,
            TemplateId = request.TemplateId,
            Name = name,
            Category = category,
            IntervalKm = request.IntervalKm,
            IntervalDays = request.IntervalDays,
            LastDoneOdometerKm = request.LastDoneOdometerKm!.Value,
            LastDoneDate = request.LastDoneDate!.Value
        };
        db.MaintenanceTasks.Add(task);

        await db.SaveChangesAsync(ct);
        return ToDto(task);
    }

    public async Task<MaintenanceTaskDto> UpdateAsync(Guid userId, Guid vehicleId, Guid taskId, UpdateMaintenanceTaskRequest request, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        var task = await FindAsync(vehicle.Id, taskId, ct);
        var (name, category) = Validate(vehicle, request.Name, request.Category, request.IntervalKm, request.IntervalDays,
            request.LastDoneOdometerKm, request.LastDoneDate);

        task.Name = name;
        task.Category = category;
        task.IntervalKm = request.IntervalKm;
        task.IntervalDays = request.IntervalDays;
        task.LastDoneOdometerKm = request.LastDoneOdometerKm!.Value;
        task.LastDoneDate = request.LastDoneDate!.Value;
        task.IsEnabled = request.IsEnabled ?? task.IsEnabled;
        task.UpdatedAt = DateTimeOffset.UtcNow;

        await db.SaveChangesAsync(ct);
        return ToDto(task);
    }

    public async Task DeleteAsync(Guid userId, Guid vehicleId, Guid taskId, CancellationToken ct = default)
    {
        var vehicle = await vehicleService.FindOwnedAsync(userId, vehicleId, ct);
        db.MaintenanceTasks.Remove(await FindAsync(vehicle.Id, taskId, ct));
        await db.SaveChangesAsync(ct);
    }

    // Scoped to the owned vehicle, so another car's task id is simply not found.
    private async Task<MaintenanceTask> FindAsync(Guid vehicleId, Guid taskId, CancellationToken ct) =>
        await db.MaintenanceTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.VehicleId == vehicleId, ct)
        ?? throw new NotFoundException(nameof(MaintenanceTask), taskId);

    /// <summary>Checks every field before anything changes, so a failed check saves nothing. Returns the trimmed name and parsed category.</summary>
    private static (string Name, TaskCategory Category) Validate(Vehicle vehicle, string? name, string? category,
        int? intervalKm, int? intervalDays, decimal? lastDoneKm, DateOnly? lastDoneDate)
    {
        var trimmed = name?.Trim() ?? "";
        if (trimmed.Length is 0 or > MaintenanceTask.MaxNameLength)
        {
            throw new ValidationFailedException("task.nameRequired", $"The name must be 1 to {MaintenanceTask.MaxNameLength} characters.");
        }

        // Exact enum names only: Enum.TryParse would also accept numbers like "3".
        if (category is null || !Enum.GetNames<TaskCategory>().Contains(category))
        {
            throw new ValidationFailedException("task.invalidCategory", "The category is not valid.");
        }

        if (intervalKm is null && intervalDays is null)
        {
            throw new ValidationFailedException("task.intervalRequired", "Set a km interval, a time interval, or both.");
        }

        if (intervalKm is < 1 or > MaintenanceTask.MaxIntervalKm || intervalDays is < 1 or > MaintenanceTask.MaxIntervalDays)
        {
            throw new ValidationFailedException("task.invalidInterval",
                $"The km interval must be 1 to {MaintenanceTask.MaxIntervalKm} and the time interval 1 to {MaintenanceTask.MaxIntervalDays} days.");
        }

        if (lastDoneKm is null || lastDoneKm < 0 || lastDoneKm > vehicle.CurrentOdometerKm || lastDoneDate is null)
        {
            throw new ValidationFailedException("task.invalidLastDone",
                $"Last done needs a date and a km value from 0 to the car's current odometer ({vehicle.CurrentOdometerKm} km).")
            {
                Extensions = { ["currentKm"] = vehicle.CurrentOdometerKm }
            };
        }

        // Same one day of slack as odometer readings (Israel is ahead of UTC).
        if (lastDoneDate > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1))
        {
            throw new ValidationFailedException("task.futureDate", "The last done date can't be in the future.");
        }

        return (trimmed, Enum.Parse<TaskCategory>(category));
    }

    private static MaintenanceTaskDto ToDto(MaintenanceTask t) => new(t.Id, t.VehicleId, t.TemplateId, t.Name, t.Category,
        t.IntervalKm, t.IntervalDays, t.DueSoonPercent, t.IsEnabled, t.LastDoneOdometerKm, t.LastDoneDate);
}
