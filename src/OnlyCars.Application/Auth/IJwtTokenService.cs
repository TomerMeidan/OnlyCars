using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Auth;

public interface IJwtTokenService
{
    (string Token, DateTimeOffset ExpiresAt) CreateToken(User user);
}
