using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using OnlyCars.Api.Middleware;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>DB-1b: the results recorded on SQL Server (BehaviourRecorded), run on Postgres. Criterion numbers refer to the ticket.</summary>
public class BehaviourParityTests : IAsyncLifetime
{
    private readonly AppDbContext db = new(TestDbContextFactory.PostgresOptions(TestDbContextFactory.NewPostgresConnection()).Options);

    public async Task InitializeAsync() => await db.Database.MigrateAsync();

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    // Every line that differs from the recording, and why. docs/contracts/DB-1b.md lists the same ones for the PM.
    private static readonly Dictionary<string, string> SearchDifferences = new()
    {
        // Letters SQL Server expanded: ss for sharp s, and the dotted capital I. Not in the ticket's Hebrew or mixed-case English.
        ["strasse => sharpS"] = "strasse => ",
        ["STRASSE => sharpS"] = "STRASSE => ",
        ["istanbul => dottedI"] = "istanbul => ",
        ["İstanbul => dottedI"] = "İstanbul => ",
        // Width: the difference the ticket accepts.
        ["ＯＩＬ => enNotes,template"] = "ＯＩＬ => ",
        ["ｓｐｅｅｄｙ => enShop"] = "ｓｐｅｅｄｙ => ",
        // The fi ligature, expanded the same way.
        ["ﬁlter => template"] = "ﬁlter => ",
    };

    // Saved without its trailing spaces, so the check and the index see what SQL Server's did; the VIN then reads back without them.
    private static readonly Dictionary<string, string> VinDifferences = new()
    {
        ["edit its own ABC123 to 'ABC123 ' => 'ABC123 '"] = "edit its own ABC123 to 'ABC123 ' => 'ABC123'",
        ["edit its own ABC123 to 'abc123   ' => 'abc123   '"] = "edit its own ABC123 to 'abc123   ' => 'abc123'",
    };

    private static void AssertRecorded(string[] recorded, List<string> actual, Dictionary<string, string>? differences = null)
    {
        var expected = recorded.Select(line => differences?.GetValueOrDefault(line) ?? line).ToList();
        Assert.Equal(expected.Count, actual.Count);
        Assert.All(expected.Zip(actual), pair => Assert.Equal(pair.First, pair.Second));
    }

    // --- Criterion 1 ---

    [Fact]
    public async Task Criterion1_Search_GivesTheRecordedResults() =>
        AssertRecorded(BehaviourRecorded.Search, await BehaviourScenarios.SearchAsync(db), SearchDifferences);

    [Fact]
    public async Task Criterion1_TheLongestSearches_RunOnPostgres_AndAStoredNewlineIsNoProblem()
    {
        var user = new User { Email = "long@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = "Car" };
        db.AddRange(user, car, new ServiceRecord { Vehicle = car, Date = new(2025, 1, 1), Notes = "first line\n" + new string('ם', 100) + " \U0001F697" });
        await db.SaveChangesAsync();
        var tasks = new MaintenanceTaskService(db, new VehicleService(db));

        Assert.Equal(1, (await tasks.SearchRecordsAsync(user.Id, null, null, null, null, new string('מ', 100), 0, 10)).TotalCount); // every letter in its other form
        Assert.Equal(1, (await tasks.SearchRecordsAsync(user.Id, null, null, null, null, "\U0001F697 first line", 0, 10)).TotalCount); // a whole emoji, across lines
        Assert.Equal(0, (await tasks.SearchRecordsAsync(user.Id, null, null, null, null, new string('(', 100), 0, 10)).TotalCount);
        Assert.Equal(0, (await tasks.SearchRecordsAsync(user.Id, null, null, null, null, "a* b+ c? d. e| f^ g$ h{ i} j(", 0, 10)).TotalCount);
    }

    [Fact]
    public void Search_OnPostgres_SendsTheWordAsAParameter()
    {
        // ToQueryString needs no database.
        using var sql = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql("Host=none;Database=none", AppDbContext.NpgsqlOptions).Options);
        var pattern = TextRules.SearchPattern("x");

        var text = sql.ServiceRecords.Where(r => r.Notes != null && System.Text.RegularExpressions.Regex.IsMatch(r.Notes, pattern, System.Text.RegularExpressions.RegexOptions.IgnoreCase)).ToQueryString();

        Assert.Contains("~*", text);
        Assert.Contains("@pattern", text);
    }

