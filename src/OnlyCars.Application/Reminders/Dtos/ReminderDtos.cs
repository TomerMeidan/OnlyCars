using OnlyCars.Domain;

namespace OnlyCars.Application.Reminders.Dtos;

// DaysLeft is ExpiryDate - today: 0 expires today, negative expired that many days ago.
public record VehicleDocumentDto(Guid Id, Guid VehicleId, VehicleDocumentType Type, DateOnly ExpiryDate, decimal? Cost, string? Notes,
    DocumentStatus Status, int DaysLeft);

// Type is a string so a bad value is a coded 400 instead of a model-binding error.
public record VehicleDocumentRequest(string? Type, DateOnly? ExpiryDate, decimal? Cost, string? Notes);

// Status is a DueStatus (Overdue, DueSoon) for tasks and checklists or a DocumentStatus (Expired, Expiring) for documents.
public record ReminderDto(NotificationKind Kind, Guid RefId, Guid VehicleId, string VehicleNickname, string? Name, VehicleDocumentType? DocumentType,
    string Status, DateOnly? DueDate, decimal? RemainingKm, int? RemainingDays);

// OpenToDos: the open to-dos of active cars, newest first, shown after the items in Needs attention (owner, 2026-10-30); never snoozed.
public record RemindersDto(int LeadDays, int SnoozedCount, List<ReminderDto> Items, List<OpenToDoDto> OpenToDos);

public record OpenToDoDto(Guid Id, Guid VehicleId, string VehicleNickname, string Title);

public record SnoozeRequest(string? Kind, Guid RefId, int Days, DateOnly? Today);

public record SnoozeDto(NotificationKind Kind, Guid RefId, DateOnly SnoozedUntil);
