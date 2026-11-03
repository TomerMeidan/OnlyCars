using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using OnlyCars.Api.Common;
using OnlyCars.Api.Controllers;
using OnlyCars.Application.Account;
using OnlyCars.Application.Auth;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Common;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Vehicles;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Auth;
using OnlyCars.Infrastructure.Persistence;
using OnlyCars.Infrastructure.Storage;

namespace OnlyCars.Tests;

/// <summary>Collects log lines, so a test can check what was logged.</summary>
public sealed class ListLogger<T> : ILogger<T>
{
    public List<(LogLevel Level, string Message)> Lines { get; } = [];
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        Lines.Add((logLevel, formatter(state, exception)));
}

/// <summary>
/// ACC-2 database part on LocalDB: the real cascades and the NoAction run-photo key are only enforced by SQL Server.
/// shortcut: needs SQL Server LocalDB on the machine, as MaintenanceSchemaTests.
/// </summary>
public class AccountDeleteSqlTests : IAsyncLifetime
{
    private const string Password = "right-password-1";
    private readonly AppDbContext db = new(new DbContextOptionsBuilder<AppDbContext>()
        .UseSqlServer($@"Server=(localdb)\mssqllocaldb;Database=OnlyCars_Test_{Guid.NewGuid():N};Trusted_Connection=True;TrustServerCertificate=True")
        .Options);
    private readonly FakeFileStorage storage = new();
    private readonly ListLogger<AccountService> logger = new();
    private readonly Guid mine = Guid.NewGuid();
    private readonly Guid theirs = Guid.NewGuid();

