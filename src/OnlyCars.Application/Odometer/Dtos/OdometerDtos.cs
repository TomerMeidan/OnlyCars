using OnlyCars.Domain;

namespace OnlyCars.Application.Odometer.Dtos;

public record OdometerReadingDto(Guid Id, Guid VehicleId, decimal ValueKm, DateOnly ReadingDate, OdometerSource Source);

public record AddOdometerReadingRequest(decimal ValueKm, DateOnly? ReadingDate, bool ConfirmCorrection = false);
