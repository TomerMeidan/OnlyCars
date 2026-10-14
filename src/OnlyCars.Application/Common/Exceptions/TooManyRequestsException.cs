namespace OnlyCars.Application.Common.Exceptions;

/// <summary>Maps to 429 with a Retry-After header of <see cref="RetryAfterSeconds"/>.</summary>
public class TooManyRequestsException(string code, string message, int retryAfterSeconds) : AppException(code, message)
{
    public int RetryAfterSeconds { get; } = retryAfterSeconds;
}
