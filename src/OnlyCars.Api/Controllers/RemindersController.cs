using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
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
