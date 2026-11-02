using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Reminders;

namespace OnlyCars.Api.Controllers;

/// <summary>Jobs an external cron calls with a shared key (NOT-2): the free host sleeps when idle, so its own timer can miss a day.</summary>
[ApiController]
[AllowAnonymous]
[Route("api/jobs")]
public class JobsController(DigestService digestService, IOptions<EmailOptions> options) : ControllerBase
{
    /// <summary>Sends today's reminder emails not sent yet. 404 without Email:JobKey, 401 for a missing or wrong X-Job-Key, else 204.</summary>
    [HttpPost("daily-digest")]
    [EnableRateLimiting(RequestLimits.AuthPolicy)]
    public async Task<IActionResult> DailyDigest([FromHeader(Name = "X-Job-Key")] string? key)
    {
        if (options.Value.JobKey is not { Length: > 0 } jobKey)
        {
            return NotFound();
        }

        // Hashed first, so the comparison takes the same time whatever the length.
        if (!CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(key ?? "")), SHA256.HashData(Encoding.UTF8.GetBytes(jobKey))))
        {
            throw new UnauthorizedException("job.invalidKey", "Missing or wrong job key.");
        }

        // Not the request's token: a cron that gives up mid-run must not leave an email sent but unmarked.
        await digestService.RunAsync(DigestService.LocalToday(DateTimeOffset.UtcNow), CancellationToken.None);
        return NoContent();
    }
}
