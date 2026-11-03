using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Tires;
using OnlyCars.Application.Tires.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class TiresController(TireService tireService) : ControllerBase
{
    [HttpGet("vehicles/{vehicleId:guid}/tires")]
    public async Task<ActionResult<VehicleTiresDto>> VehicleTires(Guid vehicleId, CancellationToken ct) =>
        Ok(await tireService.GetVehicleTiresAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tires/replace")]
    public async Task<ActionResult<VehicleTiresDto>> Replace(Guid vehicleId, ReplaceTiresRequest request, CancellationToken ct) =>
        Ok(await tireService.ReplaceAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpPut("tires/{id:guid}")]
    public async Task<ActionResult<TireDto>> Update(Guid id, UpdateTireRequest request, CancellationToken ct) =>
        Ok(await tireService.UpdateAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("tires/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await tireService.DeleteAsync(User.GetUserId(), id, ct);
        return NoContent();
    }

    [HttpGet("vehicles/{vehicleId:guid}/tires/checks")]
    public async Task<ActionResult<List<TireCheckDto>>> Checks(Guid vehicleId, CancellationToken ct) =>
        Ok(await tireService.ListChecksAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tires/checks")]
    public async Task<ActionResult<TireCheckDto>> AddCheck(Guid vehicleId, TireCheckRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await tireService.AddCheckAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpDelete("vehicles/{vehicleId:guid}/tires/checks/{measuredAt}")]
    public async Task<IActionResult> DeleteCheck(Guid vehicleId, DateOnly measuredAt, CancellationToken ct)
    {
        await tireService.DeleteCheckAsync(User.GetUserId(), vehicleId, measuredAt, ct);
        return NoContent();
    }

    [HttpGet("vehicles/{vehicleId:guid}/tires/rotations")]
    public async Task<ActionResult<List<TireRotationDto>>> Rotations(Guid vehicleId, CancellationToken ct) =>
        Ok(await tireService.ListRotationsAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tires/rotations")]
    public async Task<ActionResult<TireRotationDto>> AddRotation(Guid vehicleId, TireRotationRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await tireService.AddRotationAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpDelete("tire-rotations/{id:guid}")]
    public async Task<IActionResult> DeleteRotation(Guid id, CancellationToken ct)
    {
        await tireService.DeleteRotationAsync(User.GetUserId(), id, ct);
        return NoContent();
    }
}