    [Theory]
    [InlineData("\\", @"\\")]
    [InlineData("a.b", @"a\.b")]
    [InlineData("%_-", "%_-")] // nothing special in a pattern; escaping _ would be an error in .NET
    [InlineData("[(*)]", @"\[\(\*\)\]")]
    public void SearchPattern_EscapesWhatIsSpecial_BetweenTheMarks(string word, string escaped)
    {
        var marks = TextRules.SearchPattern("a")[1..];

        Assert.Equal(escaped, TextRules.SearchPattern(word).Replace(marks, ""));
    }

    // --- Criterion 2 ---

    [Fact]
    public async Task Criterion2_SortedLists_KeepTheRecordedOrder()
    {
        // Two differences: SQL Server's punctuation order for a name that starts with it, and final letters: it ties them, so creation order decided.
        var differences = BehaviourRecorded.Sort.Where(l => !l.StartsWith("record tasks")).ToDictionary(l => l, l => l
            .Replace("(paren) | _under", "_under | (paren)")
            .Replace("שלום | שלומ", "שלומ | שלום"));

        AssertRecorded(BehaviourRecorded.Sort, await BehaviourScenarios.SortAsync(db), differences);
    }

    [Fact]
    public async Task Criterion2_NamesWithSeveralHyphensOrApostrophes_KeepTheRecordedOrder()
    {
        // One difference: names equal but for their separators. SQL Server orders them by where the separators are; here the shorter comes first.
        var differences = BehaviourRecorded.SeparatorSort.Where(l => !l.StartsWith("record tasks")).ToDictionary(l => l, l => l
            .Replace("o'n'e'i'l | o'ne'il", "o'ne'il | o'n'e'i'l"));

        AssertRecorded(BehaviourRecorded.SeparatorSort, await BehaviourScenarios.SortAsync(db, BehaviourScenarios.SeparatorSortNames), differences);
    }

    [Fact]
    public async Task Criterion2_TemplatesEqualButForCase_AreInCreationOrder() =>
        AssertRecorded(BehaviourRecorded.CaseOnlySort, await BehaviourScenarios.CaseOnlySortAsync(db));

    [Fact]
    public async Task Criterion2_TheSmokeSteps_BetaCheckBeforeBetaCheckInLowerCase_AsAfterSaveInTheClient()
    {
        // client/ui-tests/smoke.mjs, step checklist-low3: it expects this order after Save and after a reload.
        var user = new User { Email = "smoke@x.test", PasswordHash = "x" };
        db.Add(user);
        await db.SaveChangesAsync();
        var templates = new ChecklistTemplateService(db);
        foreach (var name in new[] { "Alpha check", "Beta check", "beta check" })
        {
            await templates.CreateAsync(user.Id, new ChecklistTemplateRequest(name, []));
            await Task.Delay(2);
        }
        db.ChangeTracker.Clear();

        Assert.Equal("Alpha check|Beta check|beta check", string.Join('|', (await templates.ListAsync(user.Id)).Select(t => t.Name)));
    }

    [Fact]
    public async Task Criterion2_CarsEqualButForCase_KeepTheirOrder_WhenOneIsUpdated()
    {
        var user = new User { Email = "ties@x.test", PasswordHash = "x" };
        db.Add(user);
        await db.SaveChangesAsync();
        var vehicles = new VehicleService(db);
        var first = await vehicles.CreateAsync(user.Id, new CreateVehicleRequest("Car", null, null, null, null, null, null, null, null, null, null));
        await vehicles.CreateAsync(user.Id, new CreateVehicleRequest("car", null, null, null, null, null, null, null, null, null, null));
        await vehicles.CreateAsync(user.Id, new CreateVehicleRequest("CAR", null, null, null, null, null, null, null, null, null, null));
        var before = (await vehicles.ListAsync(user.Id, false)).Select(v => v.Id).ToList();

        await vehicles.UpdateAsync(user.Id, first.Id, new UpdateVehicleRequest("Car", "Mazda", null, null, null, null, null, null, null, null));

        Assert.Equal(before, (await vehicles.ListAsync(user.Id, false)).Select(v => v.Id));
    }

    // --- Criterion 3 ---

    [Fact]
    public async Task Criterion3_Email_GivesTheRecordedResults() => AssertRecorded(BehaviourRecorded.Email, await BehaviourScenarios.EmailAsync(db));

    [Fact]
    public async Task Criterion3_Vin_GivesTheRecordedResults() => AssertRecorded(BehaviourRecorded.Vin, await BehaviourScenarios.VinAsync(db), VinDifferences);

