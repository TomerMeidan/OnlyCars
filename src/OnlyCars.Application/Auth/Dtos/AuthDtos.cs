using OnlyCars.Domain;

namespace OnlyCars.Application.Auth.Dtos;

// Without a Currency or Locale the user gets the entity defaults (ILS, En).
public record RegisterRequest(string Email, string Password, string? Currency = null, string? Locale = null);

// Strings, not enums, so a bad value is a coded 400 instead of a model-binding error. A null field is left unchanged.
public record UpdateSettingsRequest(string? Locale = null, string? Theme = null, string? Currency = null, string? DistanceUnit = null,
    int? ReminderLeadDays = null);

public record LoginRequest(string Email, string Password);

// A Google ID token from Google's sign-in button; Currency and Locale are used only when this makes a new account.
public record GoogleLoginRequest(string? IdToken, string? Currency = null, string? Locale = null);

public record AuthProvidersDto(string? GoogleClientId, bool OpenRegistration);

public record UserDto(Guid Id, string Email, DistanceUnit DistanceUnit, string Currency, Locale Locale, Theme Theme, int ReminderLeadDays,
    bool HasPassword = true);

public record AuthResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);
