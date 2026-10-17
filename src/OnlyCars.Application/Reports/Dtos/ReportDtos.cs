using OnlyCars.Domain;

namespace OnlyCars.Application.Reports.Dtos;

public record CostYearDto(int Year, decimal Total, int RecordCount);

public record CostMonthDto(int Month, decimal Total, int RecordCount);

// Category is null for records with no tasks.
public record CostCategoryDto(TaskCategory? Category, decimal Total);

public record CostVehicleDto(Guid VehicleId, string Nickname, bool IsArchived, decimal Total, int RecordCount);

// All time. CostPerKm is null when KmDriven is 0; TotalCostOfOwnership is null when PurchasePrice is not set.
public record CostCarDto(Guid VehicleId, string Nickname, bool IsArchived, decimal ServiceTotal, decimal KmDriven, decimal? CostPerKm,
    decimal? PurchasePrice, decimal? TotalCostOfOwnership);

public record CostReportDto(List<CostYearDto> Years, int Year, decimal Total, int RecordCount, int UnpricedCount,
    List<CostMonthDto> ByMonth, List<CostCategoryDto> ByCategory, List<CostVehicleDto> ByVehicle, List<CostCarDto> Cars);
