using OnlyCars.Domain;

namespace OnlyCars.Application.Maintenance.Dtos;

public record TaskTemplateDto(Guid Id, string Key, string Name, TaskCategory Category, int? DefaultIntervalKm, int? DefaultIntervalDays);

// Status, Remaining* and Progress are computed on read (TaskStatusCalculator) and are all null for a disabled task.
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
    DateOnly LastDoneDate,
    DueStatus? Status,
    decimal? RemainingKm,
    int? RemainingDays,
    double? Progress);

// Category is a string so an unknown value gets task.invalidCategory instead of a model-binding 400.
// LastDone* are nullable only so a missing value gets a coded error instead of 0 / 0001-01-01.
// A null DueSoonPercent saves the default.
public record CreateMaintenanceTaskRequest(
    Guid? TemplateId,
    string? Name,
    string? Category,
    int? IntervalKm,
    int? IntervalDays,
    decimal? LastDoneOdometerKm,
    DateOnly? LastDoneDate,
    int? DueSoonPercent = null);

// A null IsEnabled or DueSoonPercent keeps the task's current value, so an older client's toggle can't reset it.
public record UpdateMaintenanceTaskRequest(
    string? Name,
    string? Category,
    int? IntervalKm,
    int? IntervalDays,
    decimal? LastDoneOdometerKm,
    DateOnly? LastDoneDate,
    bool? IsEnabled,
    int? DueSoonPercent = null);
