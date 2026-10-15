using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using OnlyCars.Api.Common;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api")]
public class MaintenanceTasksController(MaintenanceTaskService taskService) : ControllerBase
{
    [HttpGet("task-templates")]
    public async Task<ActionResult<List<TaskTemplateDto>>> Templates(CancellationToken ct) =>
        Ok(await taskService.TemplatesAsync(ct));

    [HttpGet("vehicles/{vehicleId:guid}/tasks")]
    public async Task<ActionResult<List<MaintenanceTaskDto>>> List(Guid vehicleId, CancellationToken ct) =>
        Ok(await taskService.ListAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tasks")]
    public async Task<ActionResult<MaintenanceTaskDto>> Create(Guid vehicleId, CreateMaintenanceTaskRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await taskService.CreateAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpPut("vehicles/{vehicleId:guid}/tasks/{taskId:guid}")]
    public async Task<ActionResult<MaintenanceTaskDto>> Update(Guid vehicleId, Guid taskId, UpdateMaintenanceTaskRequest request, CancellationToken ct) =>
        Ok(await taskService.UpdateAsync(User.GetUserId(), vehicleId, taskId, request, ct));

    [HttpDelete("vehicles/{vehicleId:guid}/tasks/{taskId:guid}")]
    public async Task<IActionResult> Delete(Guid vehicleId, Guid taskId, CancellationToken ct)
    {
        await taskService.DeleteAsync(User.GetUserId(), vehicleId, taskId, ct);
        return NoContent();
    }

    [HttpPost("vehicles/{vehicleId:guid}/tasks/{taskId:guid}/reset")]
    public async Task<ActionResult<ResetTaskResponse>> Reset(Guid vehicleId, Guid taskId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ResetTaskRequest? request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await taskService.ResetAsync(User.GetUserId(), vehicleId, taskId, request, ct));

    [HttpGet("vehicles/{vehicleId:guid}/service-records")]
    public async Task<ActionResult<List<ServiceRecordDto>>> Records(Guid vehicleId, CancellationToken ct) =>
        Ok(await taskService.ListRecordsAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/service-records")]
    public async Task<ActionResult<CreateServiceRecordResponse>> CreateRecord(Guid vehicleId, CreateServiceRecordRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await taskService.CreateRecordAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpPut("vehicles/{vehicleId:guid}/service-records/{recordId:guid}")]
    public async Task<ActionResult<ServiceRecordDto>> UpdateRecord(Guid vehicleId, Guid recordId, UpdateServiceRecordRequest request, CancellationToken ct) =>
        Ok(await taskService.UpdateRecordAsync(User.GetUserId(), vehicleId, recordId, request, ct));

    [HttpPost("vehicles/{vehicleId:guid}/service-records/{recordId:guid}/void")]
    public async Task<ActionResult<List<MaintenanceTaskDto>>> Void(Guid vehicleId, Guid recordId, CancellationToken ct) =>
        Ok(await taskService.VoidAsync(User.GetUserId(), vehicleId, recordId, ct));
}
