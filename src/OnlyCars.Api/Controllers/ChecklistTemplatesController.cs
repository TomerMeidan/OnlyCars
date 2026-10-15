using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/checklist-templates")]
public class ChecklistTemplatesController(ChecklistTemplateService templateService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<ChecklistTemplateDto>>> List(CancellationToken ct) =>
        Ok(await templateService.ListAsync(User.GetUserId(), ct));

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ChecklistTemplateDto>> Get(Guid id, CancellationToken ct) =>
        Ok(await templateService.GetAsync(User.GetUserId(), id, ct));

    [HttpPost]
    public async Task<ActionResult<ChecklistTemplateDto>> Create(ChecklistTemplateRequest request, CancellationToken ct)
    {
        var template = await templateService.CreateAsync(User.GetUserId(), request, ct);
        return CreatedAtAction(nameof(Get), new { id = template.Id }, template);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ChecklistTemplateDto>> Update(Guid id, ChecklistTemplateRequest request, CancellationToken ct) =>
        Ok(await templateService.UpdateAsync(User.GetUserId(), id, request, ct));

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        await templateService.DeleteAsync(User.GetUserId(), id, ct);
        return NoContent();
    }
}
