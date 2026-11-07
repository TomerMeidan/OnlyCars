using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
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
using OnlyCars.Application.Common.Exceptions;
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

    private Task<Dictionary<string, Guid>> SeedAsync(Guid owner, string tag) => SeedAsync(db, owner, tag);

    // One of everything (criterion 1); every free-text value carries the tag, so another user's data is easy to search for.
    // Also seeds ACC-2's delete test on Postgres.
    internal static async Task<Dictionary<string, Guid>> SeedAsync(AppDbContext db, Guid owner, string tag)
    {
        var ids = new Dictionary<string, Guid>();
        Guid Id(string name) => ids[name] = Guid.NewGuid();
        var user = new User { Id = owner, Email = $"{tag}@onlycars.test", PasswordHash = $"HASH-{tag}", Currency = "EUR", Locale = Locale.He };
        var car = new Vehicle { Id = Id("car"), UserId = owner, Nickname = $"Car-{tag}", Make = "Mazda", Year = 2018, Vin = $"VIN{tag}",
            PhotoUrl = $"users/{owner}/vehicles/photo-{tag}.jpg", CurrentOdometerKm = 61_000, PurchasePrice = 12_345.67m,
            CreatedAt = DateTimeOffset.UtcNow.AddDays(-2) };
        var archived = new Vehicle { Id = Id("archived"), UserId = owner, Nickname = $"Old-{tag}", IsArchived = true,
            ArchivedAt = DateTimeOffset.UtcNow, CurrentOdometerKm = 200_000, CreatedAt = DateTimeOffset.UtcNow.AddDays(-1) };
        var template = new TaskTemplate { Key = $"oil-{tag}", Name = "Oil change", NameHe = "החלפת שמן", Category = TaskCategory.Oil, DefaultIntervalKm = 10_000 };
        var task = new MaintenanceTask { Id = Id("task"), VehicleId = car.Id, Template = template, Name = $"Oil-{tag}", Category = TaskCategory.Oil,
            IntervalKm = 10_000, LastDoneOdometerKm = 60_000, LastDoneDate = Day };
        var offTask = new MaintenanceTask { Id = Id("offTask"), VehicleId = car.Id, Name = $"Off-{tag}", IntervalDays = 365, IsEnabled = false,
            LastDoneDate = Day };
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
        var document = new VehicleDocument { Id = Id("document"), VehicleId = car.Id, Type = VehicleDocumentType.Insurance, ExpiryDate = Day.AddYears(1),
            Cost = 3_000, Notes = $"Policy-{tag}" };

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
            document,
            // SCAN-2a: a document file (its key is NoAction too).
            new Attachment { VehicleDocumentId = document.Id, FileUrl = $"users/{owner}/documents/key-{tag}.pdf", FileName = $"policy-{tag}.pdf",
                ContentType = "application/pdf", SizeBytes = 777 },
            new NotificationRule { UserId = owner, Channel = NotificationChannel.InApp, LeadDays = 14 },
            new Notification { UserId = owner, VehicleId = car.Id, Kind = NotificationKind.Task, RefId = task.Id, SnoozedUntil = Day.AddDays(400) });

        // A removed tire and one on the car bought with the record (its key is NoAction: ACC-2's delete test needs that path).
        var removedTire = new Tire { Id = Id("removedTire"), VehicleId = car.Id, Position = TirePosition.FL, Brand = $"Michelin-{tag}",
            Season = TireSeason.Winter, Notes = $"Garage-{tag}", FittedAt = Day, FittedOdometerKm = 50_000, RemovedAt = Day.AddDays(30),
            RemovedOdometerKm = 52_500 };
        var tire = new Tire { Id = Id("tire"), VehicleId = car.Id, Position = TirePosition.FR, Brand = $"Pirelli-{tag}", Season = TireSeason.Summer,
            FittedAt = Day, FittedOdometerKm = 60_000, ServiceRecordId = record.Id };
        var rotation = new TireRotation { Id = Id("rotation"), VehicleId = car.Id, Date = Day.AddDays(10), OdometerKm = 60_500, Notes = $"Rotate-{tag}",
            Moves = [new TireRotationMove { TireId = tire.Id, FromPosition = TirePosition.RR, ToPosition = TirePosition.FR }] };
        db.AddRange(removedTire, tire, rotation,
            new TireMeasurement { TireId = removedTire.Id, Position = TirePosition.FL, MeasuredAt = Day.AddDays(5), PressureBar = 2.2m },
            new TireMeasurement { TireId = tire.Id, Position = TirePosition.FR, MeasuredAt = Day.AddDays(5), PressureBar = 2.3m, TreadDepthMm = 6 });
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

        Assert.Equal(2, root.GetProperty("formatVersion").GetInt32());
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
        var policy = One(document.GetProperty("attachments"));
        Assert.Equal(("policy-mine.pdf", 777L), (policy.GetProperty("fileName").GetString(), policy.GetProperty("sizeBytes").GetInt64()));
        Assert.Equal(["fileName", "contentType", "sizeBytes", "createdAt"], policy.EnumerateObject().Select(p => p.Name));

        var template = One(root.GetProperty("checklistTemplates"));
        Assert.Equal("bar", One(template.GetProperty("items")).GetProperty("unit").GetString());

        Assert.False(root.TryGetProperty("tireSets", out _)); // format 2 (TIRE-2)
        var carTires = car.GetProperty("tires").EnumerateArray().ToList();
        Assert.Equal([ids["removedTire"], ids["tire"]], carTires.Select(t => t.GetProperty("id").GetGuid()));
        Assert.Equal(2_500m, carTires[0].GetProperty("kmOnTire").GetDecimal()); // removed: removal - fitted
        Assert.Equal(1_000m, carTires[1].GetProperty("kmOnTire").GetDecimal()); // on the car: current 61,000 - 60,000
        Assert.Equal("2026-03-31", carTires[0].GetProperty("removedAt").GetString());
        Assert.Equal(ids["record"], carTires[1].GetProperty("serviceRecordId").GetGuid());
        Assert.Equal("FR", carTires[1].GetProperty("position").GetString());
        Assert.Equal(2.3m, One(carTires[1].GetProperty("measurements")).GetProperty("pressureBar").GetDecimal());
        Assert.Equal("2026-03-06", One(carTires[0].GetProperty("measurements")).GetProperty("measuredAt").GetString());
        var rotation = One(car.GetProperty("rotations"));
        Assert.Equal("Rotate-mine", rotation.GetProperty("notes").GetString());
        var move = One(rotation.GetProperty("moves"));
        Assert.Equal((ids["tire"], "RR", "FR"), (move.GetProperty("tireId").GetGuid(), move.GetProperty("fromPosition").GetString(),
            move.GetProperty("toPosition").GetString()));
        Assert.Empty(cars[1].GetProperty("tires").EnumerateArray());
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
        var controller = new MeController(auth, new ExportService(db), new AccountService(db, auth))
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
        Assert.Contains("\n  \"formatVersion\": 2", text); // indented
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

