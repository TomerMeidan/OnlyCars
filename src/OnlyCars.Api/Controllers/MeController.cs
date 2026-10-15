using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Api.Common;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/me")]
public class MeController(AuthService authService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<UserDto>> Get(CancellationToken ct) =>
        Ok(await authService.GetMeAsync(User.GetUserId(), ct));

    [HttpPut("settings")]
    public async Task<ActionResult<UserDto>> UpdateSettings(UpdateSettingsRequest request, CancellationToken ct) =>
        Ok(await authService.UpdateSettingsAsync(User.GetUserId(), request, ct));
}
