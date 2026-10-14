namespace OnlyCars.Application.Common.Exceptions;

// Code is "<entity>.notFound" with the entity name camel-cased, e.g. "vehicle.notFound".
public class NotFoundException(string entity, object key)
    : AppException($"{char.ToLowerInvariant(entity[0])}{entity[1..]}.notFound", $"{entity} '{key}' was not found.");
