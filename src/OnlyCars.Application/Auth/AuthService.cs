using System.Net.Mail;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Domain.Entities;

namespace OnlyCars.Application.Auth;

public class AuthService(
    IAppDbContext db,
    IPasswordHasher<User> passwordHasher,
    IJwtTokenService jwtTokenService)
{
    public const int MinPasswordLength = 8;
    public static readonly string[] Currencies = ["ILS", "USD", "EUR", "GBP"];

    public async Task<AuthResponse> RegisterAsync(RegisterRequest request, CancellationToken ct = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();

        // MailAddress also parses display-name forms like "a <b@c.d>", so require the address to round-trip unchanged.
        // 256 matches the Email column length.
        if (email.Length > 256 || !MailAddress.TryCreate(email, out var address) || address.Address != email)
        {
            throw new ValidationFailedException("auth.invalidEmail", "Email address is not valid.");
        }

        if (request.Password.Length < MinPasswordLength)
        {
            throw new ValidationFailedException("auth.passwordTooShort",
                $"Password must be at least {MinPasswordLength} characters.");
        }

        if (request.Currency is not null && !Currencies.Contains(request.Currency))
        {
            throw new ValidationFailedException("auth.invalidCurrency", $"Currency must be one of {string.Join(", ", Currencies)}.");
        }

        if (await db.Users.AnyAsync(u => u.Email == email, ct))
        {
            throw new ConflictException("auth.emailTaken", "An account with this email already exists.");
        }

        var user = new User { Email = email, PasswordHash = string.Empty };
        if (request.Currency is not null)
        {
            user.Currency = request.Currency;
        }
        user.PasswordHash = passwordHasher.HashPassword(user, request.Password);

        db.Users.Add(user);
        await db.SaveChangesAsync(ct);

        return BuildResponse(user);
    }

    public async Task<AuthResponse> LoginAsync(LoginRequest request, CancellationToken ct = default)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        if (email.Length == 0 || string.IsNullOrEmpty(request.Password))
        {
            throw new ValidationFailedException("auth.credentialsRequired", "Email and password are required.");
        }

        var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);

        if (user is null)
        {
            throw new UnauthorizedException("auth.invalidCredentials", "Invalid email or password.");
        }

        var result = passwordHasher.VerifyHashedPassword(user, user.PasswordHash, request.Password);
        if (result == PasswordVerificationResult.Failed)
        {
            throw new UnauthorizedException("auth.invalidCredentials", "Invalid email or password.");
        }

        return BuildResponse(user);
    }

    private AuthResponse BuildResponse(User user)
    {
        var (token, expiresAt) = jwtTokenService.CreateToken(user);
        var userDto = new UserDto(user.Id, user.Email, user.DistanceUnit, user.Currency, user.Locale, user.Theme);
        return new AuthResponse(token, expiresAt, userDto);
    }
}
