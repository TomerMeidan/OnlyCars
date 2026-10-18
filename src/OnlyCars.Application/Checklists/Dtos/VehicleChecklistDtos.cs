using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Domain;

namespace OnlyCars.Application.Checklists.Dtos;

// Status, Remaining* and Progress follow the task rules with a 10% due-soon threshold; all null when off or manual only (no intervals).
public record VehicleChecklistDto(
    Guid Id,
    Guid VehicleId,
    Guid TemplateId,
    string Name,
    int ItemCount,
    int? IntervalKm,
    int? IntervalDays,
    bool IsEnabled,
    DateOnly LastRunDate,
    decimal LastRunOdometerKm,
    int RunCount,
    DueStatus? Status,
    decimal? RemainingKm,
    int? RemainingDays,
    double? Progress);

// TemplateId is nullable only so a missing value gets a coded error; Date is the client's local date (null is UTC today).
public record AttachChecklistRequest(Guid? TemplateId, int? IntervalKm, int? IntervalDays, DateOnly? Date);

// Null intervals mean none (both null is manual only); a null IsEnabled keeps the current value.
public record UpdateVehicleChecklistRequest(int? IntervalKm, int? IntervalDays, bool? IsEnabled);

// Label, Type, Unit, MinValue and MaxValue are as they were at run time; TemplateItemId is null once the template item is deleted.
// IssueId is the to-do created from this item (MVP5-C), null when none.
public record ChecklistRunItemDto(Guid Id, Guid? TemplateItemId, string Label, ChecklistItemType Type, string? Unit, decimal? MinValue,
    decimal? MaxValue, bool? BoolValue, decimal? NumberValue, string? TextValue, bool IsFlagged, Guid? IssueId);

// OdometerReadingId is the Checklist reading the run logged, null when no odometer was entered (OdometerKm is then the car's odometer).
// Attachments are the run's photos (FILE-3), oldest first, in the service record shape.
public record ChecklistRunDto(Guid Id, Guid VehicleChecklistId, DateOnly RunAt, decimal OdometerKm, Guid? OdometerReadingId, string? Notes,
    int FlaggedCount, List<ChecklistRunItemDto> Items, List<AttachmentDto> Attachments);

public record ChecklistRunItemRequest(Guid? TemplateItemId, bool? BoolValue, decimal? NumberValue, string? TextValue, bool IsFlagged = false);

// Items must be exactly the template's current items, in any order. A null RunAt is UTC today; a null OdometerKm logs no reading.
public record CreateChecklistRunRequest(DateOnly? RunAt, decimal? OdometerKm, string? Notes, List<ChecklistRunItemRequest?>? Items,
    bool ConfirmCorrection = false);

public record CreateChecklistRunResponse(ChecklistRunDto Run, VehicleChecklistDto Checklist);
