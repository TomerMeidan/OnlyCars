namespace OnlyCars.Application.Account.Dtos;

/// <summary>DELETE /api/me (ACC-2). Nullable so a missing password is the coded <c>auth.credentialsRequired</c>, not a model error.</summary>
// A password, or for an account without one a fresh Google ID token.
public record DeleteAccountRequest(string? Password, string? GoogleIdToken = null);
