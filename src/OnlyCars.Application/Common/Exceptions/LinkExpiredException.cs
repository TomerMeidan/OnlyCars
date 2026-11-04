namespace OnlyCars.Application.Common.Exceptions;

/// <summary>A 404 for a one-time link that is unknown, used or expired (EXP-1a).</summary>
public class LinkExpiredException(string code, string message) : AppException(code, message);
