using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using OnlyCars.Application.Auth;

namespace OnlyCars.Infrastructure.Auth;

public class GoogleOptions
{
    public const string SectionName = "Google";

    // The OAuth "Web application" client id; in user-secrets as Google:ClientId. Unset: Google sign-in is off.
    public string? ClientId { get; set; }
}

/// <summary>Checks Google ID tokens against Google's published keys (fetched and refreshed by ConfigurationManager).</summary>
public class GoogleTokenValidator(string clientId, IConfigurationManager<OpenIdConnectConfiguration> keys) : IGoogleTokenValidator
{
    public string ClientId => clientId;

    public static GoogleTokenValidator Create(string clientId) => new(clientId, new ConfigurationManager<OpenIdConnectConfiguration>(
        "https://accounts.google.com/.well-known/openid-configuration", new OpenIdConnectConfigurationRetriever(), new HttpDocumentRetriever()));

    public async Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken ct)
    {
        var config = await keys.GetConfigurationAsync(ct);
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(idToken, new TokenValidationParameters
        {
            ValidIssuers = ["https://accounts.google.com", "accounts.google.com"],
            ValidAudience = clientId,
            IssuerSigningKeys = config.SigningKeys,
            ValidateLifetime = true,
            RequireExpirationTime = true,
            RequireSignedTokens = true,
            ClockSkew = TimeSpan.FromMinutes(2),
        });
        if (!result.IsValid || result.SecurityToken is not JsonWebToken token)
        {
            return null;
        }

        token.TryGetPayloadValue<string>("email", out var email);
        token.TryGetPayloadValue<bool>("email_verified", out var verified);
        return string.IsNullOrEmpty(token.Subject) || string.IsNullOrEmpty(email)
            ? null
            : new GoogleIdentity(token.Subject, email, verified, token.IssuedAt);
    }
}