    // --- Criterion 4 ---

    [Fact]
    public async Task Criterion4_EveryNumericColumn_AtItsLimits_RoundTripsExactly()
    {
        var lines = await BehaviourScenarios.DecimalLimitsAsync(db);

        AssertRecorded(BehaviourRecorded.DecimalLimits, lines);
        // Fails if the schema gains a numeric column nobody tests here: 3 lines per column.
        var columns = await db.Database.SqlQueryRaw<int>("""
            SELECT COUNT(*)::int AS "Value" FROM information_schema.columns WHERE table_schema = 'onlycars' AND data_type = 'numeric'
            """).SingleAsync();
        Assert.Equal(columns * 3, lines.Count);
    }

    [Fact]
    public async Task Criterion4_ExtraDecimals_GiveTheRecordedValues() => AssertRecorded(BehaviourRecorded.DecimalExtra, await BehaviourScenarios.DecimalExtraAsync(db));

    [Fact]
    public async Task Criterion4_ReportsAndTotals_MatchTheRecordedNumbersAndJson() => AssertRecorded(BehaviourRecorded.Reports, await BehaviourScenarios.ReportsAsync(db));

    // --- Criterion 6: a deferred key broken at commit ---

    private sealed class CapturingLogger : ILogger<GlobalExceptionHandler>
    {
        public List<string> Lines { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Lines.Add($"{logLevel} {formatter(state, exception)} {exception}"); // as the console logger writes it
    }

    private const string Secret = "row-secret";

    // Each of the 8 deferred keys, broken by a row that points to nothing. The strings carry the secret, to show it stays out too.
    private static IEnumerable<(string Key, object Row)> Broken(Guid user, Guid car, Guid run, Guid missing, Guid item, Guid record, Guid rotation)
    {
        var day = new DateOnly(2025, 1, 1);
        yield return ("FK_VehicleChecklists_ChecklistTemplates_TemplateId", new VehicleChecklist { VehicleId = car, TemplateId = missing, IntervalDays = 7 });
        yield return ("FK_OdometerReadings_ServiceRecords_ServiceRecordId", new OdometerReading { VehicleId = car, ValueKm = 1, ReadingDate = day, ServiceRecordId = missing });
        yield return ("FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId", new ServiceRecordTask { ServiceRecordId = record, MaintenanceTaskId = missing, PreviousLastDoneDate = day });
        yield return ("FK_Tires_ServiceRecords_ServiceRecordId", new Tire { VehicleId = car, Position = TirePosition.Spare, Brand = Secret, FittedAt = day, ServiceRecordId = missing });
        yield return ("FK_ChecklistRuns_OdometerReadings_OdometerReadingId", new ChecklistRun { VehicleChecklistId = run, RunAt = day, Notes = Secret, OdometerReadingId = missing });
        yield return ("FK_TireRotationMoves_Tires_TireId", new TireRotationMove { TireRotationId = rotation, TireId = missing, FromPosition = TirePosition.FL, ToPosition = TirePosition.FR });
        yield return ("FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId", new ChecklistRunItem { RunId = item, LabelSnapshot = Secret, TemplateItemId = missing });
        yield return ("FK_Issues_ChecklistRunItems_SourceRunItemId", new Issue { VehicleId = car, Title = Secret, SourceRunItemId = missing });
    }

