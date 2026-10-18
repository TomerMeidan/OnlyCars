using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using OnlyCars.Api.Common;
using OnlyCars.Api.Controllers;
using OnlyCars.Application.Account;
using OnlyCars.Application.Auth;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>ACC-1 backend: GET /api/me/export. Criterion numbers refer to the ticket.</summary>
public class ExportTests
{
    private static readonly DateOnly Day = new(2026, 3, 1);
    private readonly AppDbContext db = TestDbContextFactory.Create();
    private readonly Guid userId = Guid.NewGuid();
    private readonly Guid otherUserId = Guid.NewGuid();

    // One of everything (criterion 1); every free-text value carries the tag, so another user's data is easy to search for.
    private async Task<Dictionary<string, Guid>> SeedAsync(Guid owner, string tag)
    {
        var ids = new Dictionary<string, Guid>();
        Guid Id(string name) => ids[name] = Guid.NewGuid();
        var user = new User { Id = owner, Email = $"{tag}@onlycars.test", PasswordHash = $"HASH-{tag}", Currency = "EUR", Locale = Locale.He };
        var car = new Vehicle { Id = Id("car"), UserId = owner, Nickname = $"Car-{tag}", Make = "Mazda", Year = 2018, Vin = $"VIN{tag}",
            PhotoUrl = $"users/{owner}/vehicles/photo-{tag}.jpg", CurrentOdometerKm = 61_000, PurchasePrice = 12_345.67m,
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-2) };
        var archived = new Vehicle { Id = Id("archived"), UserId = owner, Nickname = $"Old-{tag}", IsArchived = true,
            ArchivedAt = DateTimeOffset.UtcNow, CurrentOdometerKm = 200_000, CreatedAt = DateTimeOffset.UtcNow.AddDays(-1) };
        var template = new TaskTemplate { Key = $"oil-{tag}", Name = "Oil change", Category = TaskCategory.Oil };
        var task = new MaintenanceTask { Id = Id("task"), VehicleId = car.Id, Template = template, Name = $"Oil-{tag}", Category = TaskCategory.Oil,
            IntervalKm = 10_000, LastDoneOdometerKm = 60_000, LastDoneDate = Day };
        var offTask = new MaintenanceTask { Id = Id("offTask"), VehicleId = car.Id, Name = $"Off-{tag}", IsEnabled = false, LastDoneDate = Day };
        var record = new ServiceRecord { Id = Id("record"), VehicleId = car.Id, Date = Day, OdometerKm = 60_000, ShopName = $"Shop-{tag}",
            TotalCost = 450.5m, Notes = $"Notes-{tag}" };
        var voided = new ServiceRecord { Id = Id("voided"), VehicleId = car.Id, Date = Day.AddDays(1), OdometerKm = 60_100, IsVoided = true };
        var checklistTemplate = new ChecklistTemplate { Id = Id("template"), UserId = owner, Name = $"Weekly-{tag}" };
        var templateItem = new ChecklistTemplateItem { Id = Id("templateItem"), TemplateId = checklistTemplate.Id, Label = $"Tires-{tag}",
            Type = ChecklistItemType.Number, Unit = "bar", MinValue = 2, MaxValue = 2.5m };
        var checklist = new VehicleChecklist { Id = Id("checklist"), VehicleId = car.Id, TemplateId = checklistTemplate.Id, IntervalDays = 7,
            IsEnabled = false, LastRunDate = Day, LastRunOdometerKm = 60_500, StartDate = Day, StartOdometerKm = 60_000 };
        var run = new ChecklistRun { Id = Id("run"), VehicleChecklistId = checklist.Id, RunAt = Day, OdometerKm = 60_500, Notes = $"Run-{tag}" };
        var runItem = new ChecklistRunItem { Id = Id("runItem"), RunId = run.Id, TemplateItemId = templateItem.Id, LabelSnapshot = $"Tires-{tag}",
            Type = ChecklistItemType.Number, Unit = "bar", NumberValue = 1.8m, IsFlagged = true };