/// <summary>EXP-1a backend: the ZIP export with every stored file. Criterion numbers refer to the ticket.</summary>
public class FullExportTests : FileTestBase
{
    private static readonly DateOnly Day = new(2026, 3, 1);
    private readonly Guid otherUserId = Guid.NewGuid();

    // ExportTests' user (car with photo, archived car, record, voided record, run photo) plus: a photo on the archived car, two cars with
    // one Hebrew name, a car named only "..", a record with two files of one name, a file on the voided record, an unsafe name, a lost file.
    // Returns each expected ZIP path with its storage key; every key but the lost one is stored, with random bytes.
    private async Task<Dictionary<string, string>> SeedAsync()
    {
        var ids = await ExportTests.SeedAsync(db, userId, "mine");
        await ExportTests.SeedAsync(db, otherUserId, "theirs");
        var now = DateTimeOffset.UtcNow;
        var archived = await db.Vehicles.FindAsync(ids["archived"]);
        archived!.PhotoUrl = $"users/{userId}/vehicles/{archived.Id}/photo/a.png";
        var hebrew = new Vehicle { UserId = userId, Nickname = "המאזדה שלי", CreatedAt = now.AddMinutes(1) };
        var hebrew2 = new Vehicle { UserId = userId, Nickname = "המאזדה שלי", CreatedAt = now.AddMinutes(2) };
        var dots = new Vehicle { UserId = userId, Nickname = "..", Make = "Honda", Model = "Jazz", CreatedAt = now.AddMinutes(3),
            PhotoUrl = $"users/{userId}/vehicles/x/photo/h.jpg" };
        var record = new ServiceRecord { VehicleId = hebrew.Id, Date = Day, OdometerKm = 1 };
        var record2 = new ServiceRecord { VehicleId = hebrew2.Id, Date = Day, OdometerKm = 1 };
        Attachment File(Guid recordId, string name, int minutes) => new()
        {
            ServiceRecordId = recordId, FileUrl = $"users/{userId}/r/{Guid.NewGuid()}", FileName = name, ContentType = "application/pdf",
            SizeBytes = 64, CreatedAt = now.AddMinutes(minutes)
        };
        var receipt = File(record.Id, "קבלה.pdf", 1);
        var receipt2 = File(record.Id, "קבלה.pdf", 2);
        var voided = File(ids["voided"], "void.pdf", 1);
        var unsafeName = File(record2.Id, "bad:/na*me?..pdf", 1);
        var lost = File(record2.Id, "gone.pdf", 2);
        db.AddRange(hebrew, hebrew2, dots, record, record2, receipt, receipt2, voided, unsafeName, lost);
        await db.SaveChangesAsync();

        foreach (var key in db.Attachments.Select(a => a.FileUrl).AsEnumerable()
                     .Concat(db.Vehicles.Where(v => v.PhotoUrl != null).Select(v => v.PhotoUrl!).AsEnumerable())
                     .Where(k => k != lost.FileUrl))
        {
            storage.Objects[key] = (RandomNumberGenerator.GetBytes(64), "application/octet-stream");
        }

        static string Folder(Guid id, DateOnly date) => $"{date:yyyy-MM-dd} {id.ToString()[..8]}";
        const string mine = "cars/Car-mine/";
        return new()
        {
            [mine + "photo.jpg"] = $"users/{userId}/vehicles/photo-mine.jpg",
            [$"{mine}services/{Folder(ids["record"], Day)}/receipt-mine.pdf"] = $"users/{userId}/receipts/key-mine.pdf",
            [$"{mine}services/{Folder(ids["voided"], Day.AddDays(1))}/void.pdf"] = voided.FileUrl,
            [$"{mine}checklist-runs/{Folder(ids["run"], Day)}/run-mine.jpg"] = $"users/{userId}/runs/key-mine.jpg",
            [$"{mine}documents/Insurance {Folder(ids["document"], Day.AddYears(1))}/policy-mine.pdf"] = $"users/{userId}/documents/key-mine.pdf",
            ["cars/Old-mine/photo.png"] = archived.PhotoUrl,
            [$"cars/המאזדה שלי/services/{Folder(record.Id, Day)}/קבלה.pdf"] = receipt.FileUrl,
            [$"cars/המאזדה שלי/services/{Folder(record.Id, Day)}/קבלה (2).pdf"] = receipt2.FileUrl,
            [$"cars/המאזדה שלי (2)/services/{Folder(record2.Id, Day)}/bad__na_me_.pdf"] = unsafeName.FileUrl,
            [$"cars/המאזדה שלי (2)/services/{Folder(record2.Id, Day)}/gone.pdf"] = lost.FileUrl,
            ["cars/Honda Jazz/photo.jpg"] = dots.PhotoUrl!,
        };
    }

