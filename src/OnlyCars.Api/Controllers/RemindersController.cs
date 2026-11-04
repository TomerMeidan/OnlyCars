using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OnlyCars.Api.Common;
using OnlyCars.Application.Common;
using OnlyCars.Application.Reminders;
using OnlyCars.Application.Reminders.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api")]
[RequestSizeLimit(65_536)]
public class RemindersController(VehicleDocumentService documentService, ReminderService reminderService) : ControllerBase
{
    [HttpGet("vehicles/{vehicleId:guid}/documents")]
    public async Task<ActionResult<List<VehicleDocumentDto>>> ListDocuments(Guid vehicleId, DateOnly? today, CancellationToken ct) =>
        Ok(await documentService.ListAsync(User.GetUserId(), vehicleId, today, ct));

    [HttpPost("vehicles/{vehicleId:guid}/documents")]
    public async Task<ActionResult<VehicleDocumentDto>> CreateDocument(Guid vehicleId, VehicleDocumentRequest request, DateOnly? today,
        CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await documentService.CreateAsync(User.GetUserId(), vehicleId, request, today, ct));

    [HttpPut("vehicles/{vehicleId:guid}/documents/{id:guid}")]
    public async Task<ActionResult<VehicleDocumentDto>> UpdateDocument(Guid vehicleId, Guid id, VehicleDocumentRequest request, DateOnly? today,
        CancellationToken ct) =>
        Ok(await documentService.UpdateAsync(User.GetUserId(), vehicleId, id, request, today, ct));

    [HttpDelete("vehicles/{vehicleId:guid}/documents/{id:guid}")]
    public async Task<IActionResult> DeleteDocument(Guid vehicleId, Guid id, CancellationToken ct)
    {
        await documentService.DeleteAsync(User.GetUserId(), vehicleId, id, ct);
        return NoContent();
    }

    /// <summary>Multipart with one file field <c>file</c>: JPEG, PNG, WebP or PDF by content, up to 10 MB. Shares the other uploads' limit.</summary>
    [HttpPost("vehicles/{vehicleId:guid}/documents/{id:guid}/attachments")]
    [EnableRateLimiting(RequestLimits.UploadPolicy)]
    [DisableFormValueBinding]
    [RequestSizeLimit(AttachmentFiles.MaxBytes + 64 * 1024)] // the file plus the multipart framing; the service checks the file itself
    public async Task<ActionResult<VehicleDocumentDto>> AddAttachment(Guid vehicleId, Guid id, DateOnly? today, CancellationToken ct)
    {
        var (content, fileName) = await UploadedFile.ReadAsync(Request, AttachmentFiles.TooLarge, ct);
        return Ok(await documentService.AddAttachmentAsync(User.GetUserId(), vehicleId, id, content, fileName, today, ct));
    }

    [HttpDelete("vehicles/{vehicleId:guid}/documents/{id:guid}/attachments/{attachmentId:guid}")]
    public async Task<IActionResult> DeleteAttachment(Guid vehicleId, Guid id, Guid attachmentId, CancellationToken ct)
    {
        await documentService.DeleteAttachmentAsync(User.GetUserId(), vehicleId, id, attachmentId, ct);
        return NoContent();
    }

    [HttpGet("reminders")]
    public async Task<ActionResult<RemindersDto>> List(DateOnly? today, CancellationToken ct) =>
        Ok(await reminderService.GetAsync(User.GetUserId(), today, ct));

    [HttpPost("reminders/snooze")]
    public async Task<ActionResult<SnoozeDto>> Snooze(SnoozeRequest request, CancellationToken ct) =>
        Ok(await reminderService.SnoozeAsync(User.GetUserId(), request, ct));

    [HttpDelete("reminders/snooze")]
    public async Task<IActionResult> Unsnooze(string? kind, Guid refId, CancellationToken ct)
    {
        await reminderService.UnsnoozeAsync(User.GetUserId(), kind, refId, ct);
        return NoContent();
    }
}
