using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Api.Middleware;

public class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        var (statusCode, title) = exception switch
        {
            NotFoundException => (StatusCodes.Status404NotFound, "Not found"),
            ConflictException => (StatusCodes.Status409Conflict, "Conflict"),
            ValidationFailedException => (StatusCodes.Status400BadRequest, "Validation failed"),
            UnauthorizedException or UnauthorizedAccessException => (StatusCodes.Status401Unauthorized, "Unauthorized"),
            _ => (StatusCodes.Status500InternalServerError, "Unexpected error")
        };

        if (statusCode == StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Unhandled exception");
        }

        var problem = new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Detail = statusCode == StatusCodes.Status500InternalServerError ? "An unexpected error occurred." : exception.Message
        };
        problem.Extensions["code"] = FallbackCode(statusCode);
        if (exception is AppException app)
        {
            problem.Extensions["code"] = app.Code;
            foreach (var (key, value) in app.Extensions)
            {
                problem.Extensions[key] = value;
            }
        }

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken);

        return true;
    }

    /// <summary>Code for a ProblemDetails that no AppException produced (model binding, 500s); the client shows a generic message.</summary>
    public static string FallbackCode(int? statusCode) => $"http.{statusCode ?? 500}";
}
