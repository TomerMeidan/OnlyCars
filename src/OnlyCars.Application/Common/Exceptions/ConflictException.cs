namespace OnlyCars.Application.Common.Exceptions;

public class ConflictException(string code, string message) : AppException(code, message);
