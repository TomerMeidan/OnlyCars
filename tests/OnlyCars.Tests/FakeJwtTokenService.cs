using OnlyCars.Application.Auth;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

public class FakeJwtTokenService : IJwtTokenService
{
    public (string Token, DateTimeOffset ExpiresAt) CreateToken(User user) =>
        ($"fake-token-for-{user.Id}", DateTimeOffset.UtcNow.AddHours(1));
}
