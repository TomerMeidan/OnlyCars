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
}
