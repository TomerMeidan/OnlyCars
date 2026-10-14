namespace OnlyCars.Application.Common.Exceptions;

public class UnauthorizedException(string code, string message) : AppException(code, message);
