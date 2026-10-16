using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class VehicleChecklistsController(VehicleChecklistService checklistService) : ControllerBase
{
    [HttpGet("vehicles/{vehicleId:guid}/checklists")]
    public async Task<ActionResult<List<VehicleChecklistDto>>> List(Guid vehicleId, CancellationToken ct) =>
        Ok(await checklistService.ListAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/checklists")]
    public async Task<ActionResult<VehicleChecklistDto>> Attach(Guid vehicleId, AttachChecklistRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await checklistService.AttachAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpPut("vehicle-checklists/{id:guid}")]
    public async Task<ActionResult<VehicleChecklistDto>> Update(Guid id, UpdateVehicleChecklistRequest request, CancellationToken ct) =>
        Ok(await checklistService.UpdateAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("vehicle-checklists/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await checklistService.DeleteAsync(User.GetUserId(), id, ct);
        return NoContent();
    }

    [HttpGet("vehicle-checklists/{id:guid}/runs")]
    public async Task<ActionResult<List<ChecklistRunDto>>> Runs(Guid id, CancellationToken ct) =>
        Ok(await checklistService.ListRunsAsync(User.GetUserId(), id, ct));

    [HttpPost("vehicle-checklists/{id:guid}/runs")]
    public async Task<ActionResult<CreateChecklistRunResponse>> CreateRun(Guid id, CreateChecklistRunRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await checklistService.CreateRunAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("checklist-runs/{id:guid}")]
    public async Task<IActionResult> DeleteRun(Guid id, CancellationToken ct)
    {
        await checklistService.DeleteRunAsync(User.GetUserId(), id, ct);
        return NoContent();
    }
}
