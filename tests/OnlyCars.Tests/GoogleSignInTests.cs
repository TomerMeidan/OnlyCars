using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Account;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>A Google check that accepts "token-for:{sub}:{email}[:unverified][:old]" and nothing else.</summary>
public sealed class FakeGoogle : IGoogleTokenValidator
{
    public string ClientId => "client-id.apps.googleusercontent.com";

    public static string Token(string sub, string email, bool verified = true, bool old = false) =>
        $"token-for:{sub}:{email}{(verified ? "" : ":unverified")}{(old ? ":old" : "")}";

    public Task<GoogleIdentity?> ValidateAsync(string idToken, CancellationToken ct)
    {
        var parts = idToken.Split(':');
        return Task.FromResult(parts is ["token-for", var sub, var email, ..]
            ? new GoogleIdentity(sub, email, !parts.Contains("unverified"),
                DateTimeOffset.UtcNow.AddMinutes(parts.Contains("old") ? -11 : -1))
            : null);
    }
}

/// <summary>Google sign-in (owner, 2026-10-30): new account, linking by a verified email, and account delete without a password.</summary>
public class GoogleSignInTests
{
    private const string Password = "right-password-1";
    private readonly AppDbContext db = TestDbContextFactory.Create();

    private AuthService Auth(IGoogleTokenValidator? google = null) =>
        new(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(new RateLimitOptions()), google ?? new FakeGoogle());

    [Fact]
    public async Task FirstSignIn_MakesAnAccountWithoutPassword_AndTheNextSignInFindsIt()
    {
        var first = await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "New@Gmail.com"), "EUR", "He"));

        Assert.False(first.User.HasPassword);
        Assert.Equal(("new@gmail.com", "EUR", Locale.He), (first.User.Email, first.User.Currency, first.User.Locale));
        var again = await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "new@gmail.com")));
        Assert.Equal(first.User.Id, again.User.Id);
        // No password matches the empty hash.
        foreach (var password in new[] { "anything1", " ", "AQAAAAIAAYagAAAAE" })
        {
            Assert.Equal("auth.invalidCredentials",
                (await Assert.ThrowsAsync<UnauthorizedException>(() => Auth().LoginAsync(new LoginRequest("new@gmail.com", password)))).Code);
        }
    }

    [Fact]
    public async Task APasswordAccountWithTheEmail_IsNeverLinked_EvenWithAVerifiedEmail()
    {
        // Someone else may have registered the email first (register doesn't verify it): linking would hand them the Google user's data.
        await Auth().RegisterAsync(new RegisterRequest("me@example.com", Password));

        var error = await Assert.ThrowsAsync<ConflictException>(() =>
            Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "ME@example.com"))));

        Assert.Equal("auth.googleUsePassword", error.Code);
        Assert.Null((await db.Users.SingleAsync()).GoogleSubject);
    }

    [Fact]
    public async Task UnverifiedEmail_NeverClaimsAnAccount()
    {
        await Auth().RegisterAsync(new RegisterRequest("me@example.com", Password));

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@example.com", verified: false))));

        Assert.Equal("auth.googleEmailNotVerified", error.Code);
        Assert.Null((await db.Users.SingleAsync()).GoogleSubject);
    }

    [Fact]
    public async Task EmailLinkedToAnotherGoogleAccount_Is409()
    {
        await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@gmail.com")));

        var error = await Assert.ThrowsAsync<ConflictException>(() =>
            Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g2", "me@gmail.com"))));

        Assert.Equal("auth.googleAccountMismatch", error.Code);
        Assert.Equal("g1", (await db.Users.SingleAsync()).GoogleSubject);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("forged")]
    public async Task BadToken_IsGoogleFailed_AndMakesNothing(string? token)
    {
        var error = await Assert.ThrowsAsync<ValidationFailedException>(() => Auth().GoogleAsync(new GoogleLoginRequest(token)));

        Assert.Equal("auth.googleFailed", error.Code);
        Assert.False(await db.Users.AnyAsync());
    }

    [Fact]
    public async Task NotConfigured_IsRefused()
    {
        var auth = new AuthService(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(new RateLimitOptions()));

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            auth.GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@gmail.com"))));

        Assert.Equal("auth.googleNotConfigured", error.Code);
    }

    [Fact]
    public async Task BadCurrency_IsRefusedBeforeTheToken()
    {
        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@gmail.com"), "XXX")));

        Assert.Equal("auth.invalidCurrency", error.Code);
    }

    [Theory]
    [InlineData(null)] // no confirmation
    [InlineData("token-for:g2:me@gmail.com")] // another Google account
    [InlineData("token-for:g1:me@gmail.com:old")] // signed in more than 10 minutes ago
    public async Task Delete_WithoutPassword_NeedsAFreshSignInAsThisGoogleAccount(string? token)
    {
        var id = (await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@gmail.com")))).User.Id;

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            new AccountService(db, Auth()).DeleteAsync(id, "any-password", googleIdToken: token));

        Assert.Equal("auth.googleFailed", error.Code);
        Assert.True(await db.Users.AnyAsync(u => u.Id == id));
    }

    [Fact]
    public async Task Delete_PasswordAccount_NeedsThePassword_NotGoogle()
    {
        var id = (await Auth().RegisterAsync(new RegisterRequest("me@example.com", Password))).User.Id;

        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            new AccountService(db, Auth()).DeleteAsync(id, null, googleIdToken: FakeGoogle.Token("g1", "me@example.com")));

        Assert.Equal("auth.credentialsRequired", error.Code);
    }
}

