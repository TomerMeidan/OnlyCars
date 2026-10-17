namespace OnlyCars.Application.Common.Exceptions;

public class PayloadTooLargeException(string code, string message) : AppException(code, message);
