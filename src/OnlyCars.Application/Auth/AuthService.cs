using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Reminders;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Auth;

public class AuthService(
    IAppDbContext db,
    IPasswordHasher<User> passwordHasher,
    IJwtTokenService jwtTokenService,
    IMemoryCache cache,
    IOptions<RateLimitOptions> limits,
    IGoogleTokenValidator? google = null,
    IOptions<AuthOptions>? options = null)
{
    // Tests that build the service by hand get open registration; the app always passes the configured value (closed by default).
    private bool OpenRegistration => options?.Value.OpenRegistration ?? true;

    public const int MinPasswordLength = 8;
    public const int MaxEmailLength = 256; // the Email column length

    // Verified against when the email is unknown, so both failure paths cost one hash verification.
    private static readonly User DummyUser = new() { Email = string.Empty, PasswordHash = string.Empty };
    private static readonly string DummyHash = new PasswordHasher<User>().HashPassword(DummyUser, Guid.NewGuid().ToString());
    public static readonly string[] Currencies = ["ILS", "USD", "EUR", "GBP"];

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken ct = default)
    {
        if (!OpenRegistration)
        {
            throw new ValidationFailedException("auth.registrationClosed", "Registration is closed.");
        }

        var email = NormalizeEmail(request.Email);

        if (request.Password.Length < MinPasswordLength)
        {
            throw new ValidationFailedException("auth.passwordTooShort",
                $"Password must be at least {MinPasswordLength} characters.");
        }

        ValidateCurrency(request.Currency);
        var locale = EnumRules.Parse<Locale>(request.Locale, "settings.invalidLocale");

        if (await db.Users.AnyAsync(u => u.Email == email, ct))
        {
            throw EmailTaken();
        }

        var user = new User { Email = email, PasswordHash = string.Empty };
        if (request.Currency is not null)
        {
            user.Currency = request.Currency;
        }
        user.Locale = locale ?? user.Locale;
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // A simultaneous registration of the same email won the unique index (L66).
            if (await db.Users.AnyAsync(u => u.Email == email && u.Id != user.Id, ct))
            {
                throw EmailTaken();
            }

            throw;
        }

        return BuildResponse(user);
    }

    /// <summary>
    /// Google sign-in (owner, 2026-10-30): the account linked to this Google id; else the account the owner added for this
    /// verified email (no password, no Google id yet), linked now; else, only with open registration, a new account.
    /// An account with a password is never linked: register doesn't verify emails, so its password may be someone else's
    /// (account pre-hijacking, security review of GOOG-1).
    /// </summary>
    public async Task<AuthResponse> GoogleAsync(GoogleLoginRequest request, CancellationToken ct = default)
    {
        ValidateCurrency(request.Currency);
        var locale = EnumRules.Parse<Locale>(request.Locale, "settings.invalidLocale");
        var identity = await ValidateGoogleAsync(request.IdToken, ct);

        var user = await db.Users.FirstOrDefaultAsync(u => u.GoogleSubject == identity.Subject, ct);
        if (user is null)
        {
            // Only an address Google has verified becomes an account's email.
            if (!identity.EmailVerified)
            {
                throw new ValidationFailedException("auth.googleEmailNotVerified", "The Google account's email is not verified.");
            }

            var email = identity.Email.Trim().ToLowerInvariant();
            if (email.Length > MaxEmailLength)
            {
                throw GoogleFailed();
            }

            user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
            if (user is { GoogleSubject: not null })
            {
                throw new ConflictException("auth.googleAccountMismatch", "This email is linked to a different Google account.");
            }

            if (user is not null && user.PasswordHash != string.Empty)
            {
                throw new ConflictException("auth.googleUsePassword", "This email has an account with a password. Log in with the password.");
            }

            if (user is null)
            {
                if (!OpenRegistration)
                {
                    throw new ValidationFailedException("auth.notInvited", "This Google account has not been invited.");
                }

                user = new User { Email = email, PasswordHash = string.Empty, Locale = locale ?? Locale.En };
                if (request.Currency is not null)
                {
                    user.Currency = request.Currency;
                }
                db.Users.Add(user);
            }
            user.GoogleSubject = identity.Subject;

            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                // A simultaneous first sign-in with the same Google account won the unique index: use its account.
                user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.GoogleSubject == identity.Subject, ct);
                if (user is null)
                {
                    throw;
                }
            }
        }

        return BuildResponse(user, await ReminderService.LeadDaysAsync(db, user.Id, ct));
    }

    /// <summary>Account delete for an account without a password (ACC-2): a Google sign-in as this user in the last 10 minutes.</summary>
    public async Task ConfirmWithGoogleAsync(User user, string? idToken, CancellationToken ct)
    {
        var identity = await ValidateGoogleAsync(idToken, ct);
        if (identity.Subject != user.GoogleSubject || identity.IssuedAt < DateTimeOffset.UtcNow.AddMinutes(-10))
        {
            throw GoogleFailed();
        }
    }

    private async Task<GoogleIdentity> ValidateGoogleAsync(string? idToken, CancellationToken ct)
    {
        if (google is null)
        {
            throw new ValidationFailedException("auth.googleNotConfigured", "Google sign-in is not set up.");
        }

        // 400, not 401: a 401 signs the client out. A real ID token is about 1 KB.
        if (string.IsNullOrEmpty(idToken) || idToken.Length > 8_000)
        {
            throw GoogleFailed();
        }

        return await google.ValidateAsync(idToken, ct) ?? throw GoogleFailed();
    }

    private static ValidationFailedException GoogleFailed() => new("auth.googleFailed", "The Google sign-in could not be verified.");

    /// <summary>
    /// The owner's add-user command (invite-only, 2026-10-30): an account without a password, so its owner signs in with the
    /// Google account of this email. False when the email already has an account.
    /// </summary>
    public async Task<bool> InviteAsync(string email, CancellationToken ct = default)
    {
        email = NormalizeEmail(email);
        if (await db.Users.AnyAsync(u => u.Email == email, ct))
        {
            return false;
        }

        db.Users.Add(new User { Email = email, PasswordHash = string.Empty });
        await db.SaveChangesAsync(ct);
        return true;
    }

    private static string NormalizeEmail(string raw)
    {
        var email = raw.Trim().ToLowerInvariant();
        // MailAddress also parses display-name forms like "a <b@c.d>", so require the address to round-trip unchanged.
        if (email.Length > MaxEmailLength || !MailAddress.TryCreate(email, out var address) || address.Address != email)
        {
            throw new ValidationFailedException("auth.invalidEmail", "Email address is not valid.");
        }

        return email;
    }

    private static ConflictException EmailTaken() => new("auth.emailTaken", "An account with this email already exists.");

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
        if (user is null)
        {
            TakeAttempt("login-failures:email:" + email, CacheItemPriority.Normal);
            // Unknown email and wrong password take the same path: one verification, the same exception.
            passwordHasher.VerifyHashedPassword(DummyUser, DummyHash, request.Password);
            throw InvalidCredentials(); // the attempt taken above stays counted
        }

        if (!VerifyPassword(user, request.Password))
        {
            throw InvalidCredentials();
        }

        return BuildResponse(user, await ReminderService.LeadDaysAsync(db, user.Id, ct));
    }

    /// <summary>
    /// A known user's password check under that user's login-failure lockout, shared by login and account delete (ACC-2):
    /// a failure counts toward it, a success gives its attempt back, and over the limit it throws 429 <c>auth.tooManyAttempts</c>.
    /// </summary>
    public bool VerifyPassword(User user, string password)
    {
        // shortcut: failed-login counters live in this process's memory (reset on restart, not shared between instances),
        // fine for one App Service instance; move them to Redis or SQL if the API scales out.
        var counter = TakeAttempt("login-failures:user:" + user.Id, CacheItemPriority.NeverRemove);
        if (passwordHasher.VerifyHashedPassword(user, user.PasswordHash, password) == PasswordVerificationResult.Failed)
        {
            return false; // the attempt taken stays counted
        }

        Interlocked.Decrement(ref counter.Count);
        return true;
    }

    public async Task<UserDto> GetMeAsync(Guid userId, CancellationToken ct = default) =>
        ToDto(await FindUserAsync(userId, ct), await ReminderService.LeadDaysAsync(db, userId, ct));

    public async Task<UserDto> UpdateSettingsAsync(Guid userId, UpdateSettingsRequest request, CancellationToken ct = default)
    {
        // Validate every field before touching the user, so one bad field saves nothing.
        var locale = EnumRules.Parse<Locale>(request.Locale, "settings.invalidLocale");
        var theme = EnumRules.Parse<Theme>(request.Theme, "settings.invalidTheme");
        ValidateCurrency(request.Currency);
        var distanceUnit = EnumRules.Parse<DistanceUnit>(request.DistanceUnit, "settings.invalidDistanceUnit");
        if (request.ReminderLeadDays is < NotificationRule.MinLeadDays or > NotificationRule.MaxLeadDays)
        {
            throw new ValidationFailedException("settings.invalidLeadDays",
                $"Reminder lead time must be {NotificationRule.MinLeadDays} to {NotificationRule.MaxLeadDays} days.")
            {
                Extensions = { ["min"] = NotificationRule.MinLeadDays, ["max"] = NotificationRule.MaxLeadDays }
            };
        }

        var user = await FindUserAsync(userId, ct);
        user.Locale = locale ?? user.Locale;
        user.Theme = theme ?? user.Theme;
        user.Currency = request.Currency ?? user.Currency;
        user.DistanceUnit = distanceUnit ?? user.DistanceUnit;
        NotificationRule? added = null;
        if (request.ReminderLeadDays is { } leadDays)
        {
            var rule = await InAppRuleAsync(userId, ct);
            if (rule is null)
            {
                rule = added = new NotificationRule { UserId = userId, Channel = NotificationChannel.InApp };
                db.NotificationRules.Add(rule);
            }

            SetLeadDays(rule, leadDays);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (added is not null)
        {
            // A simultaneous first lead-day save won the unique (UserId, Channel) index: update its rule instead, once.
            db.NotificationRules.Remove(added); // detaches the failed insert; the user's other changes stay tracked
            var winner = await InAppRuleAsync(userId, ct);
            if (winner is null)
            {
                throw;
            }

            SetLeadDays(winner, added.LeadDays);
            await db.SaveChangesAsync(ct);
        }

        return ToDto(user, await ReminderService.LeadDaysAsync(db, userId, ct));
    }

    private Task<NotificationRule?> InAppRuleAsync(Guid userId, CancellationToken ct) =>
        db.NotificationRules.FirstOrDefaultAsync(r => r.UserId == userId && r.Channel == NotificationChannel.InApp, ct);

    private static void SetLeadDays(NotificationRule rule, int leadDays)
    {
        rule.LeadDays = leadDays;
        rule.UpdatedAt = DateTimeOffset.UtcNow;
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

    private static UserDto ToDto(User user, int reminderLeadDays) =>
        new(user.Id, user.Email, user.DistanceUnit, user.Currency, user.Locale, user.Theme, reminderLeadDays, user.PasswordHash != string.Empty);

    private static UnauthorizedException InvalidCredentials() => new("auth.invalidCredentials", "Invalid email or password.");

    /// <summary>
    /// Counts this attempt before the password is verified (429 over the limit), so parallel requests can't all pass the limit check
    /// during the slow hash (SEC-1 F3). The lock makes get-or-create atomic; IMemoryCache.GetOrCreate isn't.
    /// Account counters are NeverRemove so a flood of unknown-email counters can't evict them, and they fail closed
    /// when the size-capped cache is too full to store them (SEC-1 N1); unknown-email counters just go uncounted then.
    /// </summary>
    private FailedLogins TakeAttempt(string key, CacheItemPriority priority)
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
        var attempt = !stored && priority == CacheItemPriority.NeverRemove ? int.MaxValue : Interlocked.Increment(ref counter.Count);
        if (attempt > limits.Value.FailedLoginLimit)
        {
            Interlocked.Decrement(ref counter.Count);
            var retryAfter = (int)Math.Ceiling((counter.ResetsAt - DateTimeOffset.UtcNow).TotalSeconds);
            throw new TooManyRequestsException("auth.tooManyAttempts", "Too many failed sign-in attempts. Try again later.",
                Math.Max(retryAfter, 1));
        }
        return counter;
    }

    private static readonly object CounterLock = new();

    private sealed class FailedLogins(DateTimeOffset resetsAt)
    {
        public int Count;
        public DateTimeOffset ResetsAt { get; } = resetsAt;
    }

    private AuthResponse BuildResponse(User user, int reminderLeadDays = NotificationRule.DefaultLeadDays)
    {
        var (token, expiresAt) = jwtTokenService.CreateToken(user);
        return new AuthResponse(token, expiresAt, ToDto(user, reminderLeadDays));
    }
}
