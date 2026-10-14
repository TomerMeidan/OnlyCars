using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/vehicles")]
public class VehiclesController(VehicleService vehicleService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<VehicleDto>>> List([FromQuery] bool includeArchived, CancellationToken ct)
    {
        var vehicles = await vehicleService.ListAsync(User.GetUserId(), includeArchived, ct);
        return Ok(vehicles);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<VehicleDto>> Get(Guid id, CancellationToken ct)
    {
        var vehicle = await vehicleService.GetAsync(User.GetUserId(), id, ct);
        return Ok(vehicle);
    }

    [HttpPost]
    public async Task<ActionResult<VehicleDto>> Create(CreateVehicleRequest request, CancellationToken ct)
    {
        var vehicle = await vehicleService.CreateAsync(User.GetUserId(), request, ct);
        return CreatedAtAction(nameof(Get), new { id = vehicle.Id }, vehicle);
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<VehicleDto>> Update(Guid id, UpdateVehicleRequest request, CancellationToken ct)
    {
        var vehicle = await vehicleService.UpdateAsync(User.GetUserId(), id, request, ct);
        return Ok(vehicle);
    }

    [HttpPost("{id:guid}/archive")]
    public async Task<IActionResult> Archive(Guid id, CancellationToken ct)
    {
        await vehicleService.ArchiveAsync(User.GetUserId(), id, archived: true, ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/unarchive")]
    public async Task<IActionResult> Unarchive(Guid id, CancellationToken ct)
    {
        await vehicleService.ArchiveAsync(User.GetUserId(), id, archived: false, ct);
        return NoContent();
    }
}