    private FullExportService Service() => new(db, new ExportService(db), new ExportLinks(), storage);

    private async Task<ZipArchive> ZipAsync()
    {
        var output = new MemoryStream();
        await Service().WriteZipAsync(userId, output, MeController.ExportJson);
        output.Position = 0;
        return new ZipArchive(output, ZipArchiveMode.Read);
    }

    private static string Text(ZipArchiveEntry entry) => new StreamReader(entry.Open(), Encoding.UTF8).ReadToEnd();

    private static IEnumerable<string> Paths(JsonNode? node) => node switch
    {
        JsonObject o => o.SelectMany(p => p.Key == "path" ? [p.Value!.GetValue<string>()] : Paths(p.Value)),
        JsonArray a => a.SelectMany(Paths),
        _ => []
    };

    // The document without exportedAt and without the ZIP's path fields.
    private static JsonNode Comparable(string json)
    {
        var node = JsonNode.Parse(json)!;
        node.AsObject().Remove("exportedAt");
        Strip(node);
        return node;

        static void Strip(JsonNode? n)
        {
            if (n is JsonObject o)
            {
                o.Remove("path");
                foreach (var p in o)
                {
                    Strip(p.Value);
                }
            }
            else if (n is JsonArray a)
            {
                foreach (var i in a)
                {
                    Strip(i);
                }
            }
        }
    }

