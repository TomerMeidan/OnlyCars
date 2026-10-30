namespace OnlyCars.Application.Auth;

/// <summary>Checks a Google ID token's signature, issuer, audience (our client id) and expiry.</summary>
public interface IGoogleTokenValidator
{
    string ClientId { get; }

    /// <summary>The token's identity, or null when the token is not valid.</summary>
    Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken ct);
}

public record GoogleIdentity(string Subject, string Email, bool EmailVerified, DateTimeOffset IssuedAt);