        db.AddRange(user, car, archived, template, task, offTask, record, voided, checklistTemplate, templateItem, checklist, run, runItem,
            new OdometerReading { Id = Id("reading"), VehicleId = car.Id, ValueKm = 60_000, ReadingDate = Day, Source = OdometerSource.Service,
                ServiceRecordId = record.Id },
            new ServiceRecordTask { ServiceRecordId = record.Id, MaintenanceTaskId = task.Id, PreviousLastDoneDate = Day },
            new ServiceItem { ServiceRecordId = record.Id, Description = $"Filter-{tag}", Brand = "Bosch", PartNumber = "F-1", Quantity = 2,
                UnitCost = 25.25m },
            new Attachment { ServiceRecordId = record.Id, FileUrl = $"users/{owner}/receipts/key-{tag}.pdf", FileName = $"receipt-{tag}.pdf",
                ContentType = "application/pdf", SizeBytes = 1234 },
            new Attachment { ChecklistRunId = run.Id, FileUrl = $"users/{owner}/runs/key-{tag}.jpg", FileName = $"run-{tag}.jpg",
                ContentType = "image/jpeg", SizeBytes = 999 },
            new Issue { Id = Id("issue"), VehicleId = car.Id, Title = $"Fix-{tag}", Status = IssueStatus.Done, ResolvedAt = Day,
                SourceRunItemId = runItem.Id, Description = "\u200F\u2068לחץ\u2069 \u2066 2.1 bar\u2067\u200E" },
            new VehicleDocument { Id = Id("document"), VehicleId = car.Id, Type = VehicleDocumentType.Insurance, ExpiryDate = Day.AddYears(1),
                Cost = 3_000, Notes = $"Policy-{tag}" },
            new NotificationRule { UserId = owner, Channel = NotificationChannel.InApp, LeadDays = 14 },
            new Notification { UserId = owner, VehicleId = car.Id, Kind = NotificationKind.Task, RefId = task.Id, SnoozedUntil = Day.AddDays(400) });

