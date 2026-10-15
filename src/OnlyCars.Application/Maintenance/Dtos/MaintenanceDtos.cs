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

// Every field is optional: no date means UTC today; no cost or notes saves null.
public record ResetTaskRequest(DateOnly? Date = null, decimal? Cost = null, string? Notes = null);

public record ResetTaskResponse(Guid ServiceRecordId, MaintenanceTaskDto Task);

public record ServiceRecordTaskDto(Guid Id, string Name, TaskCategory Category);

// A null ShopName is DIY; a null TotalCost was skipped. Tasks are the linked tasks that still exist.
public record ServiceRecordDto(Guid Id, DateOnly Date, decimal OdometerKm, string? ShopName, decimal? TotalCost, string? Notes,
    List<ServiceRecordTaskDto> Tasks, List<ServiceItemDto> Items);

// In the user's order. On a labour row Quantity is hours.
public record ServiceItemDto(Guid Id, string Description, string? Brand, string? PartNumber, decimal Quantity, decimal UnitCost, bool IsLabor);

// Quantity and UnitCost are nullable only so a missing value gets a coded error.
public record ServiceItemRequest(string? Description, string? Brand, string? PartNumber, decimal? Quantity, decimal? UnitCost, bool IsLabor = false);

// With items, TotalCost is ignored and computed from them; Items replaces the whole list (null or empty clears it).
public record UpdateServiceRecordRequest(string? ShopName, decimal? TotalCost, string? Notes, List<ServiceItemRequest>? Items);

// Date and OdometerKm are nullable only so a missing value gets a coded error (a missing date means UTC today, as for readings).
public record CreateServiceRecordRequest(
    DateOnly? Date,
    decimal? OdometerKm,
    string? ShopName,
    decimal? TotalCost,
    string? Notes,
    List<Guid>? TaskIds,
    bool ConfirmCorrection = false,
    List<ServiceItemRequest>? Items = null);

public record CreateServiceRecordResponse(ServiceRecordDto Record, List<MaintenanceTaskDto> Tasks);
