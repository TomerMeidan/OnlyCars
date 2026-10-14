namespace OnlyCars.Application.Common.Exceptions;

public class ValidationFailedException(string code, string message) : AppException(code, message);
