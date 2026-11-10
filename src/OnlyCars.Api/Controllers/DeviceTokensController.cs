using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Devices;
using OnlyCars.Application.Devices.Dtos;

namespace OnlyCars.Api.Controllers;

/// <summary>The signed-in user's device tokens (OBD-1), managed in Settings.</summary>
[ApiController]
[Authorize]
[Route("api/me/device-tokens")]
public class DeviceTokensController(DeviceTokenService deviceTokens) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<List<DeviceTokenDto>>> List(CancellationToken ct) =>
        Ok(await deviceTokens.ListAsync(User.GetUserId(), ct));

    /// <summary>The response is the only time the token is shown.</summary>
    [HttpPost]
    public async Task<ActionResult<CreatedDeviceTokenDto>> Create(CreateDeviceTokenRequest request, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        return Ok(await deviceTokens.CreateAsync(User.GetUserId(), request, ct));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken ct)
    {
        await deviceTokens.RevokeAsync(User.GetUserId(), id, ct);
        return NoContent();
    }
}
