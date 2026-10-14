using OnlyCars.Domain;

namespace OnlyCars.Application.Auth.Dtos;

// Without a Currency the user gets the entity default (ILS).
public record RegisterRequest(string Email, string Password, string? Currency = null);

public record LoginRequest(string Email, string Password);

public record UserDto(Guid Id, string Email, DistanceUnit DistanceUnit, string Currency, Locale Locale, Theme Theme);

public record AuthResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);
