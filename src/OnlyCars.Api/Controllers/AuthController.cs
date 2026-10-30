using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using OnlyCars.Api.Common;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Route("api/auth")]
[EnableRateLimiting(RequestLimits.AuthPolicy)]
[RequestSizeLimit(8_192)]
public class AuthController(AuthService authService) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest request, CancellationToken ct)
    {
        var response = await authService.RegisterAsync(request, ct);
        return Ok(response);
    }

    [HttpPost("google")]
    public async Task<ActionResult<AuthResponse>> Google(GoogleLoginRequest request, CancellationToken ct) =>
        Ok(await authService.GoogleAsync(request, ct));

    /// <summary>The sign-in options the login page shows; the Google client id is public (it is in Google's button too).</summary>
    [HttpGet("providers")]
    [DisableRateLimiting] // read on every login page load: not from the sign-in budget; the global limit still applies
    public AuthProvidersDto Providers([FromServices] IGoogleTokenValidator? google = null) => new(google?.ClientId);

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest request, CancellationToken ct)
    {
        var response = await authService.LoginAsync(request, ct);
        return Ok(response);
    }
}
