using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Net.Http.Headers;
using OnlyCars.Api.Common;
using OnlyCars.Application.Account;
using OnlyCars.Application.Account.Dtos;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;

namespace OnlyCars.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/me")]
public class MeController(AuthService authService, ExportService exportService, AccountService accountService) : ControllerBase
{
    // The API's names (camelCase, enum names), indented, with Hebrew written as is rather than \u escapes.
    public static readonly JsonSerializerOptions ExportJson = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        Converters = { new JsonStringEnumConverter() }
    };

    [HttpGet]
    public async Task<ActionResult<UserDto>> Get(CancellationToken ct) =>
        Ok(await authService.GetMeAsync(User.GetUserId(), ct));

    /// <summary>Deletes the account and everything it owns for good (ACC-2); the password confirms it.</summary>
    [HttpDelete]
    [EnableRateLimiting(RequestLimits.AccountDeletePolicy)]
    public async Task<IActionResult> Delete(DeleteAccountRequest request, CancellationToken ct)
    {
        await accountService.DeleteAsync(User.GetUserId(), request.Password, ct, request.GoogleIdToken);
        return NoContent();
    }

    [HttpPut("settings")]
    public async Task<ActionResult<UserDto>> UpdateSettings(UpdateSettingsRequest request, CancellationToken ct) =>
        Ok(await authService.UpdateSettingsAsync(User.GetUserId(), request, ct));

    /// <summary>Everything the user owns as one JSON download (ACC-1), written straight to the response rather than buffered.</summary>
    [HttpGet("export")]
    [EnableRateLimiting(RequestLimits.ExportPolicy)]
    public async Task<EmptyResult> Export(CancellationToken ct)
    {
        var export = await exportService.ExportAsync(User.GetUserId(), ct);
        var disposition = new ContentDispositionHeaderValue("attachment");
        // The same header File() writes: filename plus filename*.
        disposition.SetHttpFileName($"onlycars-export-{export.ExportedAt.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.json");
        Response.Headers.ContentDisposition = disposition.ToString();
        Response.Headers.CacheControl = "no-store";
        Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(Response.Body, export, ExportJson, ct); // UTF-8, no BOM
        return new EmptyResult();
    }
}