        var set = new TireSet { Id = Id("tireSet"), UserId = owner, Brand = $"Michelin-{tag}", Season = TireSeason.Winter, Notes = $"Garage-{tag}" };
        var closed = new TireMount { Id = Id("closedMount"), TireSetId = set.Id, VehicleId = car.Id, MountedAt = Day, MountOdometerKm = 50_000,
            UnmountedAt = Day.AddDays(30), UnmountOdometerKm = 52_500 };
        var open = new TireMount { Id = Id("openMount"), TireSetId = set.Id, VehicleId = car.Id, MountedAt = Day.AddDays(60), MountOdometerKm = 60_000 };
        var check = new TireCheck { TireMountId = closed.Id, MeasuredAt = Day.AddDays(5) };
        db.AddRange(set, closed, open, check,
            new TireMeasurement { TireCheckId = check.Id, Position = TirePosition.FR, PressureBar = 2.3m, TreadDepthMm = 6 },
            new TireMeasurement { TireCheckId = check.Id, Position = TirePosition.FL, PressureBar = 2.2m },
            new TireRotation { TireMountId = closed.Id, Date = Day.AddDays(10), OdometerKm = 51_000, Notes = $"Rotate-{tag}" },
            // Not on a car: no mounts.
            new TireSet { Id = Id("spareSet"), UserId = owner, Brand = $"Spare-{tag}", Season = TireSeason.Summer });
        await db.SaveChangesAsync();
        return ids;
    }

    private async Task<(JsonElement Root, string Text)> ExportAsync(Guid owner)
    {
        var text = JsonSerializer.Serialize(await new ExportService(db).ExportAsync(owner), MeController.ExportJson);
        return (JsonDocument.Parse(text).RootElement, text);
    }

    private static JsonElement One(JsonElement list) => Assert.Single(list.EnumerateArray());

    [Fact]
    public async Task Criterion1_ExportsEverythingWithStoredValues()
    {
        var ids = await SeedAsync(userId, "mine");
        var (root, _) = await ExportAsync(userId);

        Assert.Equal(1, root.GetProperty("formatVersion").GetInt32());
        Assert.Equal("km", root.GetProperty("units").GetProperty("distance").GetString());
        Assert.Equal("EUR", root.GetProperty("units").GetProperty("currency").GetString());
        var account = root.GetProperty("account");
        Assert.Equal("mine@onlycars.test", account.GetProperty("email").GetString());
        Assert.Equal("He", account.GetProperty("locale").GetString());
        Assert.Equal(14, account.GetProperty("reminderLeadDays").GetInt32());

        var cars = root.GetProperty("vehicles").EnumerateArray().ToList();
        Assert.Equal([ids["car"], ids["archived"]], cars.Select(c => c.GetProperty("id").GetGuid())); // oldest first
        Assert.True(cars[1].GetProperty("isArchived").GetBoolean());
        var car = cars[0];
        Assert.True(car.GetProperty("hasPhoto").GetBoolean());
        Assert.False(cars[1].GetProperty("hasPhoto").GetBoolean());
        Assert.Equal(12_345.67m, car.GetProperty("purchasePrice").GetDecimal());

        var reading = One(car.GetProperty("odometerReadings"));
        Assert.Equal("Service", reading.GetProperty("source").GetString());
        Assert.Equal("2026-03-01", reading.GetProperty("readingDate").GetString());
        Assert.Equal(ids["record"], reading.GetProperty("serviceRecordId").GetGuid());

        var tasks = car.GetProperty("maintenanceTasks").EnumerateArray().ToList();
        Assert.Equal("oil-mine", tasks.Single(t => t.GetProperty("id").GetGuid() == ids["task"]).GetProperty("templateKey").GetString());
        Assert.False(tasks.Single(t => t.GetProperty("id").GetGuid() == ids["offTask"]).GetProperty("isEnabled").GetBoolean());

        var records = car.GetProperty("serviceRecords").EnumerateArray().ToList();
        Assert.Equal([ids["record"], ids["voided"]], records.Select(r => r.GetProperty("id").GetGuid()));
        Assert.True(records[1].GetProperty("isVoided").GetBoolean());
        Assert.Equal(450.5m, records[0].GetProperty("totalCost").GetDecimal());
        Assert.Equal(ids["task"], One(records[0].GetProperty("taskIds")).GetGuid());
        var item = One(records[0].GetProperty("items"));
        Assert.Equal("Filter-mine", item.GetProperty("description").GetString());
        Assert.Equal(25.25m, item.GetProperty("unitCost").GetDecimal());
        var receipt = One(records[0].GetProperty("attachments"));
        Assert.Equal("receipt-mine.pdf", receipt.GetProperty("fileName").GetString());
        Assert.Equal(1234, receipt.GetProperty("sizeBytes").GetInt64());
        Assert.Equal(["fileName", "contentType", "sizeBytes", "createdAt"], receipt.EnumerateObject().Select(p => p.Name));

        var checklist = One(car.GetProperty("checklists"));
        Assert.False(checklist.GetProperty("isEnabled").GetBoolean());
        Assert.Equal(ids["template"], checklist.GetProperty("templateId").GetGuid());
        var run = One(checklist.GetProperty("runs"));
        var runItem = One(run.GetProperty("items"));
        Assert.True(runItem.GetProperty("isFlagged").GetBoolean());
        Assert.Equal(1.8m, runItem.GetProperty("numberValue").GetDecimal());
        Assert.Equal("Tires-mine", runItem.GetProperty("label").GetString());
        Assert.Equal("run-mine.jpg", One(run.GetProperty("photos")).GetProperty("fileName").GetString());

        var issue = One(car.GetProperty("issues"));
        Assert.Equal("Done", issue.GetProperty("status").GetString());
        Assert.Equal(ids["runItem"], issue.GetProperty("sourceRunItemId").GetGuid());
        var document = One(car.GetProperty("documents"));
        Assert.Equal("Insurance", document.GetProperty("type").GetString());
        Assert.Equal(3_000m, document.GetProperty("cost").GetDecimal());

        var template = One(root.GetProperty("checklistTemplates"));
        Assert.Equal("bar", One(template.GetProperty("items")).GetProperty("unit").GetString());

        var sets = root.GetProperty("tireSets").EnumerateArray().ToList();
        Assert.Equal(2, sets.Count);
        Assert.Empty(sets.Single(s => s.GetProperty("id").GetGuid() == ids["spareSet"]).GetProperty("mounts").EnumerateArray());
        var mounts = sets.Single(s => s.GetProperty("id").GetGuid() == ids["tireSet"]).GetProperty("mounts").EnumerateArray().ToList();
        Assert.Equal(2_500m, mounts[0].GetProperty("kmDriven").GetDecimal()); // unmounted: unmount - mount
        Assert.Equal(1_000m, mounts[1].GetProperty("kmDriven").GetDecimal()); // on the car: current 61,000 - 60,000
        var tireCheck = One(mounts[0].GetProperty("checks"));
        Assert.Equal(["FL", "FR"], tireCheck.GetProperty("measurements").EnumerateArray().Select(m => m.GetProperty("position").GetString()));
        Assert.Equal("Rotate-mine", One(mounts[0].GetProperty("rotations")).GetProperty("notes").GetString());
    }

    [Fact]
    public async Task Criterion4_ToDoDescriptionsLoseDirectionMarks()
    {
        await SeedAsync(userId, "mine");
        var (root, _) = await ExportAsync(userId);

        var description = One(root.GetProperty("vehicles")[0].GetProperty("issues")).GetProperty("description").GetString();
        Assert.Equal("לחץ  2.1 bar", description);
        Assert.Null(ExportService.StripDirectionMarks(null));
    }

    [Fact]
    public async Task Criterion2_NoOtherUsersData_NoSecrets_NoStorageKeys_NoLinks_NoSnoozes()
    {
        await SeedAsync(userId, "mine");
        var other = await SeedAsync(otherUserId, "theirs");
        var (_, text) = await ExportAsync(userId);

        Assert.DoesNotContain("theirs", text);
        Assert.DoesNotContain(otherUserId.ToString(), text);
        Assert.All(other.Values, id => Assert.DoesNotContain(id.ToString(), text));
        foreach (var banned in new[] { "HASH-", "passwordHash", "fileUrl", "photoUrl", "users/", "key-mine", "https://", "http://",
                     "snoozedUntil", "sentAt", "lockout" })
        {
            Assert.DoesNotContain(banned, text, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task UserWithNoCars_GetsEmptyLists()
    {
        db.Users.Add(new User { Id = userId, Email = "empty@onlycars.test", PasswordHash = "x" });
        await db.SaveChangesAsync();
        await SeedAsync(otherUserId, "theirs");
        var (root, _) = await ExportAsync(userId);

        Assert.Empty(root.GetProperty("vehicles").EnumerateArray());
        Assert.Empty(root.GetProperty("checklistTemplates").EnumerateArray());
        Assert.Empty(root.GetProperty("tireSets").EnumerateArray());
        Assert.Equal(NotificationRule.DefaultLeadDays, root.GetProperty("account").GetProperty("reminderLeadDays").GetInt32());
        Assert.Equal("ILS", root.GetProperty("units").GetProperty("currency").GetString());
    }

    [Fact]
    public async Task SameData_ExportsIdenticallyApartFromExportedAt()
    {
        await SeedAsync(userId, "mine");
        static string WithoutTime(string text) => System.Text.RegularExpressions.Regex.Replace(text, "\"exportedAt\": \"[^\"]+\"", "");

        Assert.Equal(WithoutTime((await ExportAsync(userId)).Text), WithoutTime((await ExportAsync(userId)).Text));
    }

    [Fact]
    public async Task SameDay_TiesBreakByCreatedAtThenId_RunsCarryReadingAndRange()
    {
        db.Users.Add(new User { Id = userId, Email = "ties@onlycars.test", PasswordHash = "x" });
        var car = new Vehicle { UserId = userId, Nickname = "Ties", CurrentOdometerKm = 1_000 };
        // The later-created reading has the smaller id, so only CreatedAt puts it second.
        var first = new OdometerReading { Id = Guid.Parse("ffffffff-0000-0000-0000-000000000000"), VehicleId = car.Id, ValueKm = 900,
            ReadingDate = Day, Source = OdometerSource.Manual, CreatedAt = DateTimeOffset.UtcNow.AddMinutes(-5) };
        var second = new OdometerReading { Id = Guid.Parse("00000000-0000-0000-0000-000000000001"), VehicleId = car.Id, ValueKm = 1_000,
            ReadingDate = Day, Source = OdometerSource.Checklist, CreatedAt = DateTimeOffset.UtcNow };
        var template = new ChecklistTemplate { UserId = userId, Name = "T" };
        var checklist = new VehicleChecklist { VehicleId = car.Id, TemplateId = template.Id, IntervalDays = 7, LastRunDate = Day, StartDate = Day };
        var run = new ChecklistRun { VehicleChecklistId = checklist.Id, RunAt = Day, OdometerKm = 1_000, OdometerReadingId = second.Id };
        db.AddRange(car, first, second, template, checklist, run, new ChecklistRunItem { RunId = run.Id, LabelSnapshot = "Tires",
            Type = ChecklistItemType.Number, Unit = "bar", MinValue = 2, MaxValue = 2.5m, NumberValue = 2.2m });
        await db.SaveChangesAsync();

        var exported = (await ExportAsync(userId)).Root.GetProperty("vehicles")[0];

        Assert.Equal([first.Id, second.Id], exported.GetProperty("odometerReadings").EnumerateArray().Select(r => r.GetProperty("id").GetGuid()));
        var exportedRun = One(One(exported.GetProperty("checklists")).GetProperty("runs"));
        Assert.Equal(second.Id, exportedRun.GetProperty("odometerReadingId").GetGuid());
        var item = One(exportedRun.GetProperty("items"));
        Assert.Equal((2m, 2.5m), (item.GetProperty("minValue").GetDecimal(), item.GetProperty("maxValue").GetDecimal()));
    }

    [Fact]
    public async Task Criterion3_Controller_ReturnsAttachmentJsonNoStore()
    {
        await SeedAsync(userId, "mine");
        var auth = new AuthService(db, new PasswordHasher<User>(), new FakeJwtTokenService(), new MemoryCache(new MemoryCacheOptions()),
            Options.Create(new RateLimitOptions()));
        var controller = new MeController(auth, new ExportService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", userId.ToString())])) }
            }
        };

        var body = new MemoryStream();
        controller.Response.Body = body;

        await controller.Export(CancellationToken.None);

        var name = $"onlycars-export-{DateTime.UtcNow:yyyy-MM-dd}.json";
        Assert.Equal($"attachment; filename={name}; filename*=UTF-8''{name}", controller.Response.Headers.ContentDisposition.ToString());
        Assert.Equal("application/json; charset=utf-8", controller.Response.ContentType);
        Assert.Equal("no-store", controller.Response.Headers.CacheControl.ToString());
        Assert.NotEqual(0xEF, body.ToArray()[0]); // no UTF-8 BOM
        var text = Encoding.UTF8.GetString(body.ToArray());
        Assert.Contains("Weekly-mine", text); // written to the response, not buffered in a result
        Assert.Contains("\n  \"formatVersion\": 1", text); // indented
        Assert.Contains("Car-mine", text);
    }

    [Fact]
    public void Criterion3_ExportNeedsSignInAndUsesTheExportLimit()
    {
        Assert.NotNull(typeof(MeController).GetCustomAttribute<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>());
        var action = typeof(MeController).GetMethod(nameof(MeController.Export))!;
        Assert.Equal(RequestLimits.ExportPolicy, action.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
        Assert.Equal("export", action.GetCustomAttribute<HttpGetAttribute>()!.Template);
    }

    private static async Task<(WebApplication App, HttpClient Client)> StartLimitedAsync(Func<Task> handler)
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddRequestLimits(builder.Configuration); // production defaults: 1 at once, 5 per 10 minutes
        builder.Services.AddAuthentication();
        builder.Services.AddCors(o => o.AddPolicy("test", p => p.WithOrigins("http://client.test")));
        var app = builder.Build();
        app.UseNoSniff();
        // A stand-in for the JWT: the X-User header signs the request in as that user.
        app.Use((ctx, next) =>
        {
            if (ctx.Request.Headers["X-User"].ToString() is { Length: > 0 } user)
            {
                ctx.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", user)], "test"));
            }
            return next();
        });
        app.UseRequestLimits("test");
        app.MapGet("/export", async () => { await handler(); return "ok"; }).RequireRateLimiting(RequestLimits.ExportPolicy);
        await app.StartAsync();
        return (app, new HttpClient { BaseAddress = new Uri(app.Urls.First()) });
    }

    [Fact]
    public async Task Criterion3_SixthExportInTheWindowIs429()
    {
        var (app, client) = await StartLimitedAsync(() => Task.CompletedTask);
        await using var _ = app;

        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/export")).StatusCode);
        }
        var rejected = await client.GetAsync("/export");

        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.True(rejected.Headers.Contains("Retry-After"));
        Assert.Equal("http.429", JsonDocument.Parse(await rejected.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Criterion3_SecondExportWhileOneRunsIs429()
    {
        var release = new TaskCompletionSource();
        var started = new TaskCompletionSource();
        var (app, client) = await StartLimitedAsync(async () => { started.TrySetResult(); await release.Task; });
        await using var _ = app;

        var first = client.GetAsync("/export");
        await started.Task;
        var second = await client.GetAsync("/export");
        release.SetResult();

        Assert.Equal(HttpStatusCode.TooManyRequests, second.StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await first).StatusCode);
    }

    private static Task<HttpResponseMessage> GetAsUser(HttpClient client, string user) =>
        client.SendAsync(new HttpRequestMessage(HttpMethod.Get, "/export") { Headers = { { "X-User", user } } });

    [Fact]
    public async Task FourthExportAtOnceAppWideIs429_AndUsesNoneOfThatUsersWindow()
    {
        var release = new TaskCompletionSource();
        var started = 0;
        var allStarted = new TaskCompletionSource();
        var (app, client) = await StartLimitedAsync(async () =>
        {
            if (Interlocked.Increment(ref started) == RequestLimits.MaxExportsAtOnce)
            {
                allStarted.TrySetResult();
            }
            await release.Task;
        });
        await using var _ = app;

        var running = Enumerable.Range(0, RequestLimits.MaxExportsAtOnce).Select(i => GetAsUser(client, $"user-{i}")).ToList();
        await allStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var fourth = await GetAsUser(client, "user-late");
        release.SetResult();

        Assert.Equal(HttpStatusCode.TooManyRequests, fourth.StatusCode);
        Assert.Equal("http.429", JsonDocument.Parse(await fourth.Content.ReadAsStringAsync()).RootElement.GetProperty("code").GetString());
        Assert.All(await Task.WhenAll(running), r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        // The rejected user still has all 5 exports in the window.
        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await GetAsUser(client, "user-late")).StatusCode);
        }
    }

    [Fact]
    public async Task EveryResponseIsNoSniff()
    {
        var (app, client) = await StartLimitedAsync(() => Task.CompletedTask);
        await using var _ = app;

        var responses = new List<HttpResponseMessage> { await client.GetAsync("/missing") };
        for (var i = 0; i < 6; i++)
        {
            responses.Add(await client.GetAsync("/export"));
        }

        Assert.Equal([HttpStatusCode.NotFound, HttpStatusCode.OK, HttpStatusCode.TooManyRequests],
            new[] { responses[0], responses[1], responses[6] }.Select(r => r.StatusCode));
        Assert.All(responses, r => Assert.Equal("nosniff", Assert.Single(r.Headers.GetValues("X-Content-Type-Options"))));
    }
}
