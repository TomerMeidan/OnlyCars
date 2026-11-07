using System.Diagnostics;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration.UserSecrets;
using Npgsql;
using OnlyCars.DbCopy;
using OnlyCars.Domain;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>
/// DB-1c: a throwaway LocalDB, made from the committed schema script of the last SQL Server commit, to a database of its own on the test container.
/// The one test class that needs LocalDB: the source of the copy has to be real SQL Server.
/// </summary>
public class DbCopyTests : IAsyncLifetime
{
    private const string Sentinel = "ZQ"; // starts every generated text value, so a test can prove no row value reached the output
    private static readonly DateTimeOffset Stamp = new DateTimeOffset(2026, 1, 2, 3, 4, 5, TimeSpan.FromHours(3)).AddTicks(1234567);

    private readonly string _sourceName = $"OnlyCars_Test_{Guid.NewGuid():N}";
    private string Master => @"Server=(localdb)\mssqllocaldb;Database=master;Integrated Security=true;TrustServerCertificate=true;Pooling=false";
    private string Source => new SqlConnectionStringBuilder(Master) { InitialCatalog = _sourceName }.ConnectionString;
    private string TargetAdmin = "";
    private string Target = "";

    public async Task InitializeAsync()
    {
        await SqlAsync(Master, $"CREATE DATABASE [{_sourceName}]");
        try
        {
            await CreateSourceSchemaAsync();
        }
        catch
        {
            await DisposeAsync(); // xUnit doesn't when this fails, and the database would stay behind
            throw;
        }

        TargetAdmin = TestDbContextFactory.NewPostgresConnection();
        var database = new NpgsqlConnectionStringBuilder(TargetAdmin).Database!;
        var (role, password) = ($"dbcopy_{Guid.NewGuid():N}", Guid.NewGuid().ToString("N"));
        await PgAsync(TestDbContextFactory.AdminConnection, $"CREATE ROLE {role} LOGIN PASSWORD '{password}'; ");
        await PgAsync(TestDbContextFactory.AdminConnection, $"CREATE DATABASE \"{database}\"");
        // As scripts/app-db-user.sql does for onlycars_app, whose name is taken by PostgresBaselineTests: the copy runs as the schema's owner, not an admin.
        await PgAsync(TargetAdmin, $"CREATE SCHEMA onlycars AUTHORIZATION {role}; REVOKE ALL ON SCHEMA onlycars FROM PUBLIC");
        Target = new NpgsqlConnectionStringBuilder(TargetAdmin) { Username = role, Password = password }.ConnectionString;
        await using var db = new AppDbContext(TestDbContextFactory.PostgresOptions(Target).Options);
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await SqlAsync(Master, $"ALTER DATABASE [{_sourceName}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [{_sourceName}]");
    }

