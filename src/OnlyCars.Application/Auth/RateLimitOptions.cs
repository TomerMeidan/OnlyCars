namespace OnlyCars.Application.Auth;

/// <summary>Bound from the "RateLimiting" config section. Defaults are the production limits (decisions.md, SEC-1).</summary>
public class RateLimitOptions
{
    public const string SectionName = "RateLimiting";

    /// <summary>Login + register requests per IP per window, counted together.</summary>
    public int AuthPermitLimit { get; set; } = 10;
    public int AuthWindowSeconds { get; set; } = 15 * 60;

    /// <summary>All requests per IP per window, across the whole API.</summary>
    public int GlobalPermitLimit { get; set; } = 300;
    public int GlobalWindowSeconds { get; set; } = 60;

    /// <summary>Failed logins per normalized email per window; a success does not count.</summary>
    public int FailedLoginLimit { get; set; } = 10;
    public int FailedLoginWindowSeconds { get; set; } = 15 * 60;
}
