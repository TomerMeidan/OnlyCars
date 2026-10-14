using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Mvc.ModelBinding;
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
            TooManyRequestsException => (StatusCodes.Status429TooManyRequests, "Too many requests"),
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

        if (exception is TooManyRequestsException tooMany)
        {
            httpContext.Response.Headers.RetryAfter = tooMany.RetryAfterSeconds.ToString();
        }

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken);

        return true;
    }

    /// <summary>Code for a ProblemDetails that no AppException produced (model binding, 500s); the client shows a generic message.</summary>
    public static string FallbackCode(int? statusCode) => $"http.{statusCode ?? 500}";

    /// <summary>
    /// Model-binding 400s: field names only. The default messages leak .NET type names, JSON paths and byte positions.
    /// </summary>
    public static IActionResult InvalidModelStateResponse(ActionContext context)
    {
        var fieldsOnly = new ModelStateDictionary();
        foreach (var (key, entry) in context.ModelState)
        {
            if (entry.Errors.Count > 0)
            {
                fieldsOnly.AddModelError(key.TrimStart('$', '.'), "Invalid value.");
            }
        }

        // The factory keeps the usual type, title, traceId and "code" (CustomizeProblemDetails in Program.cs).
        var problem = context.HttpContext.RequestServices.GetRequiredService<ProblemDetailsFactory>()
            .CreateValidationProblemDetails(context.HttpContext, fieldsOnly);
        return new BadRequestObjectResult(problem) { ContentTypes = { "application/problem+json" } };
    }
}
