using Microsoft.AspNetCore.Identity;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

public class AuthServiceTests
{
    private static AuthService CreateService(out Infrastructure.Persistence.AppDbContext db)
    {
        db = TestDbContextFactory.Create();
        return new AuthService(db, new PasswordHasher<User>(), new FakeJwtTokenService());
    }

    [Fact]
    public async Task Register_CreatesUser_AndReturnsToken()
    {
        var service = CreateService(out var db);

        var response = await service.RegisterAsync(new RegisterRequest("Test@Example.com", "Passw0rd!"));

        Assert.Equal("test@example.com", response.User.Email);
        Assert.NotEmpty(response.Token);
        Assert.Single(db.Users);
    }

    [Fact]
    public async Task Register_DuplicateEmail_ThrowsConflict()
    {
        var service = CreateService(out _);
        await service.RegisterAsync(new RegisterRequest("dup@example.com", "Passw0rd!"));

        await Assert.ThrowsAsync<ConflictException>(() =>
            service.RegisterAsync(new RegisterRequest("dup@example.com", "Different1!")));
    }

    [Fact]
    public async Task Login_CorrectPassword_Succeeds()
    {
        var service = CreateService(out _);
        await service.RegisterAsync(new RegisterRequest("login@example.com", "Passw0rd!"));

        var response = await service.LoginAsync(new LoginRequest("login@example.com", "Passw0rd!"));

        Assert.Equal("login@example.com", response.User.Email);
    }

    [Fact]
    public async Task Login_WrongPassword_ThrowsUnauthorized()
    {
        var service = CreateService(out _);
        await service.RegisterAsync(new RegisterRequest("wrongpw@example.com", "Passw0rd!"));

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.LoginAsync(new LoginRequest("wrongpw@example.com", "NotIt!")));
    }

    [Fact]
    public async Task Login_UnknownEmail_ThrowsUnauthorized()
    {
        var service = CreateService(out _);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            service.LoginAsync(new LoginRequest("nouser@example.com", "whatever")));
    }
}
