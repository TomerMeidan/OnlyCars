using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Devices.Dtos;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Vehicles;

namespace OnlyCars.Api.Controllers;

/// <summary>
/// Everything a device token can do (OBD-1): list the account's cars and add an odometer reading to one.
/// A sign-in token is refused here, and a device token is refused everywhere else.
/// </summary>
[ApiController]
[Authorize(AuthenticationSchemes = DeviceTokenAuthHandler.SchemeName)]
[Route("api/device")]
public class DeviceController(VehicleService vehicleService, OdometerService odometerService) : ControllerBase
{
    [HttpGet("vehicles")]
    public async Task<ActionResult<List<DeviceVehicleDto>>> Vehicles(CancellationToken ct)
    {
        var vehicles = await vehicleService.ListAsync(User.GetUserId(), includeArchived: false, ct);
        return Ok(vehicles.Select(v => new DeviceVehicleDto(v.Id, v.Nickname, v.Make, v.Model, v.Year, v.Plate, v.CurrentOdometerKm)).ToList());
    }

    /// <summary>
    /// Same rules as a typed reading (date order, the cap, a repeated clientRequestId), stored with source Obd. A device can't
    /// confirm a correction, so it can never put a lower reading after a higher one, and it can't add to an archived car.
    /// </summary>
    [HttpPost("vehicles/{vehicleId:guid}/odometer")]
    public async Task<ActionResult<OdometerReadingDto>> AddReading(Guid vehicleId, AddOdometerReadingRequest request, CancellationToken ct) =>
        Ok(await odometerService.AddFromDeviceAsync(User.GetUserId(), vehicleId, request with { ConfirmCorrection = false }, ct));
}
