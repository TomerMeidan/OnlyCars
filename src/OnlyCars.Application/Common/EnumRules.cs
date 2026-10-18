using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Application.Common;

/// <summary>Request enum parsing shared by settings and car documents.</summary>
public static class EnumRules
{
    // Exact enum names only, the UserDto JSON casing; Enum.TryParse would also accept "1" or "dark".
    internal static T? Parse<T>(string? value, string code) where T : struct, Enum
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
}
