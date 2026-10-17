namespace OnlyCars.Application.Common.Exceptions;

public class ServiceUnavailableException(string code, string message) : AppException(code, message);
