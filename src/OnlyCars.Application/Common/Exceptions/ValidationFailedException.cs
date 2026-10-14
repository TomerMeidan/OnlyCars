namespace OnlyCars.Application.Common.Exceptions;

public class ValidationFailedException(string message) : Exception(message);