/// <summary>The real delete for an account made with Google, and the filtered unique index, on LocalDB.</summary>
public class GoogleSignInSqlTests : IAsyncLifetime
{
    private readonly AppDbContext db = new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer($@"Server=(localdb)\mssqllocaldb;Database=OnlyCars_Test_{Guid.NewGuid():N};Trusted_Connection=True;TrustServerCertificate=True")
        .Options);

    public async Task InitializeAsync() => await db.Database.MigrateAsync();

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    private AuthService Auth() =>
        new(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(new RateLimitOptions()), new FakeGoogle());

    [Fact]
    public async Task FreshGoogleSignIn_DeletesTheAccount_AndPasswordUsersSharingNullSubjectsAreFine()
    {
        await Auth().RegisterAsync(new RegisterRequest("a@example.com", "right-password-1"));
        await Auth().RegisterAsync(new RegisterRequest("b@example.com", "right-password-1")); // two NULL subjects: the index is filtered
        var id = (await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@gmail.com")))).User.Id;
        db.ChangeTracker.Clear();

        await new AccountService(db, Auth()).DeleteAsync(id, null, googleIdToken: FakeGoogle.Token("g1", "me@gmail.com"));

        Assert.False(await db.Users.AnyAsync(u => u.Id == id));
        Assert.Equal(2, await db.Users.CountAsync());
        // The same Google account can sign up again after the delete.
        Assert.NotEqual(id, (await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "me@gmail.com")))).User.Id);
    }

    [Fact]
    public async Task TheSameGoogleIdCantBeOnTwoAccounts()
    {
        await Auth().GoogleAsync(new GoogleLoginRequest(FakeGoogle.Token("g1", "one@gmail.com")));
        db.Users.Add(new User { Email = "two@gmail.com", PasswordHash = "", GoogleSubject = "g1" });

        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}

/// <summary>The real token check, against a key of our own standing in for Google's published keys.</summary>
public class GoogleTokenValidatorTests
{
    private const string ClientId = "client-id.apps.googleusercontent.com";
    private readonly Microsoft.IdentityModel.Tokens.RsaSecurityKey googleKey = new(System.Security.Cryptography.RSA.Create(2048)) { KeyId = "k1" };

    private OnlyCars.Infrastructure.Auth.GoogleTokenValidator Validator()
    {
        var config = new Microsoft.IdentityModel.Protocols.OpenIdConnect.OpenIdConnectConfiguration();
        config.SigningKeys.Add(googleKey);
        return new(ClientId, new Microsoft.IdentityModel.Protocols.StaticConfigurationManager<
            Microsoft.IdentityModel.Protocols.OpenIdConnect.OpenIdConnectConfiguration>(config));
    }

    private string Token(string audience = ClientId, string issuer = "https://accounts.google.com", int expiresInMinutes = 30,
        Microsoft.IdentityModel.Tokens.SecurityKey? key = null) =>
        new Microsoft.IdentityModel.JsonWebTokens.JsonWebTokenHandler().CreateToken(new Microsoft.IdentityModel.Tokens.SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            IssuedAt = DateTime.UtcNow.AddMinutes(expiresInMinutes - 60),
            NotBefore = DateTime.UtcNow.AddMinutes(expiresInMinutes - 60),
            Expires = DateTime.UtcNow.AddMinutes(expiresInMinutes),
            Claims = new Dictionary<string, object> { ["sub"] = "g1", ["email"] = "me@gmail.com", ["email_verified"] = true },
            SigningCredentials = new(key ?? googleKey, Microsoft.IdentityModel.Tokens.SecurityAlgorithms.RsaSha256),
        });

    [Fact]
    public async Task AGoogleSignedTokenForUs_IsAccepted()
    {
        var identity = await Validator().ValidateAsync(Token(), default);

        Assert.Equal(("g1", "me@gmail.com", true), (identity!.Subject, identity.Email, identity.EmailVerified));
    }

    [Fact]
    public async Task AnotherAppsToken_AnotherIssuer_AnExpiredOne_OrAnotherKey_AreRefused()
    {
        var other = new Microsoft.IdentityModel.Tokens.RsaSecurityKey(System.Security.Cryptography.RSA.Create(2048)) { KeyId = "k1" };

        Assert.Null(await Validator().ValidateAsync(Token(audience: "someone-else.apps.googleusercontent.com"), default));
        Assert.Null(await Validator().ValidateAsync(Token(issuer: "https://evil.example.com"), default));
        Assert.Null(await Validator().ValidateAsync(Token(expiresInMinutes: -5), default));
        Assert.Null(await Validator().ValidateAsync(Token(key: other), default));
        Assert.Null(await Validator().ValidateAsync("not.a.token", default));
    }
}
