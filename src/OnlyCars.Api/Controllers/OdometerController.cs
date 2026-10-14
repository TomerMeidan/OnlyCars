using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/vehicles/{vehicleId:guid}/odometer")]
public class OdometerController(OdometerService odometerService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<OdometerReadingDto>>> History(Guid vehicleId, CancellationToken ct)
    {
        var readings = await odometerService.HistoryAsync(User.GetUserId(), vehicleId, ct);
        return Ok(readings);
    }

    [HttpPost]
    public async Task<ActionResult<OdometerReadingDto>> Add(Guid vehicleId, AddOdometerReadingRequest request, CancellationToken ct)
    {
        var reading = await odometerService.AddAsync(User.GetUserId(), vehicleId, request, ct);
        return Ok(reading);
    }

    [HttpPut("{readingId:guid}")]
    public async Task<ActionResult<OdometerReadingDto>> Update(Guid vehicleId, Guid readingId, UpdateOdometerReadingRequest request, CancellationToken ct)
    {
        var reading = await odometerService.UpdateAsync(User.GetUserId(), vehicleId, readingId, request, ct);
        return Ok(reading);
    }

    [HttpDelete("{readingId:guid}")]
    public async Task<IActionResult> Delete(Guid vehicleId, Guid readingId, CancellationToken ct)
    {
        await odometerService.DeleteAsync(User.GetUserId(), vehicleId, readingId, ct);
        return NoContent();
    }
}
