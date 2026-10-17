using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Reports;
using OnlyCars.Application.Reports.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/reports")]
public class ReportsController(ReportService reportService) : ControllerBase
{
    // year is a string so a missing or non-numeric one gets report.invalidYear, not a model-binding error.
    [HttpGet("costs")]
    public async Task<ActionResult<CostReportDto>> Costs(string? year, Guid? vehicleId, CancellationToken ct) =>
        Ok(await reportService.CostsAsync(User.GetUserId(), year, vehicleId, ct));
}
