using OnlyCars.Domain;

namespace OnlyCars.Application.Account.Dtos;

// The data export (ACC-1, decisions.md "Data export, ACC-1"). Never add a storage key, signed URL, password hash or login data here.
public record ExportDto(int FormatVersion, DateTimeOffset ExportedAt, ExportUnitsDto Units, ExportAccountDto Account,
    List<ExportVehicleDto> Vehicles, List<ExportChecklistTemplateDto> ChecklistTemplates, List<ExportTireSetDto> TireSets);

public record ExportUnitsDto(string Distance, string Currency);

public record ExportAccountDto(string Email, DistanceUnit DistanceUnit, string Currency, Locale Locale, Theme Theme, int ReminderLeadDays,
    DateTimeOffset CreatedAt);

public record ExportVehicleDto(Guid Id, string Nickname, string? Make, string? Model, int? Year, string? Vin, string? Plate,
    FuelType? FuelType, DateOnly? PurchaseDate, decimal? PurchasePrice, decimal CurrentOdometerKm, bool IsArchived,
    DateTimeOffset? ArchivedAt, bool HasPhoto, DateTimeOffset CreatedAt,
    List<ExportOdometerReadingDto> OdometerReadings, List<ExportMaintenanceTaskDto> MaintenanceTasks,
    List<ExportServiceRecordDto> ServiceRecords, List<ExportChecklistDto> Checklists, List<ExportIssueDto> Issues,
    List<ExportDocumentDto> Documents);

public record ExportOdometerReadingDto(Guid Id, decimal ValueKm, DateOnly ReadingDate, OdometerSource Source, Guid? ServiceRecordId);

public record ExportMaintenanceTaskDto(Guid Id, string? TemplateKey, string Name, TaskCategory Category, int? IntervalKm,
    int? IntervalDays, int DueSoonPercent, bool IsEnabled, decimal LastDoneOdometerKm, DateOnly LastDoneDate);

public record ExportServiceRecordDto(Guid Id, DateOnly Date, decimal OdometerKm, string? ShopName, decimal? TotalCost, string? Notes,
    bool IsVoided, List<Guid> TaskIds, List<ExportServiceItemDto> Items, List<ExportFileDto> Attachments);

public record ExportServiceItemDto(string Description, string? Brand, string? PartNumber, decimal Quantity, decimal UnitCost, bool IsLabor);

/// <summary>A stored file by name only; the file itself is not exported.</summary>
public record ExportFileDto(string FileName, string ContentType, long SizeBytes, DateTimeOffset CreatedAt);

public record ExportChecklistDto(Guid Id, Guid TemplateId, int? IntervalKm, int? IntervalDays, decimal LastRunOdometerKm,
    DateOnly LastRunDate, DateOnly StartDate, decimal StartOdometerKm, bool IsEnabled, List<ExportChecklistRunDto> Runs);

public record ExportChecklistRunDto(Guid Id, DateOnly RunAt, decimal OdometerKm, Guid? OdometerReadingId, string? Notes, List<ExportRunItemDto> Items,
    List<ExportFileDto> Photos);

public record ExportRunItemDto(Guid Id, Guid? TemplateItemId, string Label, ChecklistItemType Type, string? Unit, decimal? MinValue,
    decimal? MaxValue, bool? BoolValue,
    decimal? NumberValue, string? TextValue, bool IsFlagged);

public record ExportIssueDto(Guid Id, string Title, string? Description, IssueStatus Status, Guid? SourceRunItemId, DateOnly? ResolvedAt,
    DateTimeOffset CreatedAt);

public record ExportDocumentDto(Guid Id, VehicleDocumentType Type, DateOnly ExpiryDate, decimal? Cost, string? Notes);

public record ExportChecklistTemplateDto(Guid Id, string Name, List<ExportTemplateItemDto> Items);

public record ExportTemplateItemDto(Guid Id, string Label, ChecklistItemType Type, string? Unit, decimal? MinValue, decimal? MaxValue,
    int SortOrder);

public record ExportTireSetDto(Guid Id, string Brand, string? Model, string? Size, TireSeason Season, DateOnly? PurchaseDate,
    string? DotCode, string? Notes, List<ExportTireMountDto> Mounts);

public record ExportTireMountDto(Guid VehicleId, DateOnly MountedAt, decimal MountOdometerKm, DateOnly? UnmountedAt,
    decimal? UnmountOdometerKm, decimal KmDriven, List<ExportTireCheckDto> Checks, List<ExportTireRotationDto> Rotations);

public record ExportTireCheckDto(DateOnly MeasuredAt, List<ExportTireMeasurementDto> Measurements);

public record ExportTireMeasurementDto(TirePosition Position, decimal? PressureBar, decimal? TreadDepthMm);

public record ExportTireRotationDto(DateOnly Date, decimal OdometerKm, string? Notes);
