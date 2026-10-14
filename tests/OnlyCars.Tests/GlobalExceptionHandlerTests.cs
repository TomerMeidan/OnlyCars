using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using OnlyCars.Api.Middleware;
using OnlyCars.Application.Common.Exceptions;

namespace OnlyCars.Tests;

public class GlobalExceptionHandlerTests
{
    private static async Task<(int Status, JsonElement Body)> HandleAsync(Exception exception)
    {
        var context = new DefaultHttpContext { Response = { Body = new MemoryStream() } };
        await new GlobalExceptionHandler(NullLogger<GlobalExceptionHandler>.Instance)
            .TryHandleAsync(context, exception, CancellationToken.None);

        context.Response.Body.Position = 0;
        return (context.Response.StatusCode, JsonDocument.Parse(context.Response.Body).RootElement);
    }

    [Fact]
    public async Task ValidationFailed_Returns400_WithCode()
    {
        var (status, body) = await HandleAsync(new ValidationFailedException("auth.passwordTooShort", "too short"));

        Assert.Equal(400, status);
        Assert.Equal("auth.passwordTooShort", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Extensions_AreCopiedToTheBody()
    {
        var (_, body) = await HandleAsync(new ValidationFailedException("odometer.lowerThanCurrent", "lower")
        {
            Extensions = { ["currentKm"] = 61250m }
        });

        Assert.Equal(61250m, body.GetProperty("currentKm").GetDecimal());
    }

    [Theory]
    [InlineData(typeof(UnauthorizedException), 401, "auth.invalidCredentials")]
    [InlineData(typeof(ConflictException), 409, "vehicle.vinTaken")]
    public async Task CodedExceptions_MapToStatusAndCode(Type type, int expectedStatus, string code)
    {
        var (status, body) = await HandleAsync((Exception)Activator.CreateInstance(type, code, "msg")!);

        Assert.Equal(expectedStatus, status);
        Assert.Equal(code, body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task NotFound_HasEntityCode()
    {
        var (status, body) = await HandleAsync(new NotFoundException("Vehicle", Guid.Empty));

        Assert.Equal(404, status);
        Assert.Equal("vehicle.notFound", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task UnexpectedException_Returns500_WithFallbackCode()
    {
        var (status, body) = await HandleAsync(new InvalidOperationException("secret"));

        Assert.Equal(500, status);
        Assert.Equal("http.500", body.GetProperty("code").GetString());
        Assert.DoesNotContain("secret", body.GetProperty("detail").GetString());
    }
}
