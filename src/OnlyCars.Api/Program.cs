using Microsoft.EntityFrameworkCore;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.IdentityModel.Tokens;
using OnlyCars.Api.Common;
using OnlyCars.Api.Middleware;
using OnlyCars.Application;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Common;
using OnlyCars.Infrastructure;
using OnlyCars.Infrastructure.Auth;
using OnlyCars.Infrastructure.Storage;

// The owner's storage cleanup (LOW-10). Its options are not configuration, so they don't reach the builder.
var sweepOrphans = args is ["sweep-orphans", ..];
// The owner's invite (2026-10-30): add-user <email> [<email> ...] adds people who then sign in with Google.
var addUser = args is ["add-user", ..];
var builder = WebApplication.CreateBuilder(sweepOrphans || addUser ? [] : args);
if (sweepOrphans || addUser)
{
    builder.Logging.AddFilter("Microsoft.EntityFrameworkCore", LogLevel.Warning); // the owner reads the command's own lines, not its SQL
}

const string ClientCorsPolicy = "ClientCors";

// No "Server: Kestrel" on responses: it only tells a scanner what to try (security audit 2026-10-30).
builder.WebHost.ConfigureKestrel(o => o.AddServerHeader = false);

builder.Services.AddControllers()
    .AddJsonOptions(ApiJson.Configure)
    .ConfigureApiBehaviorOptions(o => o.InvalidModelStateResponseFactory = GlobalExceptionHandler.InvalidModelStateResponse);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddApplication();
builder.Services.Configure<AuthOptions>(builder.Configuration.GetSection(AuthOptions.SectionName));
builder.Services.AddInfrastructure(builder.Configuration);
// The daily reminder email's timer only with a Resend key (NOT-2); the job endpoint covers the days the host was asleep.
if (builder.Configuration["Email:ResendApiKey"] is { Length: > 0 })
{
    builder.Services.AddHostedService<DailyDigestTimer>();
}

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
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256], // only what JwtTokenService signs with (audit 2026-11-02)
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

if (addUser)
{
    using var scope = app.Services.CreateScope();
    var sql = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(builder.Configuration.GetConnectionString("Default"));
    Console.WriteLine($"Database '{sql.InitialCatalog}' on '{sql.DataSource}'.");
    Environment.ExitCode = await AddUser.RunAsync(scope.ServiceProvider.GetRequiredService<AuthService>(), args[1..], Console.Out);
    return;
}

// Production creates and updates the tables itself (appsettings.Production.json): GitHub's runners can't reach Azure SQL, which only
// lets Azure in, so the deploy can't run the migrations (2026-10-31). In the background once the app listens, with retries: the free
// database pauses when idle and takes a while to wake, and a failure must not stop the app, or its error never reaches the log stream.
if (app.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
{
    app.Lifetime.ApplicationStarted.Register(() => _ = Task.Run(async () =>
    {
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                using var scope = app.Services.CreateScope();
                await scope.ServiceProvider.GetRequiredService<OnlyCars.Infrastructure.Persistence.AppDbContext>().Database.MigrateAsync();
                app.Logger.LogInformation("Database is up to date.");
                return;
            }
            catch (Exception ex)
            {
                app.Logger.LogError("Database update, try {Attempt} of 5, failed: {Error}: {Message}", attempt, ex.GetType().Name, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(20));
            }
        }
    }));
}

app.UseNoSniff();
app.UseExceptionHandler(_ => { });

// Forwarded headers, CORS, authentication and the rate limiter, in the order they must run. Before HTTPS redirection, which needs X-Forwarded-Proto.
app.UseRequestLimits(ClientCorsPolicy);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Browsers remember to use HTTPS only (security audit 2026-10-30); not in Development, where it would stick to localhost.
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseHttpsRedirection();

app.UseAuthorization(); // authentication runs inside UseRequestLimits, before the limiter

app.MapClientApp();

app.MapControllers();

app.Run();

namespace OnlyCars.Api
{
    public partial class Program;
}