    public async Task InitializeAsync() => await db.Database.MigrateAsync();

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    private async Task SeedMineAsync()
    {
        var ids = await ExportTests.SeedAsync(db, mine, "mine");
        // TIRE-2: rows kept in the renamed old tire tables go with the account too.
        await TireMigrationTests.InsertOldTiresAsync(db, "Legacy_", mine, ids["car"]);
        var user = await db.Users.SingleAsync(u => u.Id == mine);
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, Password);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
    }

    private async Task<Dictionary<string, int>> CountsAsync()
    {
        var counts = new Dictionary<string, int>();
        foreach (var table in db.Model.GetEntityTypes().Select(t => t.GetTableName()!).Distinct()
                     .Concat(TireMigrationTests.OldTables.Select(t => "Legacy_" + t)))
        {
#pragma warning disable EF1003 // table names come from the EF model, not from input, and can't be parameters
            counts[table] = await db.Database.SqlQueryRaw<int>("SELECT COUNT(*) AS [Value] FROM [" + table + "]").SingleAsync();
#pragma warning restore EF1003
        }
        return counts;
    }

    private async Task<string> ExportTextAsync(Guid owner) =>
        JsonSerializer.Serialize(await new ExportService(db).ExportAsync(owner) with { ExportedAt = default }, MeController.ExportJson);

    private AccountService Service(IFileStorage? files) => new(db, AccountDeleteTests.Auth(db), files, logger);

    [Fact]
    public async Task Criterion1And2_RightPassword_LeavesNoRowOfTheUser_DeletesTheirPrefix_AndTheSecondUserIsUntouched()
    {
        await ExportTests.SeedAsync(db, theirs, "theirs");
        db.ChangeTracker.Clear();
        var before = await CountsAsync();
        var theirExport = await ExportTextAsync(theirs);
        await SeedMineAsync();
        var seeded = await CountsAsync();
        storage.Objects[$"users/{mine}/runs/a.jpg"] = ([1], "image/jpeg");
        storage.Objects[$"users/{theirs}/runs/b.jpg"] = ([1], "image/jpeg");

        // One of everything: the seed put a row of mine in every table (incl. run photos and snoozes).
        Assert.All(before, t => Assert.True(seeded[t.Key] > t.Value, t.Key));

        await Service(storage).DeleteAsync(mine, Password);

        // Every table is back to the second user's rows, except the global task template the seed added, which stays.
        Assert.Equal(new Dictionary<string, int>(before) { ["TaskTemplates"] = before["TaskTemplates"] + 1 }, await CountsAsync());
        Assert.Equal(theirExport, await ExportTextAsync(theirs));
        Assert.Equal([$"users/{mine}/"], storage.DeletedPrefixes);
        Assert.Equal([$"users/{theirs}/runs/b.jpg"], storage.Objects.Keys);
        Assert.Empty(logger.Lines);
    }

    [Fact]
    public async Task Criterion2_StorageFailure_StillDeletesTheRows_AndLogsTheUserWithoutKeys()
    {
        await SeedMineAsync();
        storage.FailDeletes = true;

        await Service(storage).DeleteAsync(mine, Password);

        Assert.False(await db.Users.AnyAsync(u => u.Id == mine));
        Assert.Equal(0, await db.Vehicles.CountAsync());
        Assert.Equal(0, await db.Attachments.CountAsync());
        var line = Assert.Single(logger.Lines);
        Assert.Equal(LogLevel.Error, line.Level);
        Assert.Contains(mine.ToString(), line.Message);
        Assert.Contains("IOException", line.Message);
        Assert.DoesNotContain("storage down", line.Message); // the exception message is not logged
    }

    [Fact]
    public async Task Criterion2And4_NoStorage_StillDeletes_AndTheSameEmailRegistersAgain()
    {
        await SeedMineAsync();

        await Service(null).DeleteAsync(mine, Password);

        Assert.False(await db.Users.AnyAsync(u => u.Id == mine));
        Assert.Equal(LogLevel.Warning, Assert.Single(logger.Lines).Level);
        var again = await AccountDeleteTests.Auth(db).RegisterAsync(new RegisterRequest("mine@onlycars.test", "another-password"));
        Assert.NotEqual(mine, again.User.Id);
    }

    // Holds a command matching the text until released (a NonQuery one after it ran, a reader one before); Reached completes when one arrives. Fires once.
    private sealed class Gate(string text, bool nonQuery) : DbCommandInterceptor
    {
        public TaskCompletionSource Reached { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Func<Task>? OnReached { get; init; }

        private async Task WaitAsync(System.Data.Common.DbCommand command)
        {
            if (command.CommandText.Contains(text) && Reached.TrySetResult())
            {
                if (OnReached is not null)
                {
                    await OnReached();
                }
                await Release.Task.WaitAsync(TimeSpan.FromSeconds(30));
            }
        }

        public override async ValueTask<int> NonQueryExecutedAsync(System.Data.Common.DbCommand command, CommandExecutedEventData eventData,
            int result, CancellationToken cancellationToken = default)
        {
            if (nonQuery)
            {
                await WaitAsync(command);
            }

            return result;
        }

        public override async ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(System.Data.Common.DbCommand command,
            CommandEventData eventData, InterceptionResult<System.Data.Common.DbDataReader> result, CancellationToken cancellationToken = default)
        {
            if (!nonQuery)
            {
                await WaitAsync(command);
            }

            return result;
        }
    }

    // An upload has read the run and is saving its photo when the delete has done each step (L173): the save waits for the commit,
    // then fails as a run deleted during an upload (409 concurrency.conflict); the delete never fails.
    [Theory]
    [InlineData("FROM [ChecklistRuns]")]
    [InlineData("FROM [Attachments]")]
    [InlineData("FROM [Users]")]
    public async Task L173_ARunPhotoSavedMidDelete_Is409_AndTheDeleteGoesThrough(string step)
    {
        await SeedMineAsync();
        var runId = await db.ChecklistRuns.Where(r => r.VehicleChecklist!.Vehicle!.UserId == mine).Select(r => r.Id).SingleAsync();
        var connection = db.Database.GetConnectionString()!;

        // The upload stops just before its save; the delete lets it go right after the step, then gives it a second to reach the locks.
        var save = new Gate("INSERT INTO [Attachments]", nonQuery: false);
        var deleteStep = new Gate(step, nonQuery: true) { OnReached = async () => { save.Release.TrySetResult(); await Task.Delay(1000); } };
        deleteStep.Release.SetResult();
        await using var uploading = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).AddInterceptors(save).Options);
        var uploads = new VehicleService(uploading, new FakeFileStorage());
        var upload = new VehicleChecklistService(uploading, uploads).AddRunAttachmentAsync(mine, runId, AttachmentTests.Webp(), "late.webp");
        await save.Reached.Task.WaitAsync(TimeSpan.FromSeconds(30));
        await using var deleting = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlServer(connection).AddInterceptors(deleteStep).Options);

        await new AccountService(deleting, AccountDeleteTests.Auth(deleting), storage, logger).DeleteAsync(mine, Password);

        Assert.True(deleteStep.Reached.Task.IsCompleted);
        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => upload.WaitAsync(TimeSpan.FromSeconds(30)));
        Assert.False(await db.Users.AnyAsync(u => u.Id == mine));
        Assert.Equal(0, await db.Attachments.CountAsync());
        Assert.Equal([$"users/{mine}/"], storage.DeletedPrefixes);
    }
}

