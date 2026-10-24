using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using OnlyCars.Api.Common;
using OnlyCars.Application.Common;
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
    public async Task<ActionResult<List<MaintenanceTaskDto>>> List(Guid vehicleId, [FromQuery] DateOnly? today, CancellationToken ct) =>
        Ok(await taskService.ListAsync(User.GetUserId(), vehicleId, today, ct));

    [HttpPost("vehicles/{vehicleId:guid}/tasks")]
    public async Task<ActionResult<MaintenanceTaskDto>> Create(Guid vehicleId, CreateMaintenanceTaskRequest request, [FromQuery] DateOnly? today,
        CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await taskService.CreateAsync(User.GetUserId(), vehicleId, request, today, ct));

    [HttpPut("vehicles/{vehicleId:guid}/tasks/{taskId:guid}")]
    public async Task<ActionResult<MaintenanceTaskDto>> Update(Guid vehicleId, Guid taskId, UpdateMaintenanceTaskRequest request,
        [FromQuery] DateOnly? today, CancellationToken ct) =>
        Ok(await taskService.UpdateAsync(User.GetUserId(), vehicleId, taskId, request, today, ct));

    [HttpDelete("vehicles/{vehicleId:guid}/tasks/{taskId:guid}")]
    public async Task<IActionResult> Delete(Guid vehicleId, Guid taskId, CancellationToken ct)
    {
        await taskService.DeleteAsync(User.GetUserId(), vehicleId, taskId, ct);
        return NoContent();
    }

    [HttpPost("vehicles/{vehicleId:guid}/tasks/{taskId:guid}/reset")]
    public async Task<ActionResult<ResetTaskResponse>> Reset(Guid vehicleId, Guid taskId,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ResetTaskRequest? request, [FromQuery] DateOnly? today, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await taskService.ResetAsync(User.GetUserId(), vehicleId, taskId, request, today, ct));

    [HttpGet("vehicles/{vehicleId:guid}/service-records")]
    public async Task<ActionResult<List<ServiceRecordDto>>> Records(Guid vehicleId, CancellationToken ct) =>
        Ok(await taskService.ListRecordsAsync(User.GetUserId(), vehicleId, ct));

    [HttpGet("service-records")]
    public async Task<ActionResult<ServiceRecordPageDto>> SearchRecords(Guid? vehicleId, Guid? taskId, DateOnly? from, DateOnly? to,
        string? q, CancellationToken ct, int skip = 0, int take = 50) =>
        Ok(await taskService.SearchRecordsAsync(User.GetUserId(), vehicleId, taskId, from, to, q, skip, take, ct));

    [HttpGet("dashboard")]
    public async Task<ActionResult<DashboardDto>> Dashboard(DateOnly? today, CancellationToken ct) =>
        Ok(await taskService.DashboardAsync(User.GetUserId(), today, ct));

    [HttpPost("vehicles/{vehicleId:guid}/service-records")]
    public async Task<ActionResult<CreateServiceRecordResponse>> CreateRecord(Guid vehicleId, CreateServiceRecordRequest request,
        [FromQuery] DateOnly? today, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await taskService.CreateRecordAsync(User.GetUserId(), vehicleId, request, today, ct));

    [HttpPut("vehicles/{vehicleId:guid}/service-records/{recordId:guid}")]
    public async Task<ActionResult<CreateServiceRecordResponse>> UpdateRecord(Guid vehicleId, Guid recordId, UpdateServiceRecordRequest request,
        [FromQuery] DateOnly? today, CancellationToken ct) =>
        Ok(await taskService.UpdateRecordAsync(User.GetUserId(), vehicleId, recordId, request, today, ct));

    [HttpPost("vehicles/{vehicleId:guid}/service-records/{recordId:guid}/void")]
    public async Task<ActionResult<List<MaintenanceTaskDto>>> Void(Guid vehicleId, Guid recordId, [FromQuery] DateOnly? today, CancellationToken ct) =>
        Ok(await taskService.VoidAsync(User.GetUserId(), vehicleId, recordId, today, ct));

    /// <summary>Multipart with one file field <c>file</c>: JPEG, PNG, WebP or PDF by content, up to 10 MB. Shares the photo's upload limit.</summary>
    [HttpPost("vehicles/{vehicleId:guid}/service-records/{recordId:guid}/attachments")]
    [EnableRateLimiting(RequestLimits.UploadPolicy)]
    [DisableFormValueBinding]
    [RequestSizeLimit(AttachmentFiles.MaxBytes + 64 * 1024)] // the file plus the multipart framing; the service checks the file itself
    public async Task<ActionResult<ServiceRecordDto>> AddAttachment(Guid vehicleId, Guid recordId, CancellationToken ct)
    {
        var (content, fileName) = await UploadedFile.ReadAsync(Request, AttachmentFiles.TooLarge, ct);
        return Ok(await taskService.AddAttachmentAsync(User.GetUserId(), vehicleId, recordId, content, fileName, ct));
    }

    [HttpDelete("vehicles/{vehicleId:guid}/service-records/{recordId:guid}/attachments/{attachmentId:guid}")]
    public async Task<IActionResult> DeleteAttachment(Guid vehicleId, Guid recordId, Guid attachmentId, CancellationToken ct)
    {
        await taskService.DeleteAttachmentAsync(User.GetUserId(), vehicleId, recordId, attachmentId, ct);
        return NoContent();
    }
}
