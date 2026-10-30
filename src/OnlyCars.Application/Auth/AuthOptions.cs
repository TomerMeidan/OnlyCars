namespace OnlyCars.Application.Auth;

/// <summary>Bound from the "Auth" config section.</summary>
public class AuthOptions
{
    public const string SectionName = "Auth";

    /// <summary>
    /// Off: invite-only (owner, 2026-10-30). Nobody can register, and Google sign-in makes no accounts; the owner adds people
    /// with the add-user command. On for the browser tests, which register their own users.
    /// </summary>
    public bool OpenRegistration { get; set; }
}