    // One connection: the script opens a transaction in one batch and commits it in a later one.
    private async Task CreateSourceSchemaAsync()
    {
        var script = await File.ReadAllTextAsync(SchemaScript());
        await using var connection = new SqlConnection(Source);
        await connection.OpenAsync();
        foreach (var batch in Regex.Split(script, @"^\s*GO\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase).Where(b => !string.IsNullOrWhiteSpace(b)))
        {
            await using var command = new SqlCommand(batch, connection);
            await command.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task AC1_CopiesEveryTable_TheVerifyPasses_TwoValuesTrimmed_AndAppDbContextReadsThemBack()
    {
        var seed = await SeedAsync();

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.True(exit == 0, output);
        Assert.Contains("Verify passed", output);
        Assert.Contains($"Users.Email: 1 ({seed.User})", output);
        Assert.Contains($"Vehicles.Vin: 1 ({seed.Vehicle})", output);
        Assert.Contains("Not copied: Legacy_TireSets, 1 rows", output);
        foreach (var table in CopyPlan.Tables())
        {
            Assert.Matches($@"Verify {table.Name}: source ([1-9]\d*), target \1, differences 0", output);
        }

        Assert.DoesNotContain(Sentinel, output);
        await using var db = new AppDbContext(TestDbContextFactory.PostgresOptions(Target).Options);

        // Trailing spaces go; a tab and leading spaces stay. The new collation finds them whatever the case.
        var user = await db.Users.SingleAsync(u => u.Id == seed.User);
        Assert.Equal(" Owner@X.test\t", user.Email);
        Assert.Equal(seed.User, (await db.Users.SingleAsync(u => u.Email == " OWNER@x.TEST\t")).Id);
        var car = await db.Vehicles.SingleAsync(v => v.Id == seed.Vehicle);
        Assert.Equal(" Vin\t", car.Vin);

        // Hebrew and emoji exact; trailing spaces kept outside the two columns; nulls stay null, an empty string stays empty.
        Assert.Equal("טויוטה שלום 🚗 ", car.Nickname);
        Assert.Null(car.Make);
        Assert.Equal("", car.Model);

        // Every decimal limit.
        Assert.Equal(9999999999.99m, car.PurchasePrice);
        Assert.Equal(9999999999.99m, car.CurrentOdometerKm);
        var low = await db.Vehicles.SingleAsync(v => v.Id == seed.LowVehicle);
        Assert.Equal(-9999999999.99m, low.PurchasePrice);
        Assert.Equal(-9999999999.99m, low.AvgKmPerDay);
        Assert.Equal(0.01m, low.CurrentOdometerKm);
        Assert.Equal(9999999.99m, (await db.ServiceItems.SingleAsync()).Quantity);
        var measure = await db.TireMeasurements.SingleAsync();
        Assert.Equal(6.00m, measure.PressureBar);
        Assert.Equal(20.0m, measure.TreadDepthMm);

        // A non-zero offset arrives as the same instant in UTC, truncated to the microsecond; a date stays that date.
        var instant = new DateTimeOffset(Stamp.UtcTicks - Stamp.UtcTicks % 10, TimeSpan.Zero);
        Assert.Equal(instant, car.CreatedAt);
        Assert.Equal(TimeSpan.Zero, car.CreatedAt.Offset);
        Assert.Equal(new DateOnly(2026, 1, 2), (await db.ChecklistRuns.SingleAsync()).RunAt);
        Assert.Equal(Guid.Parse(seed.Run.ToString()), (await db.ChecklistRuns.SingleAsync()).Id);

        // The source's change to a seeded template won, and a seed the source no longer has is gone.
        var template = await db.TaskTemplates.SingleAsync(t => t.Id == seed.ChangedTemplate);
        Assert.Equal("שמן מנוע משונה", template.NameHe);
        Assert.False(await db.TaskTemplates.AnyAsync(t => t.Id == seed.DeletedTemplate));
        Assert.Equal(DistanceUnit.Km, user.DistanceUnit);

        // The FK-order-sensitive row and the boolean arrive as set.
        Assert.True((await db.ChecklistRunItems.SingleAsync()).IsFlagged);
        Assert.Equal(1234567890123L, (await db.Attachments.SingleAsync()).SizeBytes);

        var (again, verify) = await RunAsync(CopyMode.Verify);
        Assert.True(again == 0, verify);
    }

    [Fact]
    public async Task AC2_ACorruptedTargetRow_FailsTheVerify_WithTableAndIdOnly()
    {
        var seed = await SeedAsync();
        Assert.Equal(0, (await RunAsync(CopyMode.Write)).Exit);

        await PgAsync(TargetAdmin, $"UPDATE onlycars.\"Vehicles\" SET \"Nickname\" = '{Sentinel}changed' WHERE \"Id\" = '{seed.Vehicle}'");
        await PgAsync(TargetAdmin, $"DELETE FROM onlycars.\"NotificationRules\" WHERE \"Id\" = '{seed.Rule}'");

        var (exit, output) = await RunAsync(CopyMode.Verify);

        Assert.Equal(1, exit);
        Assert.Contains($"Vehicles {seed.Vehicle}: different", output);
        Assert.Contains($"NotificationRules {seed.Rule}: missing from the target", output);
        Assert.DoesNotContain(Sentinel, output);
    }

    [Theory]
    [InlineData("Users", "Email")]
    [InlineData("Vehicles", "Vin")]
    public async Task AC2_ATargetValueThatKeptItsTrailingSpaces_FailsTheVerify(string table, string column)
    {
        var seed = await SeedAsync();
        Assert.Equal(0, (await RunAsync(CopyMode.Write)).Exit);
        var id = table == "Users" ? seed.User : seed.Vehicle;

        await PgAsync(TargetAdmin, $"UPDATE onlycars.\"{table}\" SET \"{column}\" = \"{column}\" || '  ' WHERE \"Id\" = '{id}'");

        var (exit, output) = await RunAsync(CopyMode.Verify);
        Assert.Equal(1, exit);
        Assert.Contains($"{table} {id}: different", output);
    }

    [Theory]
    [InlineData("a@x.test", "A@X.TEST  ")]
    [InlineData("a@x.test  ", "a@x.test")]
    public async Task AC2_TwoEmailsThatCollideAfterTrimming_StopTheWrite_IdsOnly_NothingWritten(string first, string second)
    {
        await SqlAsync(Source, "DROP INDEX [IX_Users_Email] ON [Users]");
        var a = await FillAsync("Users", new() { ["Email"] = first });
        var b = await FillAsync("Users", new() { ["Email"] = second });
        var before = await TargetFingerprintAsync();

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.Equal(1, exit);
        Assert.Matches($"Collisions after trimming: Users.Email: 1 \\(({a} = {b}|{b} = {a})\\)", output);
        Assert.Contains("Stopped before writing anything", output);
        Assert.DoesNotContain("x.test", output, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(before, await TargetFingerprintAsync());
    }

    [Theory]
    [InlineData("abc", "ABC  ")]
    [InlineData("", "  ")] // two blank VINs
    public async Task AC2_TwoVinsOfOneUserThatCollideAfterTrimming_StopTheWrite(string first, string second)
    {
        await SqlAsync(Source, "DROP INDEX [IX_Vehicles_UserId_Vin] ON [Vehicles]");
        var user = await FillAsync("Users");
        var a = await FillAsync("Vehicles", new() { ["UserId"] = user, ["Vin"] = first });
        var b = await FillAsync("Vehicles", new() { ["UserId"] = user, ["Vin"] = second });

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.Equal(1, exit);
        Assert.Matches($"Collisions after trimming: Vehicles.Vin: 1 \\(({a} = {b}|{b} = {a})\\)", output);
        Assert.Equal(0, await PgCountAsync("Users"));
    }

    [Fact]
    public async Task TheSameVinOnTwoUsers_AndManyNullVins_AreNoCollision()
    {
        var (one, two) = (await FillAsync("Users"), await FillAsync("Users"));
        await FillAsync("Vehicles", new() { ["UserId"] = one, ["Vin"] = "ABC" });
        await FillAsync("Vehicles", new() { ["UserId"] = two, ["Vin"] = "abc" });
        await FillAsync("Vehicles", new() { ["UserId"] = one });
        await FillAsync("Vehicles", new() { ["UserId"] = one });

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.True(exit == 0, output);
        Assert.Contains("Collisions after trimming: Vehicles.Vin: 0", output);
        Assert.Equal(4, await PgCountAsync("Vehicles"));
    }

    // The dry run decides on .NET's ICU, before the target has the collation; the unique index decides on Postgres's. They must agree.
    [Theory]
    [InlineData("abc", "ABC")]
    [InlineData("abc", "abc ")]
    [InlineData("abc", "ａｂｃ")] // full width
    [InlineData("strasse", "straße")]
    [InlineData("é", "é")] // the same letter, decomposed
    [InlineData("ab", "a‍b")] // an ignorable mark
    [InlineData("", "  ")]
    [InlineData("abc", "abd")]
    [InlineData("abc", "ábc")] // accents stay distinct
    [InlineData("abc", " abc")]
    [InlineData("abc", "abc\t")]
    [InlineData("שלום", "שלומ")] // a final letter isn't its plain form at this strength
    [InlineData("שלום", "שָׁלוֹם")]
    [InlineData("a-b", "ab")]
    public async Task CollisionKey_AgreesWithTheCollationInPostgres(string a, string b)
    {
        await using var connection = new NpgsqlConnection(TargetAdmin);
        await connection.OpenAsync();
        await using var compare = new NpgsqlCommand("SELECT rtrim($1, ' ') COLLATE onlycars.und_ci = rtrim($2, ' ') COLLATE onlycars.und_ci", connection);
        compare.Parameters.AddWithValue(a);
        compare.Parameters.AddWithValue(b);
        var inPostgres = (bool)(await compare.ExecuteScalarAsync())!;

        Assert.Equal(inPostgres, CopyPlan.CollisionKey(a) == CopyPlan.CollisionKey(b));
    }

    [Fact]
    public async Task AC2_ANonEmptyTarget_IsRefused()
    {
        await SeedAsync();
        Assert.Equal(0, (await RunAsync(CopyMode.Write)).Exit);

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.Equal(1, exit);
        Assert.Contains("the target is not empty", output);
        Assert.Contains("Stopped before writing anything", output);
    }

    [Fact]
    public async Task AC2_ATargetWithoutTheBaseline_IsRefusedByTheWrite_ButNotByADryRun()
    {
        // Gate 3's target: app-db-user.sql has run, the baseline hasn't. Then one with no schema at all.
        var role = new NpgsqlConnectionStringBuilder(Target).Username;
        await PgAsync(TargetAdmin, $"DROP SCHEMA onlycars CASCADE; CREATE SCHEMA onlycars AUTHORIZATION {role}");
        var (dryExit, dry) = await RunAsync(CopyMode.DryRun);
        Assert.True(dryExit == 0, dry);
        Assert.Contains("Target: not at the baseline", dry);

        await PgAsync(TargetAdmin, "DROP SCHEMA onlycars");
        var (noSchemaExit, noSchema) = await RunAsync(CopyMode.DryRun);
        Assert.True(noSchemaExit == 0, noSchema);
        await PgAsync(TargetAdmin, $"CREATE SCHEMA onlycars AUTHORIZATION {role}");

        var (exit, output) = await RunAsync(CopyMode.Write);
        Assert.Equal(1, exit);
        Assert.Contains("the target is not at the baseline", output);

        var (verify, text) = await RunAsync(CopyMode.Verify);
        Assert.Equal(1, verify);
        Assert.Contains("no baseline", text);
    }

    [Fact]
    public async Task AC2_AWrongSourceMigration_IsRefused()
    {
        await SqlAsync(Source, $"DELETE FROM [__EFMigrationsHistory] WHERE [MigrationId] = '{DbCopyTool.PinnedMigration}'");

        foreach (var mode in new[] { CopyMode.DryRun, CopyMode.Write, CopyMode.Verify })
        {
            var (exit, output) = await RunAsync(mode);
            Assert.Equal(1, exit);
            Assert.Contains("20261104175010_DocumentAttachments, not 20261106063910_TemplateHebrewNames", output);
        }

        Assert.Equal(0, await PgCountAsync("Users"));
    }

    [Fact]
    public async Task ApplyBaseline_BringsAnEmptySchemaToTheBaseline_ThenTheWriteWorks_AndTheSourceIsNotOpened()
    {
        var role = new NpgsqlConnectionStringBuilder(Target).Username;
        await PgAsync(TargetAdmin, $"DROP SCHEMA onlycars CASCADE; CREATE SCHEMA onlycars AUTHORIZATION {role}");
        var output = new StringWriter();

        var exit = await DbCopyTool.RunAsync(CopyMode.ApplyBaseline, "Server=127.0.0.1,1;Database=never;Connect Timeout=1", Target, output, _ => Task.CompletedTask);

        Assert.True(exit == 0, output.ToString());
        await SeedAsync();
        var (write, text) = await RunAsync(CopyMode.Write);
        Assert.True(write == 0, text);
    }

    [Fact]
    public async Task AModelColumnMissingFromTheSource_IsRefused()
    {
        await SqlAsync(Source, "ALTER TABLE [Vehicles] DROP COLUMN [Plate]");

        var (exit, output) = await RunAsync(CopyMode.DryRun);

        Assert.Equal(1, exit);
        Assert.Contains("Missing from the source: Vehicles.Plate", output);
    }

    [Fact]
    public async Task AC2_ADryRun_WritesNothing_AndReportsEverything()
    {
        var seed = await SeedAsync();
        var before = await TargetFingerprintAsync();

        var (exit, output) = await RunAsync(CopyMode.DryRun);

        Assert.True(exit == 0, output);
        Assert.Equal(before, await TargetFingerprintAsync());
        Assert.Matches(@"Users: 1 rows, [1-9]\d* bytes", output);
        Assert.Contains("Values with U+0000: 0", output);
        Assert.Contains($"Users.Email: 1 ({seed.User})", output);
        Assert.Contains("Collisions after trimming: Users.Email: 0", output);
        Assert.Contains("Source collation: SQL_Latin1_General_CP1_CI_AS; string columns with a different one: none", output);
        Assert.Contains("Target: empty, apart from", output);
        Assert.Contains("Nothing in this report would stop --write", output);
        Assert.DoesNotContain(Sentinel, output);
    }

    [Fact]
    public async Task ADryRun_ReportsAColumnWithAnotherCollation()
    {
        await SqlAsync(Source, "ALTER TABLE [Vehicles] ALTER COLUMN [Plate] nvarchar(32) COLLATE Latin1_General_100_CS_AS NULL");

        var (_, output) = await RunAsync(CopyMode.DryRun);

        Assert.Contains("different one: Vehicles.Plate Latin1_General_100_CS_AS", output);
    }

    [Theory]
    [InlineData("NCHAR(0)", "U+0000")]
    [InlineData("NCHAR(55357)", "an unpaired surrogate")]
    public async Task AValuePostgresCantHold_IsListedById_AndStopsTheWrite(string character, string name)
    {
        var user = await FillAsync("Users");
        var car = await FillAsync("Vehicles", new() { ["UserId"] = user });
        await SqlAsync(Source, $"UPDATE [Vehicles] SET [Plate] = N'{Sentinel}' + {character} WHERE [Id] = '{car}'");

        var (dryExit, dry) = await RunAsync(CopyMode.DryRun);
        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.Equal(1, dryExit);
        Assert.Contains($"Vehicles.Plate {car}", dry);
        Assert.Equal(1, exit);
        Assert.Contains($"1 values with {name}", output);
        Assert.Equal(0, await PgCountAsync("Users"));
        Assert.DoesNotContain(Sentinel, output);
    }

    [Fact]
    public async Task AC2_AFailureMidCopy_LeavesTheTargetAsItWas_AndPrintsNoRowValue()
    {
        await SeedAsync();
        // Issues comes late in the order, so earlier tables are written by then. Only the target still refuses this row.
        await SqlAsync(Source, "ALTER TABLE [Issues] DROP CONSTRAINT [CK_Issues_ResolvedAt]; UPDATE [Issues] SET [Status] = 1, [ResolvedAt] = NULL");
        var before = await TargetFingerprintAsync();

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.Equal(1, exit);
        Assert.Contains("SQLSTATE 23514, constraint CK_Issues_ResolvedAt", output);
        Assert.Contains("Nothing was committed", output);
        Assert.Equal(before, await TargetFingerprintAsync());
        Assert.DoesNotContain(Sentinel, output);
    }

    [Fact]
    public async Task AVerifyThatFailsInsideTheWrite_RollsBack_AndListsTableAndId()
    {
        var seed = await SeedAsync();
        // The insert is accepted but the stored row differs, as a bad driver or conversion would make it.
        await PgAsync(TargetAdmin, """
            CREATE FUNCTION onlycars.spoil() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW."Plate" := 'ZQspoiled'; RETURN NEW; END $$;
            CREATE TRIGGER spoil BEFORE INSERT ON onlycars."Vehicles" FOR EACH ROW EXECUTE FUNCTION onlycars.spoil();
            """);
        var before = await TargetFingerprintAsync();

        var (exit, output) = await RunAsync(CopyMode.Write);

        Assert.Equal(1, exit);
        Assert.Contains($"Vehicles {seed.Vehicle}: different", output);
        Assert.Contains("Rolled back", output);
        Assert.Equal(before, await TargetFingerprintAsync());
    }

    [Fact]
    public async Task AC3_TheSourceReceivesOnlySelects_CapturedOnTheServer_EvenWhenItIsReadOnly()
    {
        await SeedAsync();
        var session = $"dbcopy_{Guid.NewGuid():N}";
        var app = $"dbcopy-{Guid.NewGuid():N}";
        await SqlAsync(Master, $"""
            CREATE EVENT SESSION [{session}] ON SERVER
            ADD EVENT sqlserver.sql_batch_starting (WHERE sqlserver.client_app_name = N'{app}'),
            ADD EVENT sqlserver.rpc_starting (WHERE sqlserver.client_app_name = N'{app}')
            ADD TARGET package0.ring_buffer WITH (MAX_DISPATCH_LATENCY = 1 SECONDS);
            ALTER EVENT SESSION [{session}] ON SERVER STATE = START;
            """);
        try
        {
            await SqlAsync(Master, $"ALTER DATABASE [{_sourceName}] SET READ_ONLY WITH ROLLBACK IMMEDIATE");
            var source = new SqlConnectionStringBuilder(Source) { ApplicationName = app }.ConnectionString;
            var output = new StringWriter();
            foreach (var mode in new[] { CopyMode.DryRun, CopyMode.Write, CopyMode.Verify })
            {
                Assert.True(await DbCopyTool.RunAsync(mode, source, Target, output, _ => Task.CompletedTask) == 0, output.ToString());
            }

            var statements = new List<string>();
            for (var tries = 0; tries < 40 && !statements.Exists(s => s.Contains("Notifications")); tries++)
            {
                await Task.Delay(500);
                var xml = (string)(await QuerySqlAsync(Master, $"""
                    SELECT CAST(t.target_data AS nvarchar(max)) FROM sys.dm_xe_sessions s
                    JOIN sys.dm_xe_session_targets t ON s.address = t.event_session_address WHERE s.name = N'{session}'
                    """))[0];
                statements = XDocument.Parse(xml).Descendants("event")
                    .Select(e => e.Attribute("name")!.Value + ": " + e.Elements("data").Where(d => (string?)d.Attribute("name") is "batch_text" or "statement").Select(d => d.Element("value")!.Value).FirstOrDefault())
                    .ToList();
            }

            Assert.Contains(statements, s => s.Contains("FROM [dbo].[Users]") && s.Contains("varbinary"));
            Assert.Contains(statements, s => s.Contains("__EFMigrationsHistory"));
            Assert.All(statements, s => Assert.Matches(@"^sql_batch_starting: SELECT [^;]*$", s));
        }
        finally
        {
            await SqlAsync(Master, $"ALTER EVENT SESSION [{session}] ON SERVER STATE = STOP; DROP EVENT SESSION [{session}] ON SERVER;");
            await SqlAsync(Master, $"ALTER DATABASE [{_sourceName}] SET READ_WRITE WITH ROLLBACK IMMEDIATE");
        }
    }

    [Fact]
    public void TheModel_HasNoForeignKeyCycle_ParentsComeFirst_AndEveryTableHasOneGuidKey()
    {
        var tables = CopyPlan.Tables();
        var order = tables.Select(t => t.Name).ToList();

        Assert.Equal(22, tables.Count);
        Assert.All(tables, t => Assert.Equal(typeof(Guid), t.Columns[t.IdIndex].Clr));
        using var db = CopyPlan.NewContext();
        foreach (var type in db.Model.GetEntityTypes())
        {
            foreach (var key in type.GetForeignKeys())
            {
                Assert.True(order.IndexOf(key.PrincipalEntityType.GetTableName()!) < order.IndexOf(type.GetTableName()!), key.ToString());
            }
        }

        Assert.All(tables.SelectMany(t => t.Columns).Where(c => c.Clr == typeof(decimal)), c => Assert.NotNull(c.Scale));
        Assert.Equal(["Users.Email", "Vehicles.Vin"], tables.SelectMany(t => t.Columns).Where(c => c.TrimSpaces).Select(c => $"{c.Table}.{c.Name}").Order());
    }

    // The tool copies the model's columns, so anything else in the pinned source would be lost: only Legacy_* may be extra (decisions.md, L222).
    [Fact]
    public async Task ThePinnedSource_HasExactlyTheModelsTablesAndColumns_ApartFromLegacy()
    {
        var inSource = (await QuerySqlRowsAsync(Source, "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME NOT LIKE 'Legacy[_]%' AND TABLE_NAME <> '__EFMigrationsHistory'"))
            .Select(r => $"{r[0]}.{r[1]}").Order(StringComparer.Ordinal);
        var inModel = CopyPlan.Tables().SelectMany(t => t.Columns).Select(c => $"{c.Table}.{c.Name}").Order(StringComparer.Ordinal);

        Assert.Equal(inModel, inSource);

        // The tool reads text as raw UTF-16, which is only right for nvarchar.
        var text = await QuerySqlRowsAsync(Source, "SELECT DISTINCT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME NOT LIKE 'Legacy[_]%' AND COLLATION_NAME IS NOT NULL");
        Assert.Equal("nvarchar", Assert.Single(text)[0]);
    }

    [Fact]
    public void TheHash_NeverRounds_AndTellsNullFromEmpty_AndTreatsTrimOnlyOnTheSourceSide()
    {
        var money = new CopyColumn("T", "C", typeof(decimal), 2, false);
        Assert.Equal("1.50", CopyPlan.Canonical(money, 1.5m, true));
        Assert.Equal("1.50", CopyPlan.Canonical(money, 1.500m, false));
        Assert.NotEqual(CopyPlan.Canonical(money, 1.555m, true), CopyPlan.Canonical(money, 1.56m, false));

        var text = new CopyColumn("T", "C", typeof(string), null, false);
        var table = new CopyTable("T", [text, text], 0);
        Assert.NotEqual(CopyPlan.RowHash(table, [null, "a"], true), CopyPlan.RowHash(table, ["", "a"], true));
        Assert.NotEqual(CopyPlan.RowHash(table, ["ab", "c"], true), CopyPlan.RowHash(table, ["a", "bc"], true));

        var email = new CopyColumn("T", "C", typeof(string), null, true);
        Assert.Equal("x", CopyPlan.Canonical(email, "x  ", true));
        Assert.Equal("x  ", CopyPlan.Canonical(email, "x  ", false));
    }

    [Fact]
    public void TheHash_RefusesALocalTime_InsteadOfGuessingItsZone()
    {
        var stamp = new CopyColumn("T", "C", typeof(DateTimeOffset), null, false);
        Assert.Throws<CopyStop>(() => CopyPlan.Canonical(stamp, new DateTime(2026, 1, 1), true));
    }

    [Fact]
    public async Task TheRead_RetriesWhileAzureWakes_ThenGivesUpAfterTwoMinutes()
    {
        var waits = new List<TimeSpan>();
        var calls = 0;
        var value = await DbCopyTool.RetryWhileWakingAsync(
            () => ++calls < 4 ? throw new InvalidOperationException() : Task.FromResult(7), e => e is InvalidOperationException, w => { waits.Add(w); return Task.CompletedTask; });
        Assert.Equal(7, value);
        Assert.Equal(3, waits.Count);

        waits.Clear();
        await Assert.ThrowsAsync<InvalidOperationException>(() => DbCopyTool.RetryWhileWakingAsync<int>(
            () => throw new InvalidOperationException(), _ => true, w => { waits.Add(w); return Task.CompletedTask; }));
        Assert.Equal(TimeSpan.FromMinutes(2), waits.Aggregate(TimeSpan.Zero, (a, b) => a + b));

        // Any other error stops at once.
        waits.Clear();
        await Assert.ThrowsAsync<InvalidOperationException>(() => DbCopyTool.RetryWhileWakingAsync<int>(
            () => throw new InvalidOperationException(), _ => false, w => { waits.Add(w); return Task.CompletedTask; }));
        Assert.Empty(waits);
    }

    [Fact]
    public void TheToolUsesTheApisUserSecretsId()
    {
        var id = typeof(Program).Assembly.GetCustomAttribute<UserSecretsIdAttribute>()!.UserSecretsId;
        Assert.Equal(DbCopyTool.UserSecretsId, id);
    }

    // Fake values only: a real process with its own secrets folder, against ports nothing listens on.
    [Fact]
    public async Task WithoutKeys_ItReadsTheTwoSecrets_PrintsTheirNames_AndNeverThePasswords()
    {
        var secrets = """{"ConnectionStrings:AzureSource":"Server=127.0.0.1,1;Database=fake-azure;User Id=u;Password=FakeSecret1;Connect Timeout=1;Encrypt=false","ConnectionStrings:SupabaseApp":"Host=127.0.0.1;Port=1;Database=fake-supabase;Username=u;Password=FakeSecret2;Timeout=1"}""";

        var (exit, output) = await RunProcessAsync([], secrets, []);

        Assert.Equal(1, exit);
        Assert.Contains("Source: database fake-azure on 127.0.0.1,1", output);
        Assert.Contains("Target: database fake-supabase on 127.0.0.1", output);
        Assert.Contains("SqlException", output);
        Assert.DoesNotContain("FakeSecret", output);
    }

    [Theory]
    [InlineData("""{"ConnectionStrings:SupabaseApp":"Host=x;Password=FakeSecret2"}""", "Connection string AzureSource is not set")]
    [InlineData("""{"ConnectionStrings:AzureSource":"Server=x;Password=FakeSecret1;Bogus FakeSecret3=1","ConnectionStrings:SupabaseApp":"Host=x;Password=FakeSecret2"}""", "db-copy stopped: ")]
    [InlineData("""{"ConnectionStrings:AzureSource":"Server=x","ConnectionStrings:SupabaseApp":"Host=x;Password=FakeSecret2;Bogus FakeSecret3=1"}""", "db-copy stopped: ")]
    [InlineData("""{"ConnectionStrings:AzureSource":"Password=FakeSecret1""", "db-copy stopped: ")] // not even valid JSON
    public async Task AMissingOrUnreadableString_StopsWithoutPrintingIt(string secrets, string expected)
    {
        var (exit, output) = await RunProcessAsync([], secrets, []);

        Assert.Equal(1, exit);
        Assert.Contains(expected, output);
        Assert.DoesNotContain("FakeSecret", output);
    }

    [Fact]
    public async Task WithKeys_ItReadsTheEnvironmentOnly_AndNeverOpensTheSecretsFile()
    {
        var (exit, output) = await RunProcessAsync(
            ["--source-key", "Pair1", "--target-key", "Pair2"], "this is not json, so opening it would throw",
            new() { ["ConnectionStrings__Pair1"] = Source, ["ConnectionStrings__Pair2"] = Target });

        Assert.True(exit == 0, output);
        Assert.Contains($"Source: database {_sourceName}", output);
        Assert.Contains("Dry run done", output);
    }

    [Theory]
    [InlineData("--delete")]
    [InlineData("--source-key")]
    [InlineData("--write --verify")]
    [InlineData("--source-key OnlyOne")]
    public async Task ABadCommandLine_StopsAndNothingRuns(string args)
    {
        var (exit, output) = await RunProcessAsync(args.Split(' '), "{}", []);

        Assert.Equal(1, exit);
        Assert.Contains("db-copy stopped", output);
        Assert.DoesNotContain("Source:", output);
    }

    private sealed record Seed(Guid User, Guid Vehicle, Guid LowVehicle, Guid Rule, Guid Run, Guid ChangedTemplate, Guid DeletedTemplate);

    /// <summary>A row in every model table, plus one in a Legacy table, and the values AC1 names.</summary>
    private async Task<Seed> SeedAsync()
    {
        var user = await FillAsync("Users", new() { ["Email"] = " Owner@X.test\t  ", ["DistanceUnit"] = (int)DistanceUnit.Km });
        var car = await FillAsync("Vehicles", new()
        {
            ["UserId"] = user, ["Vin"] = " Vin\t ", ["Nickname"] = "טויוטה שלום 🚗 ", ["Model"] = "",
        });
        var low = await FillAsync("Vehicles", new()
        {
            ["UserId"] = user, ["PurchasePrice"] = -9999999999.99m, ["CurrentOdometerKm"] = 0.01m, ["AvgKmPerDay"] = -9999999999.99m,
        });
        var templates = await QuerySqlRowsAsync(Source, "SELECT TOP 2 [Id] FROM [TaskTemplates] ORDER BY [Key]");
        var (changed, deleted) = ((Guid)templates[0][0]!, (Guid)templates[1][0]!);
        await SqlAsync(Source, $"UPDATE [TaskTemplates] SET [NameHe] = N'שמן מנוע משונה', [UpdatedAt] = '2026-03-01T10:00:00.1234567+05:30' WHERE [Id] = '{changed}'; DELETE FROM [TaskTemplates] WHERE [Id] = '{deleted}'");
        await FillAsync("Legacy_TireSets", new() { ["UserId"] = user });

        var reading = await FillAsync("OdometerReadings", new() { ["VehicleId"] = car });
        var task = await FillAsync("MaintenanceTasks", new() { ["VehicleId"] = car, ["IntervalKm"] = 1000 });
        var record = await FillAsync("ServiceRecords", new() { ["VehicleId"] = car });
        await FillAsync("ServiceRecordTasks", new() { ["ServiceRecordId"] = record, ["MaintenanceTaskId"] = task });
        await FillAsync("ServiceItems", new() { ["ServiceRecordId"] = record });
        await FillAsync("Attachments", new() { ["ServiceRecordId"] = record, ["SizeBytes"] = 1234567890123L });
        var template = await FillAsync("ChecklistTemplates", new() { ["UserId"] = user });
        var item = await FillAsync("ChecklistTemplateItems", new() { ["TemplateId"] = template });
        var checklist = await FillAsync("VehicleChecklists", new() { ["VehicleId"] = car, ["TemplateId"] = template });
        var run = await FillAsync("ChecklistRuns", new() { ["VehicleChecklistId"] = checklist, ["OdometerReadingId"] = reading });
        var runItem = await FillAsync("ChecklistRunItems", new() { ["RunId"] = run, ["TemplateItemId"] = item });
        await FillAsync("Issues", new() { ["VehicleId"] = car, ["SourceRunItemId"] = runItem, ["Status"] = 0 });
        var tire = await FillAsync("Tires", new() { ["VehicleId"] = car, ["RemovedOdometerKm"] = DBNull.Value });
        await FillAsync("TireMeasurements", new() { ["TireId"] = tire, ["PressureBar"] = 6.00m, ["TreadDepthMm"] = 20.0m });
        var rotation = await FillAsync("TireRotations", new() { ["VehicleId"] = car });
        await FillAsync("TireRotationMoves", new() { ["TireRotationId"] = rotation, ["TireId"] = tire });
        await FillAsync("VehicleDocuments", new() { ["VehicleId"] = car });
        var rule = await FillAsync("NotificationRules", new() { ["UserId"] = user, ["LeadDays"] = 30 });
        await FillAsync("Notifications", new() { ["UserId"] = user });

        return new Seed(user, car, low, rule, run, changed, deleted);
    }

    /// <summary>Inserts one row: the values given, then a value for each required column and each decimal, whose value is its largest. Other nullable columns stay null.</summary>
    private async Task<Guid> FillAsync(string table, Dictionary<string, object>? values = null)
    {
        values ??= [];
        var columns = await QuerySqlRowsAsync(Source, $"""
            SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
            FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{table}'
            """);
        var id = Guid.NewGuid();
        await using var connection = new SqlConnection(Source);
        await connection.OpenAsync();
        await using var insert = new SqlCommand { Connection = connection };
        var names = new List<string>();
        foreach (var column in columns)
        {
            var (name, type, required) = ((string)column[0]!, (string)column[1]!, (string)column[2]! == "NO");
            object? value = name == "Id" ? id : values.TryGetValue(name, out var given) ? given : Default(type, required, column);
            if (value is null or DBNull)
            {
                continue;
            }

            names.Add($"[{name}]");
            var parameter = insert.Parameters.AddWithValue($"@p{names.Count}", value);
            if (value is string)
            {
                parameter.SqlDbType = System.Data.SqlDbType.NVarChar;
            }
        }

        insert.CommandText = $"INSERT INTO [{table}] ({string.Join(", ", names)}) VALUES ({string.Join(", ", names.Select((_, i) => $"@p{i + 1}"))})";
        await insert.ExecuteNonQueryAsync();
        return id;
    }

    private static object? Default(string type, bool required, object?[] column) => type switch
    {
        "decimal" => decimal.Parse($"{new string('9', Convert.ToInt32(column[4]) - Convert.ToInt32(column[5]))}.{new string('9', Convert.ToInt32(column[5]))}", System.Globalization.CultureInfo.InvariantCulture),
        _ when !required => null,
        "uniqueidentifier" => Guid.NewGuid(),
        "datetimeoffset" => Stamp,
        "date" => new DateTime(2026, 1, 2),
        "bit" => true,
        "int" => 1,
        "bigint" => 1L,
        "nvarchar" => (Sentinel + Guid.NewGuid().ToString("N"))[..Math.Min(column[3] is int length && length > 0 ? length : 34, 34)],
        _ => throw new InvalidOperationException($"No default for {type}"),
    };

    private async Task<(int Exit, string Output)> RunAsync(CopyMode mode)
    {
        var output = new StringWriter();
        var exit = await DbCopyTool.RunAsync(mode, Source, Target, output, _ => Task.CompletedTask);
        return (exit, output.ToString());
    }

    private static async Task<(int Exit, string Output)> RunProcessAsync(string[] args, string secrets, Dictionary<string, string> environment)
    {
        var appData = Path.Combine(Path.GetTempPath(), $"dbcopy-test-{Guid.NewGuid():N}");
        var folder = Path.Combine(appData, "Microsoft", "UserSecrets", DbCopyTool.UserSecretsId);
        Directory.CreateDirectory(folder);
        await File.WriteAllTextAsync(Path.Combine(folder, "secrets.json"), secrets);
        try
        {
            var start = new ProcessStartInfo("dotnet") { RedirectStandardOutput = true, RedirectStandardError = true };
            // With this project's runtime settings: its output folder holds the tool, but leaves out what the ASP.NET Core framework it references provides.
            var tests = typeof(DbCopyTests).Assembly.Location;
            foreach (var arg in new[] { "exec", "--runtimeconfig", Path.ChangeExtension(tests, ".runtimeconfig.json"), "--depsfile", Path.ChangeExtension(tests, ".deps.json"), typeof(DbCopyTool).Assembly.Location })
            {
                start.ArgumentList.Add(arg);
            }

            foreach (var arg in args)
            {
                start.ArgumentList.Add(arg);
            }

            start.Environment["APPDATA"] = appData;
            foreach (var (key, value) in environment)
            {
                start.Environment[key] = value;
            }

            using var process = Process.Start(start)!;
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            return (process.ExitCode, await stdout + await stderr);
        }
        finally
        {
            Directory.Delete(appData, true);
        }
    }

    private async Task<string> TargetFingerprintAsync()
    {
        var parts = new List<string>();
        foreach (var table in CopyPlan.Tables())
        {
            parts.Add($"{table.Name}={(await PgRowsAsync(TargetAdmin, $"SELECT COUNT(*)::text || ':' || COALESCE(md5(string_agg(t::text, '|' ORDER BY t::text)), '') FROM onlycars.\"{table.Name}\" t"))[0]}");
        }

        return string.Join("\n", parts);
    }

    private async Task<long> PgCountAsync(string table) => long.Parse((await PgRowsAsync(TargetAdmin, $"SELECT COUNT(*)::text FROM onlycars.\"{table}\""))[0]);

    private static async Task<List<string>> PgRowsAsync(string connection, string sql)
    {
        await using var open = new NpgsqlConnection(connection);
        await open.OpenAsync();
        await using var command = new NpgsqlCommand(sql, open);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private static async Task PgAsync(string connection, string sql)
    {
        await using var open = new NpgsqlConnection(connection);
        await open.OpenAsync();
        await using var command = new NpgsqlCommand(sql, open);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task SqlAsync(string connection, string sql)
    {
        await using var open = new SqlConnection(connection);
        await open.OpenAsync();
        await using var command = new SqlCommand(sql, open) { CommandTimeout = 120 };
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<object?[]> QuerySqlAsync(string connection, string sql) => (await QuerySqlRowsAsync(connection, sql))[0];

    private static async Task<List<object?[]>> QuerySqlRowsAsync(string connection, string sql)
    {
        await using var open = new SqlConnection(connection);
        await open.OpenAsync();
        await using var command = new SqlCommand(sql, open);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<object?[]>();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            reader.GetValues(row!);
            rows.Add(row.Select(v => v is DBNull ? null : v).ToArray());
        }

        return rows;
    }

    private static string SchemaScript([CallerFilePath] string test = "") =>
        Path.Combine(Path.GetDirectoryName(test)!, "DbCopy", "sqlserver-schema-20261106063910.sql");
}
