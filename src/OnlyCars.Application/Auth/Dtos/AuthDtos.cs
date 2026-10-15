using OnlyCars.Domain;

namespace OnlyCars.Application.Auth.Dtos;

// Without a Currency or Locale the user gets the entity defaults (ILS, En).
public record RegisterRequest(string Email, string Password, string? Currency = null, string? Locale = null);

// Strings, not enums, so a bad value is a coded 400 instead of a model-binding error. A null field is left unchanged.
public record UpdateSettingsRequest(string? Locale = null, string? Theme = null, string? Currency = null, string? DistanceUnit = null);

public record LoginRequest(string Email, string Password);

public record UserDto(Guid Id, string Email, DistanceUnit DistanceUnit, string Currency, Locale Locale, Theme Theme);

public record AuthResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);