    [Fact]
    public async Task Criterion2And3_LayoutMatches_BytesEqual_DataJsonIsTheExportPlusPaths_NothingOfAnotherUser()
    {
        var expected = await SeedAsync();
        using var zip = await ZipAsync();

        var lost = expected.Keys.Single(p => p.EndsWith("gone.pdf"));
        Assert.Equal(["data.json", .. expected.Keys.Where(p => p != lost), "missing-files.txt"], zip.Entries.Select(e => e.FullName));
        foreach (var (path, key) in expected.Where(e => e.Key != lost))
        {
            using var copy = new MemoryStream();
            zip.GetEntry(path)!.Open().CopyTo(copy);
            Assert.Equal(storage.Objects[key].Content, copy.ToArray());
        }

        var data = Text(zip.GetEntry("data.json")!);
        var json = JsonSerializer.Serialize(await new ExportService(db).ExportAsync(userId), MeController.ExportJson);
        Assert.True(JsonNode.DeepEquals(Comparable(json), Comparable(data)));
        Assert.DoesNotContain("\"path\"", json); // the JSON export stays as it was
        // Every listed file has its path (the lost one too); car photos aren't listed, as in the JSON export.
        Assert.Equal(expected.Keys.Where(p => !p.Contains("/photo.")).Order(), Paths(JsonNode.Parse(data)).Order());
        Assert.DoesNotContain("theirs", data);
        Assert.DoesNotContain(otherUserId.ToString(), data);
    }

    [Fact]
    public async Task Criterion4_MissingFileIsListed_TheRestIsComplete_NoKeysOrLinks()
    {
        var expected = await SeedAsync();
        using var zip = await ZipAsync();

        var lost = expected.Keys.Single(p => p.EndsWith("gone.pdf"));
        Assert.Equal($"{lost} - not found in storage{Environment.NewLine}", Text(zip.GetEntry("missing-files.txt")!));
        Assert.Equal(expected.Count - 1 + 2, zip.Entries.Count);
        var texts = zip.Entries.Select(e => e.FullName).Append(Text(zip.GetEntry("data.json")!)).Append(Text(zip.GetEntry("missing-files.txt")!));
        foreach (var text in texts)
        {
            foreach (var banned in new[] { "users/", "https://", "signed.test", userId.ToString() })
            {
                Assert.DoesNotContain(banned, text);
            }
        }
    }

    [Fact]
    public async Task UnreadableFile_IsListed_AnotherUsersKeyIsNeverRead_ExportCompletes()
    {
        await ExportTests.SeedAsync(db, userId, "mine");
        var receipt = db.Attachments.Single(a => a.FileName == "receipt-mine.pdf");
        receipt.FileUrl = $"users/{otherUserId}/r/theirs.pdf";
        await db.SaveChangesAsync();
        storage.Objects[receipt.FileUrl] = ([1, 2, 3], "application/pdf");
        var opened = new List<string>();
        storage.OnOpen = key =>
        {
            opened.Add(key);
            throw new IOException("storage down");
        };
        using var zip = await ZipAsync();

        var missing = Text(zip.GetEntry("missing-files.txt")!).Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(4, missing.Length);
        Assert.Single(missing, l => l.EndsWith("receipt-mine.pdf - not found in storage"));
        Assert.Equal(3, missing.Count(l => l.EndsWith(" - could not be read from storage"))); // the car photo, the run photo and the document file
        Assert.DoesNotContain(receipt.FileUrl, opened);
        Assert.Equal(["data.json", "missing-files.txt"], zip.Entries.Select(e => e.FullName));
    }

    [Fact]
    public async Task StorageTimeout_IsListedAsUnreadable_ExportCompletes()
    {
        await ExportTests.SeedAsync(db, userId, "mine");
        storage.OnOpen = _ => throw new TaskCanceledException("HttpClient timeout"); // the request's own token is not cancelled
        using var zip = await ZipAsync();

        var missing = Text(zip.GetEntry("missing-files.txt")!).Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(4, missing.Count(l => l.EndsWith(" - could not be read from storage")));
    }

