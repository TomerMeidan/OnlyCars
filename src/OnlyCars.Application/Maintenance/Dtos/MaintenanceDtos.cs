using OnlyCars.Domain;

namespace OnlyCars.Application.Maintenance.Dtos;

public record TaskTemplateDto(Guid Id, string Key, string Name, TaskCategory Category, int? DefaultIntervalKm, int? DefaultIntervalDays);

public record MaintenanceTaskDto(
    Guid Id,
    Guid VehicleId,
    Guid? TemplateId,
    string Name,
    TaskCategory Category,
    int? IntervalKm,
    int? IntervalDays,
    int DueSoonPercent,
    bool IsEnabled,
    decimal LastDoneOdometerKm,
    DateOnly LastDoneDate);

// Category is a string so an unknown value gets task.invalidCategory instead of a model-binding 400.
// LastDone* are nullable only so a missing value gets a coded error instead of 0 / 0001-01-01.
public record CreateMaintenanceTaskRequest(
    Guid? TemplateId,
    string? Name,
    string? Category,
    int? IntervalKm,
    int? IntervalDays,
    decimal? LastDoneOdometerKm,
    DateOnly? LastDoneDate);

// A null IsEnabled keeps the task's current value.
public record UpdateMaintenanceTaskRequest(
    string? Name,
    string? Category,
    int? IntervalKm,
    int? IntervalDays,
    decimal? LastDoneOdometerKm,
    DateOnly? LastDoneDate,
    bool? IsEnabled);
