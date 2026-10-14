namespace OnlyCars.Application.Common.Exceptions;

/// <summary>
/// An expected failure with a stable machine-readable <see cref="Code"/> the client translates.
/// <see cref="Extensions"/> carries values the translated message needs (e.g. the current odometer).
/// </summary>
public abstract class AppException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
    public Dictionary<string, object?> Extensions { get; } = new();
}
