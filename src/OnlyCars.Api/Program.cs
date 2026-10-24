using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.IdentityModel.Tokens;
using OnlyCars.Api.Common;
using OnlyCars.Api.Middleware;
using OnlyCars.Application;
using OnlyCars.Application.Common;
using OnlyCars.Infrastructure;
using OnlyCars.Infrastructure.Auth;
using OnlyCars.Infrastructure.Storage;

// The owner's storage cleanup (LOW-10). Its options are not configuration, so they don't reach the builder.
var sweepOrphans = args is ["sweep-orphans", ..];
var builder = WebApplication.CreateBuilder(sweepOrphans ? [] : args);

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
        options.Events = new JwtBearerEvents { OnTokenValidated = CurrentUserExtensions.RejectDeletedUserAsync };
    });

builder.Services.AddAuthorization();

builder.Services.AddRequestLimits(builder.Configuration);

builder.Services.AddCors(options =>
{
    options.AddPolicy(ClientCorsPolicy, policy =>
    {
        var origins = builder.Configuration.GetSection("Client:Origins").Get<string[]>()
                      ?? ["http://localhost:5173"];
        // Content-Disposition carries the export's file name (ACC-1), read by the client on a cross-origin deploy.
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Content-Disposition");
    });
});

var app = builder.Build();

if (sweepOrphans)
{
    using var scope = app.Services.CreateScope();
    // Names only, never credentials: the ratio guard can't catch a database that partly matches the bucket.
    var sql = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(builder.Configuration.GetConnectionString("Default"));
    Console.WriteLine($"Bucket '{builder.Configuration["R2:BucketName"]}', database '{sql.InitialCatalog}' on '{sql.DataSource}'.");
    Environment.ExitCode = await OrphanSweep.RunAsync(scope.ServiceProvider.GetService<IFileStorage>(),
        scope.ServiceProvider.GetRequiredService<IAppDbContext>(), args[1..], Console.Out);
    return;
}

app.UseNoSniff();
app.UseExceptionHandler(_ => { });

// Forwarded headers, CORS, authentication and the rate limiter, in the order they must run. Before HTTPS redirection, which needs X-Forwarded-Proto.
app.UseRequestLimits(ClientCorsPolicy);

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthorization(); // authentication runs inside UseRequestLimits, before the limiter

app.MapControllers();

app.Run();

namespace OnlyCars.Api
{
    public partial class Program;
}
