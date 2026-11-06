using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Domain;

namespace OnlyCars.Application.Maintenance.Dtos;

public record TaskTemplateDto(Guid Id, string Key, string Name, TaskCategory Category, int? DefaultIntervalKm, int? DefaultIntervalDays);

// Status, Remaining*, Progress and PredictedDueDate are computed on read (TaskStatusCalculator) and are all null for a disabled task.
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
    double? Progress,
    DateOnly? PredictedDueDate);

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

// Every field is optional: no date means the ?today= query (else UTC today); no cost or notes saves null.
public record ResetTaskRequest(DateOnly? Date = null, decimal? Cost = null, string? Notes = null);

public record ResetTaskResponse(Guid ServiceRecordId, MaintenanceTaskDto Task);

public record ServiceRecordTaskDto(Guid Id, string Name, TaskCategory Category);

// A null ShopName is DIY; a null TotalCost was skipped. Tasks are the linked tasks that still exist. TireCount > 0 marks a tire change.
public record ServiceRecordDto(Guid Id, DateOnly Date, decimal OdometerKm, string? ShopName, decimal? TotalCost, string? Notes,
    List<ServiceRecordTaskDto> Tasks, List<ServiceItemDto> Items, Guid VehicleId, List<AttachmentDto> Attachments, int TireCount);

// Url is a signed GET URL valid for 1 hour (inline, with FileName), or null without storage; the storage key is never returned.
public record AttachmentDto(Guid Id, string FileName, string ContentType, long SizeBytes, string? Url);

// One page of GET /api/service-records; the totals cover every match, not just the page. TotalCost counts null costs as 0;
// AverageCost leaves them out (null when no match has a cost) and is rounded to cents; LastDate is null when nothing matches.
public record ServiceRecordPageDto(List<ServiceRecordDto> Items, int TotalCount, decimal TotalCost, decimal? AverageCost, DateOnly? LastDate);

// In the user's order. On a labour row Quantity is hours.
public record ServiceItemDto(Guid Id, string Description, string? Brand, string? PartNumber, decimal Quantity, decimal UnitCost, bool IsLabor);

// Quantity and UnitCost are nullable only so a missing value gets a coded error.
public record ServiceItemRequest(string? Description, string? Brand, string? PartNumber, decimal? Quantity, decimal? UnitCost, bool IsLabor = false);

// With items, TotalCost is ignored and computed from them; Items replaces the whole list (null or empty clears it).
// Date, OdometerKm and TaskIds (MVP3-D) keep the record's value when null; TaskIds: [] removes every task.
public record UpdateServiceRecordRequest(string? ShopName, decimal? TotalCost, string? Notes, List<ServiceItemRequest>? Items,
    DateOnly? Date = null, decimal? OdometerKm = null, List<Guid>? TaskIds = null, bool ConfirmCorrection = false);

// Date and OdometerKm are nullable only so a missing value gets a coded error (a missing date means the ?today= query, else UTC today).
public record CreateServiceRecordRequest(
    DateOnly? Date,
    decimal? OdometerKm,
    string? ShopName,
    decimal? TotalCost,
    string? Notes,
    List<Guid>? TaskIds,
    bool ConfirmCorrection = false,
    List<ServiceItemRequest>? Items = null);

// On POST, Tasks are the linked tasks; on PUT, every task of the car (an edit can move removed tasks too).
public record CreateServiceRecordResponse(ServiceRecordDto Record, List<MaintenanceTaskDto> Tasks);

// Tasks are the vehicle's enabled tasks in urgency order (Overdue, Due soon, OK; then progress descending; then name).
// Checklists (MVP5-B) are its enabled checklists, most urgent first as on GET /api/vehicles/{id}/checklists; they never count in the totals.
// OpenIssueCount (MVP5-C) is its open to-dos; never in the totals.
public record DashboardVehicleDto(Guid Id, string Nickname, string? Make, string? Model, int? Year, decimal CurrentOdometerKm,
    int OverdueCount, int DueSoonCount, List<MaintenanceTaskDto> Tasks, List<VehicleChecklistDto> Checklists, int OpenIssueCount);

// Month is "YYYY-MM"; the month figures cover the first of that month to the client's today, archived cars included.
public record DashboardDto(int OverdueCount, int DueSoonCount, string Month, decimal MonthTotalCost, int MonthServiceCount,
    List<DashboardVehicleDto> Vehicles);
