using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Auth;

public class AuthService(
    IAppDbContext db,
    IPasswordHasher<User> passwordHasher,
    IJwtTokenService jwtTokenService,
    IMemoryCache cache,
    IOptions<RateLimitOptions> limits)
{
    public const int MinPasswordLength = 8;
    public const int MaxEmailLength = 256; // the Email column length

    // Verified against when the email is unknown, so both failure paths cost one hash verification.
    private static readonly User DummyUser = new() { Email = string.Empty, PasswordHash = string.Empty };
    private static readonly string DummyHash = new PasswordHasher<User>().HashPassword(DummyUser, Guid.NewGuid().ToString());
    public static readonly string[] Currencies = ["ILS", "USD", "EUR", "GBP"];

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken ct = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        // MailAddress also parses display-name forms like "a <b@c.d>", so require the address to round-trip unchanged.
        if (email.Length > MaxEmailLength || !MailAddress.TryCreate(email, out var address) || address.Address != email)
        {
            throw new ValidationFailedException("auth.invalidEmail", "Email address is not valid.");
        }

        if (request.Password.Length < MinPasswordLength)
        {
            throw new ValidationFailedException("auth.passwordTooShort",
                $"Password must be at least {MinPasswordLength} characters.");
        }

        ValidateCurrency(request.Currency);
        var locale = ParseEnum<Locale>(request.Locale, "settings.invalidLocale");

        if (await db.Users.AnyAsync(u => u.Email == email, ct))
        {
            throw new ConflictException("auth.emailTaken", "An account with this email already exists.");
        }

        var user = new User { Email = email, PasswordHash = string.Empty };
        if (request.Currency is not null)
        {
            user.Currency = request.Currency;
        }
        user.Locale = locale ?? user.Locale;
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        return BuildResponse(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrEmpty(request.Password))
        {
            throw new ValidationFailedException("auth.credentialsRequired", "Email and password are required.");
        }

        // Before normalizing, caching or querying: an unbounded email would be an unbounded cache key (SEC-1 F1).
        if (request.Email.Length > MaxEmailLength)
        {
            throw InvalidCredentials();
        }

        var email = request.Email.Trim().ToLowerInvariant();
        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

        // Keyed on the account when there is one: the database matches look-alike emails (e.g. fullwidth letters) that
        // the normalized string doesn't, and they must share one counter (decisions.md, SEC-1 F2).
        // shortcut: failed-login counters live in this process's memory (reset on restart, not shared between instances),
        // fine for one App Service instance; move them to Redis or SQL if the API scales out.
        var (counter, attempt) = user is null
            ? TakeAttempt("login-failures:email:" + email, CacheItemPriority.Normal)
            : TakeAttempt("login-failures:user:" + user.Id, CacheItemPriority.NeverRemove);
        if (attempt > limits.Value.FailedLoginLimit)
        {
            Interlocked.Decrement(ref counter.Count);
            var retryAfter = (int)Math.Ceiling((counter.ResetsAt - DateTimeOffset.UtcNow).TotalSeconds);
            throw new TooManyRequestsException("auth.tooManyAttempts", "Too many failed sign-in attempts. Try again later.",
                Math.Max(retryAfter, 1));
        }

        // Unknown email and wrong password take the same path: one verification, the same exception.
        var result = passwordHasher.VerifyHashedPassword(user ?? DummyUser, user?.PasswordHash ?? DummyHash, request.Password);
        if (user is null || result == PasswordVerificationResult.Failed)
        {
            throw InvalidCredentials(); // the attempt taken above stays counted
        }

        Interlocked.Decrement(ref counter.Count); // a success gives its attempt back
        return BuildResponse(user);
    }

    public async Task<UserDto> GetMeAsync(Guid userId, CancellationToken ct = default) =>
        ToDto(await FindUserAsync(userId, ct));

    public async Task<UserDto> UpdateSettingsAsync(Guid userId, UpdateSettingsRequest request, CancellationToken ct = default)
    {
        // Validate every field before touching the user, so one bad field saves nothing.
        var locale = ParseEnum<Locale>(request.Locale, "settings.invalidLocale");
        var theme = ParseEnum<Theme>(request.Theme, "settings.invalidTheme");
        ValidateCurrency(request.Currency);
        var distanceUnit = ParseEnum<DistanceUnit>(request.DistanceUnit, "settings.invalidDistanceUnit");

        var user = await FindUserAsync(userId, ct);
        user.Locale = locale ?? user.Locale;
        user.Theme = theme ?? user.Theme;
        user.Currency = request.Currency ?? user.Currency;
        user.DistanceUnit = distanceUnit ?? user.DistanceUnit;
        await db.SaveChangesAsync(ct);
        return ToDto(user);
    }

    // Not found only for a still-valid token of a deleted account.
    private async Task<User> FindUserAsync(Guid userId, CancellationToken ct) =>
        await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw new NotFoundException(nameof(User), userId);

    private static void ValidateCurrency(string? currency)
    {
        if (currency is not null && !Currencies.Contains(currency))
        {
            throw new ValidationFailedException("auth.invalidCurrency", $"Currency must be one of {string.Join(", ", Currencies)}.");
        }
    }

    // Exact enum names only, the UserDto JSON casing; Enum.TryParse would also accept "1" or "dark".
    private static T? ParseEnum<T>(string? value, string code) where T : struct, Enum
    {
        if (value is null)
        {
            return null;
        }
        if (!Enum.GetNames<T>().Contains(value))
        {
            throw new ValidationFailedException(code, $"{typeof(T).Name} must be one of {string.Join(", ", Enum.GetNames<T>())}.");
        }
        return Enum.Parse<T>(value);
    }

    private static UserDto ToDto(User user) =>
        new(user.Id, user.Email, user.DistanceUnit, user.Currency, user.Locale, user.Theme);

    private static UnauthorizedException InvalidCredentials() => new("auth.invalidCredentials", "Invalid email or password.");

    /// <summary>
    /// Counts this attempt before the password is verified, so parallel requests can't all pass the limit check
    /// during the slow hash (SEC-1 F3). The lock makes get-or-create atomic; IMemoryCache.GetOrCreate isn't.
    /// Account counters are NeverRemove so a flood of unknown-email counters can't evict them, and they fail closed
    /// when the size-capped cache is too full to store them (SEC-1 N1); unknown-email counters just go uncounted then.
    /// </summary>
    private (FailedLogins Counter, int Attempt) TakeAttempt(string key, CacheItemPriority priority)
    {
        FailedLogins counter;
        bool stored;
        lock (CounterLock)
        {
            counter = cache.GetOrCreate(key, entry =>
            {
                var window = TimeSpan.FromSeconds(limits.Value.FailedLoginWindowSeconds);
                entry.AbsoluteExpirationRelativeToNow = window;
                entry.Size = 1;
                entry.Priority = priority;
                return new FailedLogins(DateTimeOffset.UtcNow + window);
            })!;
            // GetOrCreate returns a counter it didn't store when the cache is full.
            stored = cache.TryGetValue(key, out FailedLogins? cached) && ReferenceEquals(cached, counter);
        }
        if (!stored && priority == CacheItemPriority.NeverRemove)
        {
            return (counter, int.MaxValue);
        }
        return (counter, Interlocked.Increment(ref counter.Count));
    }

    private static readonly object CounterLock = new();

    private sealed class FailedLogins(DateTimeOffset resetsAt)
    {
        public int Count;
        public DateTimeOffset ResetsAt { get; } = resetsAt;
    }

    private AuthResponse BuildResponse(User user)
    {
        var (token, expiresAt) = jwtTokenService.CreateToken(user);
        return new AuthResponse(token, expiresAt, ToDto(user));
    }
}