    [Fact]
    public async Task Criterion6_EveryDeferredKey_BrokenAtCommit_IsA500_WithNoRowValueInTheResponseOrLogs_AndSavesNothing()
    {
        var user = new User { Email = "deferred@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = "Car" };
        var template = new ChecklistTemplate { User = user, Name = "T" };
        var checklist = new VehicleChecklist { Vehicle = car, Template = template, IntervalDays = 7 };
        var run = new ChecklistRun { VehicleChecklist = checklist, RunAt = new(2025, 1, 1) };
        var record = new ServiceRecord { Vehicle = car, Date = new(2025, 1, 1) };
        var rotation = new TireRotation { Vehicle = car, Date = new(2025, 1, 1), OdometerKm = 1 };
        db.AddRange(user, car, template, checklist, run, record, rotation);
        await db.SaveChangesAsync();
        var missing = Guid.NewGuid();
        var ids = Broken(user.Id, car.Id, checklist.Id, missing, run.Id, record.Id, rotation.Id).ToList();
        Assert.Equal(8, ids.Count);

        foreach (var (key, row) in ids)
        {
            var efLog = new List<string>();
            await using var context = new AppDbContext(TestDbContextFactory.PostgresOptions(db.Database.GetConnectionString()!).LogTo(efLog.Add, LogLevel.Trace).Options);

            // With a second command the save opens a transaction, so the key breaks at its commit: a raw PostgresException (DB-1a).
            context.Add(row);
            context.Add(new Issue { VehicleId = car.Id, Title = "keep-out" });
            var atCommit = await Assert.ThrowsAsync<PostgresException>(() => context.SaveChangesAsync());
            Assert.Equal(("23503", key), (atCommit.SqlState, atCommit.ConstraintName));
            context.ChangeTracker.Clear();
            Assert.False(await context.Issues.AnyAsync(i => i.Title == "keep-out")); // rolled back whole

            // On its own the row commits with its statement: the same error, wrapped.
            context.Add(row);
            var alone = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());
            Assert.Equal(("23503", key), (Assert.IsType<PostgresException>(alone.InnerException).SqlState, ((PostgresException)alone.InnerException!).ConstraintName));
            context.ChangeTracker.Clear();

            foreach (var error in new Exception[] { atCommit, alone })
            {
                var logger = new CapturingLogger();
                var http = new Microsoft.AspNetCore.Http.DefaultHttpContext { Response = { Body = new MemoryStream() } };
                await new GlobalExceptionHandler(logger).TryHandleAsync(http, error, CancellationToken.None);
                http.Response.Body.Position = 0;
                var body = await new StreamReader(http.Response.Body).ReadToEndAsync();

                Assert.Equal(500, http.Response.StatusCode);
                Assert.Equal("http.500", JsonDocument.Parse(body).RootElement.GetProperty("code").GetString());
                Assert.DoesNotContain(key, body);
                foreach (var text in logger.Lines.Append(body).Concat(efLog))
                {
                    Assert.DoesNotContain(missing.ToString(), text);
                    Assert.DoesNotContain(Secret, text);
                }
                Assert.Contains(logger.Lines, l => l.Contains("23503")); // the log still says what happened
            }
        }
    }
}

/// <summary>DB-1b criteria 1 and 5 through HTTP, on the real controllers and Postgres: \u0000 in a JSON string, a file name or the q search.</summary>
public class NulRequestTests : FileTestBase, IAsyncLifetime
{
    private readonly string connection = TestDbContextFactory.NewPostgresConnection(); // set before the base constructor, which uses it
    private Guid carId;
    private Guid recordId;

    protected override AppDbContext NewDb() => new(TestDbContextFactory.PostgresOptions(connection).Options);

    public async Task InitializeAsync()
    {
        await db.Database.MigrateAsync();
        var user = new User { Id = userId, Email = "nul@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = "Car", CurrentOdometerKm = 1000 };
        var record = new ServiceRecord { Vehicle = car, Date = new(2025, 1, 1), ShopName = "מוסך שלום", Notes = "Original" };
        db.AddRange(user, car, record);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();
        (carId, recordId) = (car.Id, record.Id);
    }

    public async Task DisposeAsync()
    {
        await db.Database.EnsureDeletedAsync();
        await db.DisposeAsync();
    }

    private Task<int> RowsAsync() => db.Database.SqlQueryRaw<int>("""
        SELECT ((SELECT COUNT(*) FROM onlycars."Vehicles") + (SELECT COUNT(*) FROM onlycars."ChecklistTemplates") + (SELECT COUNT(*) FROM onlycars."ServiceRecords")
            + (SELECT COUNT(*) FROM onlycars."Attachments") + (SELECT COUNT(*) FROM onlycars."Issues") + (SELECT COUNT(*) FROM onlycars."Users"))::int AS "Value"
        """).SingleAsync();

    private static StringContent Json(string json) => new(json, Encoding.UTF8, "application/json");

    [Theory]
    [InlineData("POST", "/api/vehicles", """{"nickname":"a\u0000b"}""")]
    [InlineData("PUT", "/api/vehicles/{car}", """{"nickname":"Car","vin":"\u0000"}""")]
    [InlineData("POST", "/api/checklist-templates", """{"name":"x","items":[{"label":"nested\u0000","type":"Check"}]}""")]
    [InlineData("POST", "/api/vehicles/{car}/issues", """{"title":"\u0000"}""")]
    [InlineData("POST", "/api/vehicles/{car}/service-records", """{"odometerKm":1000,"notes":"a\u0000","taskIds":[]}""")]
    [InlineData("POST", "/api/vehicles/{car}/service-records", """{"odometerKm":1000,"items":[{"description":"\u0000","quantity":1,"unitCost":1}],"taskIds":[]}""")]
    [InlineData("POST", "/api/auth/login", """{"email":"a\u0000@x.test","password":"x"}""")]
    [InlineData("POST", "/api/auth/register", """{"email":"b@x.test","password":"right-password\u0000"}""")]
    public async Task Criterion5_NulInAJsonString_Is400_AndStoresNothing(string method, string path, string json)
    {
        var (app, client) = await StartAsync();
        var before = await RowsAsync();

        var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path.Replace("{car}", carId.ToString())) { Content = Json(json) });
        var (status, body) = await ReadAsync(response);

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Equal("http.400", body.GetProperty("code").GetString());
        Assert.Equal(before, await RowsAsync());
        await app.DisposeAsync();
    }

