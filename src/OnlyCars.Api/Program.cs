using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.IdentityModel.Tokens;
using OnlyCars.Api.Common;
using OnlyCars.Api.Middleware;
using OnlyCars.Application;
using OnlyCars.Infrastructure;
using OnlyCars.Infrastructure.Auth;

var builder = WebApplication.CreateBuilder(args);

const string ClientCorsPolicy = "ClientCors";

builder.Services.AddControllers()
    .AddJsonOptions(ApiJson.Configure)
    .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = GlobalExceptionHandler.InvalidModelStateResponse);
builder.Services.AddOpenApi();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
// Framework-generated ProblemDetails (e.g. [ApiController] model validation) get a code too.
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = c =>
    c.ProblemDetails.Extensions.TryAdd("code", GlobalExceptionHandler.FallbackCode(c.ProblemDetails.Status)));

var jwtSection = builder.Configuration.GetSection(JwtOptions.SectionName);
var jwtSigningKey = jwtSection["SigningKey"]
    ?? throw new InvalidOperationException("Jwt:SigningKey is not configured.");

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwtSection["Issuer"],
            ValidateAudience = true,
            ValidAudience = jwtSection["Audience"],
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSigningKey)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorization();

builder.Services.AddRequestLimits(builder.Configuration);

builder.Services.AddCors(options =>
{
    options.AddPolicy(ClientCorsPolicy, policy =>
    {
        var origins = builder.Configuration.GetSection("Client:Origins").Get<string[]>()
                      ?? ["http://localhost:5173"];
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
    });
});

var app = builder.Build();

app.UseExceptionHandler(_ => { });

// Forwarded headers, CORS and the rate limiter, in the order they must run. Before HTTPS redirection, which needs X-Forwarded-Proto.
app.UseRequestLimits(ClientCorsPolicy);

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();

namespace OnlyCars.Api
{
    public partial class Program;
}
