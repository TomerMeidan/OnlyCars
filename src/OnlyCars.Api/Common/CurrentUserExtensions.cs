using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Common;

namespace OnlyCars.Api.Common;

public static class CurrentUserExtensions
{
    public static Guid GetUserId(this ClaimsPrincipal principal) =>
        FindUserId(principal) ?? throw new UnauthorizedAccessException("Missing or invalid user identity.");

    private static Guid? FindUserId(ClaimsPrincipal? principal) =>
        Guid.TryParse(principal?.FindFirstValue(JwtRegisteredClaimNames.Sub) ?? principal?.FindFirstValue(ClaimTypes.NameIdentifier),
            out var userId) ? userId : null;

    /// <summary>
    /// JWT OnTokenValidated: a token whose user no longer exists is refused (401), so a deleted account's other devices are
    /// signed out at their next request (ACC-2). One primary-key lookup per authenticated request.
    /// </summary>
    public static async Task RejectDeletedUserAsync(TokenValidatedContext context)
    {
        var db = context.HttpContext.RequestServices.GetRequiredService<IAppDbContext>();
        if (FindUserId(context.Principal) is not { } userId || !await db.Users.AnyAsync(u => u.Id == userId, context.HttpContext.RequestAborted))
        {
            context.Fail("The account no longer exists.");
        }
    }
}
