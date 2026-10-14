using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

public class AuthServiceTests
{
    private static AuthService CreateService(out Infrastructure.Persistence.AppDbContext db,
        RateLimitOptions? limits = null, IPasswordHasher<User>? hasher = null, IMemoryCache? cache = null)
    {
        db = TestDbContextFactory.Create();
        return new AuthService(db, hasher ?? new PasswordHasher<User>(), new FakeJwtTokenService(),
            cache ?? new MemoryCache(new MemoryCacheOptions()), Options.Create(limits ?? new RateLimitOptions()));
    }

    [Fact]
    public async Task Login_CacheFull_KnownUserFailsClosed()
    {
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 5 });
        var service = CreateService(out _, cache: cache);
        await service.RegisterAsync(new RegisterRequest("victim@example.com", "Passw0rd!"));
        for (var i = 0; i < 5; i++)
        {
            cache.Set("filler" + i, i, new MemoryCacheEntryOptions { Size = 1, Priority = CacheItemPriority.NeverRemove });
        }

        for (var i = 0; i < 10; i++)
        {
            await Assert.ThrowsAsync<TooManyRequestsException>(() => service.LoginAsync(new LoginRequest("victim@example.com", "wrong")));
        }
        await Assert.ThrowsAsync<TooManyRequestsException>(() => service.LoginAsync(new LoginRequest("victim@example.com", "Passw0rd!")));
    }

    [Fact]
    public async Task Login_UnknownEmailFlood_CannotEvictKnownUserCounter()
    {
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 20 });
        var service = CreateService(out _, cache: cache);
        await service.RegisterAsync(new RegisterRequest("victim@example.com", "Passw0rd!"));

        for (var i = 0; i < 10; i++)
        {
            await Assert.ThrowsAsync<UnauthorizedException>(() => service.LoginAsync(new LoginRequest("victim@example.com", "wrong")));
        }
        for (var i = 0; i < 30; i++)
        {
            await Assert.ThrowsAsync<UnauthorizedException>(() => service.LoginAsync(new LoginRequest($"flood{i}@example.com", "x")));
        }
        cache.Compact(1.0); // evicts everything evictable

        await Assert.ThrowsAsync<TooManyRequestsException>(() => service.LoginAsync(new LoginRequest("victim@example.com", "Passw0rd!")));
    }

    private sealed class CountingHasher : PasswordHasher<User>
    {
        public int VerifyCalls;

        public override PasswordVerificationResult VerifyHashedPassword(User user, string hashedPassword, string providedPassword)
        {
            VerifyCalls++;
            return base.VerifyHashedPassword(user, hashedPassword, providedPassword);
        }
    }

    [Fact]
    public async Task Login_11thFailureForEmail_Throws429_EvenWithCorrectPassword()
    {
        var service = CreateService(out _);
        await service.RegisterAsync(new RegisterRequest("victim@example.com", "Passw0rd!"));

        for (var i = 0; i < 10; i++)
        {
            await Assert.ThrowsAsync<UnauthorizedException>(() =>
                service.LoginAsync(new LoginRequest(i % 2 == 0 ? "victim@example.com" : " VICTIM@example.com", "wrong")));
        }

        var ex = await Assert.ThrowsAsync<TooManyRequestsException>(() =>
            service.LoginAsync(new LoginRequest("victim@example.com", "wrong")));
        Assert.Equal("auth.tooManyAttempts", ex.Code);
        Assert.InRange(ex.RetryAfterSeconds, 1, 900);

        await Assert.ThrowsAsync<TooManyRequestsException>(() =>
            service.LoginAsync(new LoginRequest("victim@example.com", "Passw0rd!")));

        // Other emails are unaffected.
        await service.RegisterAsync(new RegisterRequest("other@example.com", "Passw0rd!"));
        await service.LoginAsync(new LoginRequest("other@example.com", "Passw0rd!"));
    }

    [Fact]
    public async Task Login_UnknownEmailFailures_AlsoCount()
    {
        var service = CreateService(out _, new RateLimitOptions { FailedLoginLimit = 2 });

        for (var i = 0; i < 2; i++)
        {
            await Assert.ThrowsAsync<UnauthorizedException>(() => service.LoginAsync(new LoginRequest("ghost@example.com", "x")));
        }

        await Assert.ThrowsAsync<TooManyRequestsException>(() => service.LoginAsync(new LoginRequest("ghost@example.com", "x")));
    }

    [Fact]
    public async Task Login_SuccessesDoNotCount()
    {
        var service = CreateService(out _, new RateLimitOptions { FailedLoginLimit = 2 });
        await service.RegisterAsync(new RegisterRequest("ok@example.com", "Passw0rd!"));

        for (var i = 0; i < 5; i++)
        {
            await service.LoginAsync(new LoginRequest("ok@example.com", "Passw0rd!"));
        }

        await Assert.ThrowsAsync<UnauthorizedException>(() => service.LoginAsync(new LoginRequest("ok@example.com", "wrong")));
        await service.LoginAsync(new LoginRequest("ok@example.com", "Passw0rd!"));
    }

    [Fact]
    public async Task Login_AfterWindowPasses_CorrectPasswordWorksAgain()
    {
        var service = CreateService(out _, new RateLimitOptions { FailedLoginLimit = 1, FailedLoginWindowSeconds = 1 });
        await service.RegisterAsync(new RegisterRequest("later@example.com", "Passw0rd!"));

        await Assert.ThrowsAsync<UnauthorizedException>(() => service.LoginAsync(new LoginRequest("later@example.com", "wrong")));
        await Assert.ThrowsAsync<TooManyRequestsException>(() => service.LoginAsync(new LoginRequest("later@example.com", "Passw0rd!")));

        await Task.Delay(1200);

        await service.LoginAsync(new LoginRequest("later@example.com", "Passw0rd!"));
    }

    [Fact]
    public async Task Login_UnknownEmail_VerifiesOnce_AndFailsLikeAWrongPassword()
    {
        var hasher = new CountingHasher();
        var service = CreateService(out _, hasher: hasher);
        await service.RegisterAsync(new RegisterRequest("known@example.com", "Passw0rd!"));

        var unknown = await Assert.ThrowsAsync<UnauthorizedException>(() =>
            service.LoginAsync(new LoginRequest("unknown@example.com", "Passw0rd!")));
        Assert.Equal(1, hasher.VerifyCalls);

        var wrong = await Assert.ThrowsAsync<UnauthorizedException>(() =>
            service.LoginAsync(new LoginRequest("known@example.com", "wrong")));
        Assert.Equal(2, hasher.VerifyCalls);

        Assert.Equal(wrong.Code, unknown.Code);
        Assert.Equal(wrong.Message, unknown.Message);
        Assert.Empty(unknown.Extensions);
        Assert.Empty(wrong.Extensions);
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

        var ex = await Assert.ThrowsAsync<ConflictException>(() =>
            service.RegisterAsync(new RegisterRequest("dup@example.com", "Different1!")));
        Assert.Equal("auth.emailTaken", ex.Code);
    }

    [Theory]
    [InlineData("", "", "auth.invalidEmail")]
    [InlineData("x", "1", "auth.invalidEmail")]
    [InlineData("   ", "Passw0rd!", "auth.invalidEmail")]
    [InlineData("Name <a@b.com>", "Passw0rd!", "auth.invalidEmail")]
    [InlineData("valid@example.com", "1234567", "auth.passwordTooShort")]
    public async Task Register_InvalidInput_ThrowsValidationFailed_AndCreatesNoUser(string email, string password, string code)
    {
        var service = CreateService(out var db);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            service.RegisterAsync(new RegisterRequest(email, password)));

        Assert.Equal(code, ex.Code);
        Assert.Empty(db.Users);
    }

    [Fact]
    public async Task Register_EightCharacterPassword_Succeeds()
    {
        var service = CreateService(out var db);

        await service.RegisterAsync(new RegisterRequest("eight@example.com", "12345678"));

        Assert.Single(db.Users);
    }

    [Fact]
    public async Task Register_WithCurrency_SavesIt_AndLoginReturnsIt()
    {
        var service = CreateService(out var db);

        var registered = await service.RegisterAsync(new RegisterRequest("eur@example.com", "Passw0rd!", "EUR"));
        var loggedIn = await service.LoginAsync(new LoginRequest("eur@example.com", "Passw0rd!"));

        Assert.Equal("EUR", registered.User.Currency);
        Assert.Equal("EUR", db.Users.Single().Currency);
        Assert.Equal("EUR", loggedIn.User.Currency);
    }

    [Fact]
    public async Task Register_WithoutCurrency_SavesIls()
    {
        var service = CreateService(out var db);

        var response = await service.RegisterAsync(new RegisterRequest("ils@example.com", "Passw0rd!"));

        Assert.Equal("ILS", response.User.Currency);
        Assert.Equal("ILS", db.Users.Single().Currency);
    }

    [Theory]
    [InlineData("XYZ")]
    [InlineData("ils ")]
    public async Task Register_UnknownCurrency_ThrowsInvalidCurrency_AndCreatesNoUser(string currency)
    {
        var service = CreateService(out var db);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            service.RegisterAsync(new RegisterRequest("bad@example.com", "Passw0rd!", currency)));

        Assert.Equal("auth.invalidCurrency", ex.Code);
        Assert.Empty(db.Users);
    }

    [Theory]
    [InlineData("", "Passw0rd!")]
    [InlineData("login@example.com", "")]
    public async Task Login_EmptyInput_ThrowsValidationFailed(string email, string password)
    {
        var service = CreateService(out _);

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            service.LoginAsync(new LoginRequest(email, password)));

        Assert.Equal("auth.credentialsRequired", ex.Code);
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

        await Assert.ThrowsAsync<UnauthorizedException>(() =>
            service.LoginAsync(new LoginRequest("wrongpw@example.com", "NotIt!")));
    }

    [Fact]
    public async Task Login_UnknownEmail_ThrowsUnauthorized()
    {
        var service = CreateService(out _);

        await Assert.ThrowsAsync<UnauthorizedException>(() =>
            service.LoginAsync(new LoginRequest("nouser@example.com", "whatever")));
    }
}
