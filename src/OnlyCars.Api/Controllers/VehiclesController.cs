using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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

    /// <summary>Multipart with one file field <c>file</c>: JPEG, PNG or WebP by content, up to 10 MB.</summary>
    [HttpPut("{id:guid}/photo")]
    [EnableRateLimiting(RequestLimits.PhotoUploadPolicy)]
    [DisableFormValueBinding]
    [RequestSizeLimit(VehicleService.MaxPhotoBytes + 64 * 1024)] // the file plus the multipart framing; the service checks the file itself
    public async Task<ActionResult<VehicleDto>> SetPhoto(Guid id, CancellationToken ct)
    {
        byte[]? content = null;
        try
        {
            if (Request.HasFormContentType && (await Request.ReadFormAsync(ct)).Files.GetFile("file") is { } file)
            {
                content = new byte[file.Length]; // one copy, sized up front; RequestSizeLimit bounds it
                await using var stream = file.OpenReadStream();
                await stream.ReadExactlyAsync(content, ct);
            }
        }
        catch (BadHttpRequestException e) when (e.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            throw VehicleService.PhotoTooLarge();
        }
        catch (InvalidDataException)
        {
            // Malformed multipart: treated as no file.
        }

        var vehicle = await vehicleService.SetPhotoAsync(User.GetUserId(), id, content, ct);
        return Ok(vehicle);
    }

    [HttpDelete("{id:guid}/photo")]
    public async Task<IActionResult> DeletePhoto(Guid id, CancellationToken ct)
    {
        await vehicleService.DeletePhotoAsync(User.GetUserId(), id, ct);
        return NoContent();
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