    [Fact]
    public async Task Criterion5_ASafeLookalike_StillSaves_AndHebrewComesBackAsItWent()
    {
        var (app, client) = await StartAsync();

        // A backslash and the letters u0000, and a control character Postgres can hold.
        var (status, body) = await ReadAsync(await client.PostAsync("/api/vehicles", Json("""{"nickname":"\\u0000 \u0001 שלום"}""")));

        Assert.Equal(HttpStatusCode.Created, status);
        Assert.Equal("\\u0000 \u0001 שלום", body.GetProperty("nickname").GetString());
        await app.DisposeAsync();
    }

    [Theory]
    [InlineData("a%00b")]
    [InlineData("%00")]
    [InlineData("%20%00%20")]
    public async Task Criterion5_NulInTheSearch_Is400(string q)
    {
        var (app, client) = await StartAsync();

        var (status, body) = await ReadAsync(await client.GetAsync($"/api/service-records?q={q}"));

        Assert.Equal(HttpStatusCode.BadRequest, status);
        Assert.Equal("serviceRecord.invalidSearch", body.GetProperty("code").GetString());
        await app.DisposeAsync();
    }

    [Fact]
    public async Task Criterion1_TheEndpoint_FindsHebrewInOtherFinalForms_AndAnotherUserFindsNothing()
    {
        var (app, client) = await StartAsync();

        // q = shalom with a plain mem at its end; the shop has the final one.
        var (status, body) = await ReadAsync(await client.GetAsync($"/api/service-records?q={Uri.EscapeDataString("שלומ")}"));

        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(recordId, Assert.Single(body.GetProperty("items").EnumerateArray()).GetProperty("id").GetGuid());

        client.DefaultRequestHeaders.Remove("X-Test-User");
        client.DefaultRequestHeaders.Add("X-Test-User", Guid.NewGuid().ToString());
        var (_, other) = await ReadAsync(await client.GetAsync($"/api/service-records?q={Uri.EscapeDataString("שלומ")}"));
        Assert.Equal(0, other.GetProperty("totalCount").GetInt32());
        await app.DisposeAsync();
    }

    private static MultipartFormDataContent NulNamed()
    {
        var file = new ByteArrayContent(Png1x1);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        file.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data") { Name = "file", FileNameStar = "a\0b.png" };
        return new MultipartFormDataContent { file };
    }

    [Fact]
    public async Task Criterion5_NulInAFileName_Is400_AndStoresNothing()
    {
        var (app, client) = await StartAsync();
        var document = new VehicleDocument { VehicleId = carId, Type = VehicleDocumentType.Insurance, ExpiryDate = new(2030, 1, 1) };
        db.Add(document);
        await db.SaveChangesAsync();
        var before = await RowsAsync();

        foreach (var (method, path) in new[]
        {
            (HttpMethod.Post, $"/api/vehicles/{carId}/service-records/{recordId}/attachments"),
            (HttpMethod.Post, $"/api/vehicles/{carId}/documents/{document.Id}/attachments"),
            (HttpMethod.Put, $"/api/vehicles/{carId}/photo"),
        })
        {
            var (status, body) = await ReadAsync(await client.SendAsync(new HttpRequestMessage(method, path) { Content = NulNamed() }));
            Assert.Equal(HttpStatusCode.BadRequest, status);
            Assert.Equal("file.invalidName", body.GetProperty("code").GetString());
        }

        Assert.Equal(before, await RowsAsync());
        Assert.Empty(storage.Objects);
        await app.DisposeAsync();
    }
}
