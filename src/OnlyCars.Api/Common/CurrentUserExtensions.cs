using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace OnlyCars.Api.Common;

public static class CurrentUserExtensions
{
    public static Guid GetUserId(this ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue(JwtRegisteredClaimNames.Sub)
                  ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);

        if (sub is null || !Guid.TryParse(sub, out var userId))
        {
            throw new UnauthorizedAccessException("Missing or invalid user identity.");
        }

        return userId;
    }
}
