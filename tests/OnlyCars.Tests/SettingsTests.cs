using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Controllers;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Tests;

// SET-1: GET /api/me, PUT /api/me/settings, and the locale on register.
public class SettingsTests
{
    private readonly Infrastructure.Persistence.AppDbContext _db = TestDbContextFactory.Create();
    private readonly AuthService _service;

    public SettingsTests() =>
        _service = new AuthService(_db, new PasswordHasher<User>(), new FakeJwtTokenService(),
            new MemoryCache(new MemoryCacheOptions()), Options.Create(new RateLimitOptions()));

    private async Task<UserDto> Register(string email = "me@example.com", string? locale = null) =>
        (await _service.RegisterAsync(new RegisterRequest(email, "Passw0rd!", Locale: locale))).User;

    [Fact]
    public void MeController_RequiresAuth() =>
        Assert.NotNull(typeof(MeController).GetCustomAttribute<AuthorizeAttribute>());

    [Fact]
    public async Task GetMe_ReturnsCallersUser()
    {
        var me = await Register();
        await Register("other@example.com");

        var dto = await _service.GetMeAsync(me.Id);

        Assert.Equal(me, dto);
    }

    [Fact]
    public async Task GetMe_UnknownUser_ThrowsNotFound()
    {
        var ex = await Assert.ThrowsAsync<NotFoundException>(() => _service.GetMeAsync(Guid.NewGuid()));
        Assert.Equal("user.notFound", ex.Code);
    }

    [Fact]
    public async Task UpdateSettings_OnlyTheme_LeavesOthersUnchanged()
    {
        var me = await Register(locale: "He");

        var dto = await _service.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(Theme: "Dark"));

        Assert.Equal(me with { Theme = Theme.Dark }, dto);
        var saved = _db.Users.Single(u => u.Id == me.Id);
        Assert.Equal((Theme.Dark, Locale.He, "ILS"), (saved.Theme, saved.Locale, saved.Currency));
    }

    [Fact]
    public async Task UpdateSettings_AllFields_ChangesAll()
    {
        var me = await Register();

        var dto = await _service.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest("He", "Light", "USD"));

        Assert.Equal(me with { Locale = Locale.He, Theme = Theme.Light, Currency = "USD" }, dto);
        Assert.Equal(dto, await _service.GetMeAsync(me.Id));
        Assert.Equal(DistanceUnit.Km, dto.DistanceUnit);
    }

    [Fact]
    public async Task UpdateSettings_EmptyBody_ChangesNothing()
    {
        var me = await Register();
        Assert.Equal(me, await _service.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest()));
    }

    [Theory]
    [InlineData("Fr", null, null, "settings.invalidLocale")]
    [InlineData("he", null, null, "settings.invalidLocale")] // exact casing only
    [InlineData("1", null, null, "settings.invalidLocale")] // no numeric enum values
    [InlineData("", null, null, "settings.invalidLocale")]
    [InlineData(null, "Blue", null, "settings.invalidTheme")]
    [InlineData(null, "dark", null, "settings.invalidTheme")]
    [InlineData(null, null, "JPY", "auth.invalidCurrency")]
    [InlineData(null, null, "usd", "auth.invalidCurrency")]
    // The other fields are valid, and still nothing is saved.
    [InlineData("He", "Dark", "XXX", "auth.invalidCurrency")]
    [InlineData("He", "Nope", "USD", "settings.invalidTheme")]
    [InlineData("Nope", "Dark", "USD", "settings.invalidLocale")]
    public async Task UpdateSettings_InvalidField_Throws_AndSavesNothing(string? locale, string? theme, string? currency, string code)
    {
        var me = await Register();

        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            _service.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest(locale, theme, currency)));

        Assert.Equal(code, ex.Code);
        Assert.Empty(ex.Extensions);
        _db.ChangeTracker.Clear();
        Assert.Equal(me, await _service.GetMeAsync(me.Id));
    }

    [Fact]
    public async Task UpdateSettings_DoesNotAffectOtherUser()
    {
        var me = await Register();
        var other = await Register("other@example.com");

        await _service.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest("He", "Dark", "GBP"));

        Assert.Equal(other, await _service.GetMeAsync(other.Id));
    }

    [Fact]
    public async Task UpdateSettings_UnknownUser_ThrowsNotFound() =>
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _service.UpdateSettingsAsync(Guid.NewGuid(), new UpdateSettingsRequest(Theme: "Dark")));

    [Fact]
    public async Task Register_WithLocaleHe_SavesHe()
    {
        var me = await Register(locale: "He");
        Assert.Equal(Locale.He, me.Locale);
        Assert.Equal(Locale.He, _db.Users.Single().Locale);
    }

    [Fact]
    public async Task Register_WithoutLocale_SavesEn()
    {
        var me = await Register();
        Assert.Equal(Locale.En, me.Locale);
        Assert.Equal(Locale.En, _db.Users.Single().Locale);
    }

    [Fact]
    public async Task Register_InvalidLocale_ThrowsInvalidLocale_AndCreatesNoUser()
    {
        var ex = await Assert.ThrowsAsync<ValidationFailedException>(() => Register(locale: "Fr"));
        Assert.Equal("settings.invalidLocale", ex.Code);
        Assert.Empty(_db.Users);
    }

    [Fact]
    public async Task Login_ReturnsSavedSettings()
    {
        var me = await Register();
        await _service.UpdateSettingsAsync(me.Id, new UpdateSettingsRequest("He", "Dark", "EUR"));

        var login = await _service.LoginAsync(new LoginRequest("me@example.com", "Passw0rd!"));

        Assert.Equal((Locale.He, Theme.Dark, "EUR"), (login.User.Locale, login.User.Theme, login.User.Currency));
    }
}