    [Theory]
    [InlineData("קבלה מוסך.pdf", "קבלה מוסך.pdf")]
    [InlineData("a\\b/c:d*e?f\"g<h>i|j.pdf", "a_b_c_d_e_f_g_h_i_j.pdf")]
    [InlineData("tab\there\u0001.jpg", "tab_here_.jpg")]
    [InlineData("../../etc/passwd", "_._etc_passwd")]
    [InlineData(" . file . ", "file")]
    [InlineData("a..b...pdf", "a.b.pdf")]
    [InlineData("CON", "CON_")]
    [InlineData("aux.pdf", "aux_.pdf")]
    [InlineData("console.pdf", "console.pdf")]
    [InlineData("...", null)]
    [InlineData("", null)]
    public void SafeName_RemovesWhatFileSystemsRefuse_KeepsHebrew(string name, string? expected)
    {
        var safe = FullExportService.SafeName(name, true);

        Assert.Equal(expected, safe);
        Assert.DoesNotContain("..", safe ?? "");
    }

    [Fact]
    public void SafeName_LongName_KeepsItsExtension_At80()
    {
        var safe = FullExportService.SafeName(new string('א', 200) + ".pdf", true)!;

        Assert.Equal(FullExportService.MaxNameLength, safe.Length);
        Assert.EndsWith("א.pdf", safe);
        Assert.Equal(80, FullExportService.SafeName(new string('x', 200), false)!.Length);
    }

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow() => Now;
    }

    [Fact]
    public void Criterion3_LinkWorksOnce_For60Seconds_OnlyForItsUser()
    {
        var clock = new Clock();
        var links = new ExportLinks(clock);
        var mine = links.Create(userId);
        var theirs = links.Create(otherUserId);

        Assert.Equal(43, mine.Token.Length); // 32 random bytes, base64url
        Assert.NotEqual(mine.Token, theirs.Token);
        Assert.Equal(clock.Now.AddSeconds(60), mine.ExpiresAt);
        Assert.Equal(otherUserId, links.Take(theirs.Token));
        Assert.Equal("export.linkExpired", Assert.Throws<LinkExpiredException>(() => links.Take(theirs.Token)).Code); // used

        clock.Now = clock.Now.AddSeconds(59);
        Assert.Equal(userId, links.Peek(mine.Token));
        clock.Now = clock.Now.AddSeconds(1);
        Assert.Null(links.Peek(mine.Token));
        Assert.Equal("export.linkExpired", Assert.Throws<LinkExpiredException>(() => links.Take(mine.Token)).Code); // expired
        Assert.Throws<LinkExpiredException>(() => links.Take("made-up"));
    }

    [Fact]
    public async Task Criterion1And3_Http_PostGivesALink_GetStreamsThatUsersZipOnce()
    {
        var expected = await SeedAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;

        var (status, body) = await ReadAsync(await client.PostAsync("/api/me/export/full", null));
        Assert.Equal(HttpStatusCode.OK, status);
        var url = body.GetProperty("url").GetString()!;
        Assert.Matches("^/api/me/export/full/[A-Za-z0-9_-]{43}$", url);
        Assert.InRange(body.GetProperty("expiresAt").GetDateTimeOffset() - DateTimeOffset.UtcNow, TimeSpan.FromSeconds(55), TimeSpan.FromSeconds(61));

        // A plain browser download: no sign-in, or signed in as someone else; the link decides whose ZIP it is.
        using var other = new HttpClient { BaseAddress = client.BaseAddress };
        other.DefaultRequestHeaders.Add("X-Test-User", otherUserId.ToString());
        var response = await other.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/zip", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        Assert.Equal($"onlycars-export-{DateTime.UtcNow:yyyy-MM-dd}.zip", response.Content.Headers.ContentDisposition!.FileName);
        using var zip = new ZipArchive(new MemoryStream(await response.Content.ReadAsByteArrayAsync()), ZipArchiveMode.Read);
        Assert.Equal(["data.json", .. expected.Keys.Where(p => !p.EndsWith("gone.pdf")), "missing-files.txt"], zip.Entries.Select(e => e.FullName));
        var data = Text(zip.GetEntry("data.json")!);
        Assert.Contains("mine@onlycars.test", data);
        Assert.DoesNotContain("theirs", data);
        Assert.DoesNotContain(url.Split('/')[^1], data);

        using var anonymous = new HttpClient { BaseAddress = client.BaseAddress };
        var (again, error) = await ReadAsync(await anonymous.GetAsync(url));
        Assert.Equal(HttpStatusCode.NotFound, again);
        Assert.Equal("export.linkExpired", error.GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsync("/api/me/export/full", null)).StatusCode);
    }

    [Fact]
    public async Task Criterion5_SecondZipDownloadAtOnceIs429_AndLeavesItsTokenUnused()
    {
        await SeedAsync();
        var (app, client) = await StartAsync();
        await using var _ = app;
        var opened = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        storage.OnOpen = async key =>
        {
            opened.TrySetResult();
            await release.Task;
            return new MemoryStream(storage.Objects.GetValueOrDefault(key).Content ?? [], writable: false);
        };
        async Task<string> LinkAsync() => (await ReadAsync(await client.PostAsync("/api/me/export/full", null))).Body.GetProperty("url").GetString()!;

        var first = client.GetAsync(await LinkAsync());
        await opened.Task.WaitAsync(TimeSpan.FromSeconds(10));
        var second = await LinkAsync();
        var (status, body) = await ReadAsync(await client.GetAsync(second));
        release.SetResult();

        Assert.Equal(HttpStatusCode.TooManyRequests, status);
        Assert.Equal("http.429", body.GetProperty("code").GetString());
        Assert.Equal(HttpStatusCode.OK, (await first).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(second)).StatusCode); // the refused GET didn't use the token up
    }

    [Fact]
    public async Task NoStorage_PostIs503()
    {
        var (app, client) = await StartAsync(withStorage: false);
        await using var _ = app;

        var (status, body) = await ReadAsync(await client.PostAsync("/api/me/export/full", null));

        Assert.Equal(HttpStatusCode.ServiceUnavailable, status);
        Assert.Equal("file.storageUnavailable", body.GetProperty("code").GetString());
    }

    // Write-only and not seekable, like the response body; counts the synchronous writes.
    private sealed class ResponseLike : Stream
    {
        public long Written;
        public long PeakMemory;

        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public long WrittenSync;

        public override void Write(byte[] buffer, int offset, int count)
        {
            WrittenSync += count;
            Written += count;
        }

        public override ValueTask WriteAsync(ReadOnlyMemory<byte> buffer, CancellationToken ct = default)
        {
            Written += buffer.Length;
            PeakMemory = Math.Max(PeakMemory, GC.GetTotalMemory(false));
            return default;
        }

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken ct) =>
            WriteAsync(buffer.AsMemory(offset, count), ct).AsTask();
    }

    [Fact]
    public async Task Criterion5_FiftyFilesOf10MB_StreamOneAtATime_MemoryDoesNotGrowWithTheTotal()
    {
        const int size = 10 * 1024 * 1024;
        db.Users.Add(new User { Id = userId, Email = "big@onlycars.test", PasswordHash = "x" });
        var car = new Vehicle { UserId = userId, Nickname = "Big" };
        db.Vehicles.Add(car);
        for (var r = 0; r < 5; r++)
        {
            var record = new ServiceRecord { VehicleId = car.Id, Date = Day.AddDays(r), OdometerKm = r };
            db.ServiceRecords.Add(record);
            for (var f = 0; f < 10; f++)
            {
                db.Attachments.Add(new Attachment { ServiceRecordId = record.Id, FileUrl = $"users/{userId}/big/{r}-{f}", FileName = "scan.pdf",
                    ContentType = "application/pdf", SizeBytes = size });
            }
        }
        await db.SaveChangesAsync();

        var content = RandomNumberGenerator.GetBytes(size); // one buffer behind every file, so the fake storage holds 10 MB, not 500
        var output = new ResponseLike();
        var writtenAtOpen = new List<long>();
        storage.OnOpen = _ =>
        {
            writtenAtOpen.Add(output.Written);
            return Task.FromResult<Stream?>(new MemoryStream(content, writable: false));
        };
        var before = GC.GetTotalMemory(true);

        await Service().WriteZipAsync(userId, output, MeController.ExportJson);

        Assert.Equal(50, writtenAtOpen.Count);
        Assert.True(output.Written > 50L * size);
        // Each file is in the response before the next one is opened.
        Assert.All(writtenAtOpen.Select((written, i) => (written, i)), x => Assert.True(x.written >= (long)x.i * size));
        Assert.True(output.WrittenSync < 64 * 1024, $"{output.WrittenSync} bytes written synchronously"); // only the entries' trailers
        Assert.True(output.PeakMemory - before < 150L * 1024 * 1024, $"grew {(output.PeakMemory - before) / 1024 / 1024} MB for 500 MB of files");
    }
}
