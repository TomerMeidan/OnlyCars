using OnlyCars.Domain;

namespace OnlyCars.Application.Auth.Dtos;

public record RegisterRequest(string Email, string Password);

public record LoginRequest(string Email, string Password);

public record UserDto(Guid Id, string Email, DistanceUnit DistanceUnit, string Currency, Locale Locale, Theme Theme);

public record AuthResponse(string Token, DateTimeOffset ExpiresAt, UserDto User);
