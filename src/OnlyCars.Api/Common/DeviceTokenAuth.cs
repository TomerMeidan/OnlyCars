using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Devices;

namespace OnlyCars.Api.Common;

/// <summary>
/// The "Device" scheme (OBD-1): <c>Authorization: Bearer ocd_...</c>, checked against the stored device tokens.
/// Only <c>DeviceController</c> asks for it; every other endpoint keeps the default scheme, which refuses a device token.
/// </summary>
public class DeviceTokenAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    DeviceTokenService tokens) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Device";
    private const string Bearer = "Bearer ";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith(Bearer, StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.NoResult();
        }

        if (await tokens.AuthenticateAsync(header[Bearer.Length..].Trim(), Context.RequestAborted) is not { } userId)
        {
            return AuthenticateResult.Fail("Unknown or revoked device token.");
        }

        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, userId.ToString())], SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }
}
