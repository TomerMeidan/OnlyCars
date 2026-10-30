using OnlyCars.Application.Auth;
using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Api.Common;

/// <summary>The owner's add-user command (invite-only, 2026-10-30): <c>dotnet run --launch-profile http -- add-user a@gmail.com b@gmail.com</c>.</summary>
public static class AddUser
{
    /// <summary>Adds each email as an account that signs in with Google. Exit code 1 when nothing was given or an email is not valid.</summary>
    public static async Task<int> RunAsync(AuthService auth, string[] emails, TextWriter output)
    {
        if (emails.Length == 0)
        {
            await output.WriteLineAsync("Usage: add-user <email> [<email> ...]");
            return 1;
        }

        var exitCode = 0;
        foreach (var email in emails)
        {
            try
            {
                await output.WriteLineAsync(await auth.InviteAsync(email)
                    ? $"Added {email}: they sign in with \"Sign in with Google\" using this Gmail or Google account."
                    : $"{email} already has an account; nothing changed.");
            }
            catch (ValidationFailedException)
            {
                await output.WriteLineAsync($"Not a valid email, skipped: {email}");
                exitCode = 1;
            }
        }

        return exitCode;
    }
}
