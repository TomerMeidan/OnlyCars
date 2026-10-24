using OnlyCars.Domain;

namespace OnlyCars.Application.Odometer.Dtos;

public record OdometerReadingDto(Guid Id, Guid VehicleId, decimal ValueKm, DateOnly ReadingDate, OdometerSource Source);

// A repeated ClientRequestId on the same car returns the reading saved with it (OFF-1).
public record AddOdometerReadingRequest(decimal ValueKm, DateOnly? ReadingDate, bool ConfirmCorrection = false, Guid? ClientRequestId = null);

// A null ReadingDate keeps the reading's current date.
public record UpdateOdometerReadingRequest(decimal ValueKm, DateOnly? ReadingDate, bool ConfirmCorrection = false);
