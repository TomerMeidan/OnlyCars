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
    [HttpGet("tire-sets")]
    public async Task<ActionResult<List<TireSetDto>>> List(CancellationToken ct) =>
        Ok(await tireService.ListAsync(User.GetUserId(), ct));

    [HttpPost("tire-sets")]
    public async Task<ActionResult<TireSetDto>> Create(TireSetRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await tireService.CreateAsync(User.GetUserId(), request, ct));

    [HttpPut("tire-sets/{id:guid}")]
    public async Task<ActionResult<TireSetDto>> Update(Guid id, TireSetRequest request, CancellationToken ct) =>
        Ok(await tireService.UpdateAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("tire-sets/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await tireService.DeleteAsync(User.GetUserId(), id, ct);
        return NoContent();
    }

    [HttpGet("tire-sets/{id:guid}/mounts")]
    public async Task<ActionResult<List<TireMountDto>>> Mounts(Guid id, CancellationToken ct) =>
        Ok(await tireService.ListMountsAsync(User.GetUserId(), id, ct));

    [HttpGet("vehicles/{vehicleId:guid}/tires")]
    public async Task<ActionResult<VehicleTiresDto>> VehicleTires(Guid vehicleId, CancellationToken ct) =>
        Ok(await tireService.GetVehicleTiresAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tires/mount")]
    public async Task<ActionResult<VehicleTiresDto>> Mount(Guid vehicleId, MountTireSetRequest request, CancellationToken ct) =>
        Ok(await tireService.MountAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tires/unmount")]
    public async Task<ActionResult<VehicleTiresDto>> Unmount(Guid vehicleId, UnmountTireSetRequest request, CancellationToken ct) =>
        Ok(await tireService.UnmountAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpDelete("tire-mounts/{id:guid}")]
    public async Task<IActionResult> DeleteMount(Guid id, CancellationToken ct)
    {
        await tireService.DeleteMountAsync(User.GetUserId(), id, ct);
        return NoContent();
    }

    [HttpGet("tire-mounts/{id:guid}/checks")]
    public async Task<ActionResult<List<TireCheckDto>>> Checks(Guid id, CancellationToken ct) =>
        Ok(await tireService.ListChecksAsync(User.GetUserId(), id, ct));

    [HttpPost("tire-mounts/{id:guid}/checks")]
    public async Task<ActionResult<TireCheckDto>> AddCheck(Guid id, TireCheckRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await tireService.AddCheckAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("tire-mounts/{id:guid}/checks/{measuredAt}")]
    public async Task<IActionResult> DeleteCheck(Guid id, DateOnly measuredAt, CancellationToken ct)
    {
        await tireService.DeleteCheckAsync(User.GetUserId(), id, measuredAt, ct);
        return NoContent();
    }

    [HttpGet("tire-mounts/{id:guid}/rotations")]
    public async Task<ActionResult<List<TireRotationDto>>> Rotations(Guid id, CancellationToken ct) =>
        Ok(await tireService.ListRotationsAsync(User.GetUserId(), id, ct));

    [HttpPost("tire-mounts/{id:guid}/rotations")]
    public async Task<ActionResult<TireRotationDto>> AddRotation(Guid id, TireRotationRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await tireService.AddRotationAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("tire-rotations/{id:guid}")]
    public async Task<IActionResult> DeleteRotation(Guid id, CancellationToken ct)
    {
        await tireService.DeleteRotationAsync(User.GetUserId(), id, ct);
        return NoContent();
    }
}
