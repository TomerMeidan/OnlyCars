using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Issues;
using OnlyCars.Application.Issues.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api")]
[RequestSizeLimit(65_536)]
public class IssuesController(IssueService issueService) : ControllerBase
{
    [HttpGet("vehicles/{vehicleId:guid}/issues")]
    public async Task<ActionResult<List<IssueDto>>> List(Guid vehicleId, CancellationToken ct) =>
        Ok(await issueService.ListAsync(User.GetUserId(), vehicleId, ct));

    [HttpPost("vehicles/{vehicleId:guid}/issues")]
    public async Task<ActionResult<IssueDto>> Create(Guid vehicleId, CreateIssueRequest request, CancellationToken ct) =>
        StatusCode(StatusCodes.Status201Created, await issueService.CreateAsync(User.GetUserId(), vehicleId, request, ct));

    [HttpPut("issues/{id:guid}")]
    public async Task<ActionResult<IssueDto>> Update(Guid id, UpdateIssueRequest request, CancellationToken ct) =>
        Ok(await issueService.UpdateAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("issues/{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await issueService.DeleteAsync(User.GetUserId(), id, ct);
        return NoContent();
    }
}