/// <summary>ACC-2: password checks, the prefix guard, the token check and the limit. Criterion numbers refer to the ticket.</summary>
public class AccountDeleteTests
{
    private const string Password = "right-password-1";
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly User user;

    public AccountDeleteTests()
    {
        user = new User { Email = "me@onlycars.test", PasswordHash = "" };
        user.PasswordHash = new PasswordHasher<User>().HashPassword(user, Password);
        db.Users.Add(user);
        db.SaveChanges();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task Criterion3_EmptyPassword_IsCredentialsRequired(string? password)
    {
        var error = await Assert.ThrowsAsync<ValidationFailedException>(() =>
            new AccountService(db, Auth(db)).DeleteAsync(user.Id, password));

        Assert.Equal("auth.credentialsRequired", error.Code);
        Assert.True(await db.Users.AnyAsync());
    }

    /// <summary>An AuthService with its own failure counters, as the app's singleton cache would hold them.</summary>
    internal static AuthService Auth(AppDbContext db, RateLimitOptions? limits = null) =>
        new(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(limits ?? new RateLimitOptions()));

    [Fact]
    public async Task Criterion3_WrongPassword_Is400InvalidCredentials_AndCountsTowardTheLoginLockout()
    {
        var auth = Auth(db, new RateLimitOptions { FailedLoginLimit = 2 });
        var service = new AccountService(db, auth);
        for (var i = 0; i < 2; i++)
        {
            var error = await Assert.ThrowsAsync<ValidationFailedException>(() => service.DeleteAsync(user.Id, "wrong-password"));
            Assert.Equal("auth.invalidCredentials", error.Code); // ValidationFailedException is 400, not 401
        }

        // Locked out like login: even the right password is refused, on delete and on login.
        Assert.Equal("auth.tooManyAttempts",
            (await Assert.ThrowsAsync<TooManyRequestsException>(() => service.DeleteAsync(user.Id, Password))).Code);
        Assert.Equal("auth.tooManyAttempts",
            (await Assert.ThrowsAsync<TooManyRequestsException>(() => auth.LoginAsync(new LoginRequest(user.Email, Password)))).Code);
        Assert.True(await db.Users.AnyAsync(u => u.Id == user.Id));
    }

    [Fact]
    public async Task Criterion3_FailedLoginsCountTowardDelete_AndARightPasswordGivesItsAttemptBack()
    {
        var auth = Auth(db, new RateLimitOptions { FailedLoginLimit = 2 });
        await Assert.ThrowsAsync<UnauthorizedException>(() => auth.LoginAsync(new LoginRequest(user.Email, "wrong-password")));
        Assert.Equal(user.Id, (await auth.LoginAsync(new LoginRequest(user.Email, Password))).User.Id); // gives its attempt back
        await Assert.ThrowsAsync<ValidationFailedException>(() => new AccountService(db, auth).DeleteAsync(user.Id, "wrong-password"));

        Assert.Equal("auth.tooManyAttempts",
            (await Assert.ThrowsAsync<TooManyRequestsException>(() => auth.LoginAsync(new LoginRequest(user.Email, Password)))).Code);
    }

    /// <summary>S3 stand-in: list pages from a queue, records each call (the SDK's methods are virtual).</summary>
    private sealed class PagedS3(params ListObjectsV2Response[] pages)
        : AmazonS3Client(new AnonymousAWSCredentials(), new AmazonS3Config { ServiceURL = "http://127.0.0.1:9" })
    {
        private readonly Queue<ListObjectsV2Response> pages = new(pages);
        public List<string?> ListTokens { get; } = [];
        public List<ListObjectsV2Request> Requests { get; } = [];
        public List<List<string>> DeletedBatches { get; } = [];
        public List<DeleteError> DeleteErrors { get; } = [];

        public override Task<ListObjectsV2Response> ListObjectsV2Async(ListObjectsV2Request request, CancellationToken cancellationToken = default)
        {
            ListTokens.Add(request.ContinuationToken);
            Requests.Add(new ListObjectsV2Request { Prefix = request.Prefix, Delimiter = request.Delimiter });
            return Task.FromResult(pages.Dequeue());
        }

        public override Task<DeleteObjectsResponse> DeleteObjectsAsync(DeleteObjectsRequest request, CancellationToken cancellationToken = default)
        {
            DeletedBatches.Add(request.Objects.Select(o => o.Key).ToList());
            return Task.FromResult(new DeleteObjectsResponse { DeleteErrors = DeleteErrors });
        }
    }

    private const string Prefix = "users/0f8fad5b-d9cb-469f-a165-70867728950e/";

    private static ListObjectsV2Response Page(string? next, params string[] keys) => new()
    {
        S3Objects = keys.Select(k => new S3Object { Key = Prefix + k }).ToList(),
        IsTruncated = next is not null,
        NextContinuationToken = next
    };

    [Fact]
    public async Task Criterion2_DeletePrefix_DeletesEveryPage_FollowingTheContinuationToken()
    {
        var s3 = new PagedS3(Page("page-2", "a.jpg", "b.jpg"), Page(null, "c.jpg"));

        await new R2FileStorage(s3, "bucket").DeletePrefixAsync(Prefix);

        Assert.Equal([null, "page-2"], s3.ListTokens);
        Assert.Equal([[Prefix + "a.jpg", Prefix + "b.jpg"], [Prefix + "c.jpg"]], s3.DeletedBatches);
    }

    [Fact]
    public async Task Criterion2_DeletePrefix_ADeleteErrorThrows()
    {
        var s3 = new PagedS3(Page(null, "a.jpg"));
        s3.DeleteErrors.Add(new DeleteError { Key = Prefix + "a.jpg", Code = "AccessDenied" });

        await Assert.ThrowsAsync<IOException>(() => new R2FileStorage(s3, "bucket").DeletePrefixAsync(Prefix));
    }

    [Fact]
    public async Task Low10_ListUserPrefixes_ReadsEveryPageWithDelimiter_KeepsOnlyUsersGuid()
    {
        var s3 = new PagedS3(
            new ListObjectsV2Response { CommonPrefixes = [Prefix, "users/x/"], IsTruncated = true, NextContinuationToken = "page-2" },
            new ListObjectsV2Response { CommonPrefixes = ["users/0F8FAD5B-D9CB-469F-A165-70867728950E/", "users/7c9e6679-7425-40de-944b-e07fc1f90ae7/"] });

        var prefixes = await new R2FileStorage(s3, "bucket").ListUserPrefixesAsync();

        Assert.Equal([Prefix, "users/7c9e6679-7425-40de-944b-e07fc1f90ae7/"], prefixes);
        Assert.Equal([null, "page-2"], s3.ListTokens);
        Assert.All(s3.Requests, r => Assert.Equal(("users/", "/"), (r.Prefix, r.Delimiter)));
    }

    [Fact]
    public async Task Low10_CountObjects_CountsEveryPage_AndRefusesOtherPrefixes()
    {
        var r2 = new R2FileStorage(new PagedS3(Page("page-2", "a.jpg", "b.jpg"), Page(null, "c.jpg")), "bucket");

        Assert.Equal(3, await r2.CountObjectsAsync(Prefix));
        await Assert.ThrowsAsync<ArgumentException>(() => r2.CountObjectsAsync("users/"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("users/")]
    [InlineData("users/x/")]
    [InlineData("users/0f8fad5b-d9cb-469f-a165-70867728950e")]
    [InlineData("users/0F8FAD5B-D9CB-469F-A165-70867728950E/")]
    [InlineData("users/0f8fad5bd9cb469fa16570867728950e/")]
    [InlineData("users/0f8fad5b-d9cb-469f-a165-70867728950e/x/")]
    [InlineData("other/0f8fad5b-d9cb-469f-a165-70867728950e/")]
    public async Task Criterion2_DeletePrefix_RefusesAnythingButUsersGuid(string prefix)
    {
        // Points nowhere: a refused prefix must throw before any call.
        var r2 = new R2FileStorage(new AmazonS3Client(new AnonymousAWSCredentials(), new AmazonS3Config { ServiceURL = "http://127.0.0.1:9" }), "bucket");

        await Assert.ThrowsAsync<ArgumentException>(() => r2.DeletePrefixAsync(prefix));
        Assert.True(R2FileStorage.IsUserPrefix("users/0f8fad5b-d9cb-469f-a165-70867728950e/"));
    }

    [Fact]
    public void Criterion3_DeleteNeedsSignInAndUsesItsOwnLimit()
    {
        Assert.NotNull(typeof(MeController).GetCustomAttribute<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
        var action = typeof(MeController).GetMethod(nameof(MeController.Delete))!;
        Assert.NotNull(action.GetCustomAttribute<HttpDeleteAttribute>());
        Assert.Equal(RequestLimits.AccountDeletePolicy, action.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
    }

    private static readonly JwtOptions Jwt = new() { Issuer = "test", Audience = "test", SigningKey = new string('k', 64) };

    // Set by a test to hold DELETE /me open; inFlight completes once a held request is inside the endpoint.
    private TaskCompletionSource? hold;
    private readonly TaskCompletionSource inFlight = new(TaskCreationOptions.RunContinuationsAsynchronously);

    // The real JWT validation with the deleted-user check, the real limiter and the real order, around stand-in endpoints.
    private async Task<(WebApplication App, HttpClient Client)> StartAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSingleton<IAppDbContext>(db);
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.AddCors(o => o.AddPolicy("test", p => p.WithOrigins("http://client.test")));
        builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
        {
            o.TokenValidationParameters = new TokenValidationParameters
            {
                ValidIssuer = Jwt.Issuer,
                ValidAudience = Jwt.Audience,
                IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(Jwt.SigningKey))
            };
            o.Events = new JwtBearerEvents { OnTokenValidated = CurrentUserExtensions.RejectDeletedUserAsync };
        });
        builder.Services.AddAuthorization();
        var app = builder.Build();
        app.UseRequestLimits("test");
        app.UseAuthorization();
        app.MapGet("/me", () => "ok").RequireAuthorization();
        app.MapDelete("/me", async () =>
        {
            if (hold is { } h)
            {
                inFlight.TrySetResult();
                await h.Task;
            }
            return "ok";
        }).RequireAuthorization().RequireRateLimiting(RequestLimits.AccountDeletePolicy);
        await app.StartAsync();
        return (app, new HttpClient { BaseAddress = new Uri(app.Urls.First()) });
    }

    private static Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string? token)
    {
        var request = new HttpRequestMessage(method, "/me");
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        return client.SendAsync(request);
    }

    [Fact]
    public async Task Criterion3And4_NoToken401_DeletedUsersToken401()
    {
        var (app, client) = await StartAsync();
        await using var _ = app;
        var token = new JwtTokenService(Options.Create(Jwt)).CreateToken(user).Token;

        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(client, HttpMethod.Get, null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(client, HttpMethod.Get, token)).StatusCode);

        db.Users.Remove(user);
        await db.SaveChangesAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(client, HttpMethod.Get, token)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(client, HttpMethod.Delete, token)).StatusCode);
    }

    [Fact]
    public async Task Criterion3_SixthDeleteTryInTheWindowIs429()
    {
        var (app, client) = await StartAsync();
        await using var _ = app;
        var token = new JwtTokenService(Options.Create(Jwt)).CreateToken(user).Token;

        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await SendAsync(client, HttpMethod.Delete, token)).StatusCode);
        }
        var rejected = await SendAsync(client, HttpMethod.Delete, token);

        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.Equal("http.429", JsonDocument.Parse(await rejected.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString());
        // The limit is per user and per endpoint: reading still works.
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(client, HttpMethod.Get, token)).StatusCode);
    }

    [Fact]
    public async Task L177_ASecondDeleteWhileTheFirstIsInFlight_Is429()
    {
        var (app, client) = await StartAsync();
        await using var _ = app;
        var token = new JwtTokenService(Options.Create(Jwt)).CreateToken(user).Token;
        hold = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var first = SendAsync(client, HttpMethod.Delete, token);
        HttpResponseMessage second;
        try
        {
            await inFlight.Task.WaitAsync(TimeSpan.FromSeconds(10));
            // Times out instead of hanging if a regression lets the second request in to wait on hold too.
            second = await SendAsync(client, HttpMethod.Delete, token).WaitAsync(TimeSpan.FromSeconds(10));
        }
        finally
        {
            hold.SetResult();
        }

        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await first).StatusCode);
        // Once the first is done, the next one goes through.
        Assert.Equal(HttpStatusCode.OK, (await SendAsync(client, HttpMethod.Delete, token)).StatusCode);
    }
}
