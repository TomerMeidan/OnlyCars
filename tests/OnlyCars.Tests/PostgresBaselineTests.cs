using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>DB-1a: one empty database with scripts/app-db-user.sql run as the admin, and the baseline applied as the non-admin onlycars_app.</summary>
public sealed class AppRoleDatabase : IAsyncLifetime
{
    public string Admin { get; } = TestDbContextFactory.NewPostgresConnection();
    public string App { get; private set; } = "";

    private static string ScriptPath([CallerFilePath] string test = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(test)!, "..", "..", "scripts", "app-db-user.sql"));

    public async Task InitializeAsync()
    {
        await using (var maintenance = new NpgsqlConnection(TestDbContextFactory.AdminConnection))
        {
            await maintenance.OpenAsync();
            await using var create = new NpgsqlCommand($"CREATE DATABASE \"{new NpgsqlConnectionStringBuilder(Admin).Database}\"", maintenance);
            await create.ExecuteNonQueryAsync();
        }

        var password = Guid.NewGuid().ToString("N");
        var script = await File.ReadAllTextAsync(ScriptPath());
        Assert.Contains("REPLACE-WITH-A-LONG-RANDOM-PASSWORD", script);
        await ExecuteAsync(Admin, script.Replace("REPLACE-WITH-A-LONG-RANDOM-PASSWORD", password));
        App = new NpgsqlConnectionStringBuilder(Admin) { Username = "onlycars_app", Password = password }.ConnectionString;

        await using var db = new AppDbContext(TestDbContextFactory.PostgresOptions(App).Options);
        await db.Database.MigrateAsync();
    }

    public Task DisposeAsync() => Task.CompletedTask; // the container goes with the run

    public static async Task ExecuteAsync(string connection, string sql)
    {
        await using var c = new NpgsqlConnection(connection);
        await c.OpenAsync();
        await using var command = new NpgsqlCommand(sql, c);
        await command.ExecuteNonQueryAsync();
    }

    public static async Task<List<T>> QueryAsync<T>(string connection, string sql)
    {
        await using var c = new NpgsqlConnection(connection);
        await c.OpenAsync();
        await using var command = new NpgsqlCommand(sql, c);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<T>();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetFieldValue<T>(0));
        }
        return rows;
    }
}

public class PostgresBaselineTests(AppRoleDatabase database) : IClassFixture<AppRoleDatabase>
{
    private static readonly DateOnly Today = new(2026, 11, 7);

    private AppDbContext App() => new(TestDbContextFactory.PostgresOptions(database.App).Options);

    private Task<List<string>> Strings(string sql) => AppRoleDatabase.QueryAsync<string>(database.App, sql);

    private Task<List<long>> Count(string sql) => AppRoleDatabase.QueryAsync<long>(database.App, sql);

    [Fact]
    public async Task Baseline_AsTheAppRole_EveryTableInTheSchema_NoneInPublic_NoSequences()
    {
        Assert.Equal(["onlycars_app"], await Strings("SELECT current_user::text"));

        await using var db = App();
        var expected = db.Model.GetEntityTypes().Select(t => t.GetTableName()!).Append("__EFMigrationsHistory").Distinct().Order(StringComparer.Ordinal);
        Assert.Equal(expected, await Strings("SELECT tablename::text FROM pg_tables WHERE schemaname = 'onlycars' ORDER BY tablename"));
        Assert.All(db.Model.GetEntityTypes(), t => Assert.Equal("onlycars", t.GetSchema()));
        Assert.Equal(["onlycars_app"], await Strings("SELECT DISTINCT tableowner::text FROM pg_tables WHERE schemaname = 'onlycars'"));

        // Anything at all in public, not only tables; and neither sequences nor identity columns anywhere outside the system schemas.
        Assert.Equal([0L], await Count("SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'"));
        Assert.Equal([0L], await Count("SELECT COUNT(*) FROM pg_sequences"));
        Assert.Equal([0L], await Count("SELECT COUNT(*) FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'onlycars' AND a.attidentity <> ''"));
    }

    [Fact]
    public async Task Baseline_EveryStringColumnHasItsCollation_EmailAndVinCaseInsensitive()
    {
        const string columns = """
            SELECT c.relname || '.' || a.attname || ' ' || co.collname || ' ' || co.collisdeterministic
            FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_collation co ON co.oid = a.attcollation
            WHERE n.nspname = 'onlycars' AND c.relkind = 'r' AND c.relname <> '__EFMigrationsHistory' AND a.attnum > 0 AND NOT a.attisdropped
            """;
        var rows = await Strings(columns);

        Assert.Contains("TaskTemplates.NameHe und-x-icu true", rows);
        Assert.Equal(["Users.Email und_ci false", "Vehicles.Vin und_ci false"], rows.Where(r => !r.EndsWith(" und-x-icu true")).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Baseline_MoneyAndDatesHaveTheSpecTypes()
    {
        Assert.Equal(["numeric(12,2)"], await Strings("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'onlycars.\"ServiceRecords\"'::regclass AND attname = 'TotalCost'"));
        Assert.Equal(["numeric(9,2)"], await Strings("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'onlycars.\"ServiceItems\"'::regclass AND attname = 'Quantity'"));
        Assert.Equal(["timestamp with time zone"], await Strings("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'onlycars.\"Users\"'::regclass AND attname = 'UpdatedAt'"));
        Assert.Equal(["date"], await Strings("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'onlycars.\"ServiceRecords\"'::regclass AND attname = 'Date'"));
        Assert.Equal(["uuid"], await Strings("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'onlycars.\"Users\"'::regclass AND attname = 'Id'"));
    }

    [Fact]
    public async Task Baseline_SeedsEveryTemplateWithItsHebrewName()
    {
        await using var db = App();
        var seeded = await db.TaskTemplates.OrderBy(t => t.Id).Select(t => new { t.Key, t.NameHe }).ToListAsync();

        Assert.Equal([
            ("oilChange", "שמן מנוע ופילטר שמן"), ("airFilter", "פילטר אוויר"), ("cabinFilter", "פילטר מזגן"), ("brakePads", "בדיקת רפידות בלמים"),
            ("brakeFluid", "נוזל בלמים"), ("coolant", "נוזל קירור"), ("transmissionFluid", "שמן גיר"), ("sparkPlugs", "מצתים"),
            ("timingBelt", "רצועת טיימינג"), ("tireRotation", "רוטציית צמיגים"), ("battery", "בדיקת מצבר"), ("wiperBlades", "מגבים"),
        ], seeded.Select(t => (t.Key, t.NameHe)));
    }

    private async Task<(User User, Vehicle Car, ServiceRecord Record, ChecklistRunItem Item, ChecklistTemplate Template)> SeedAsync(AppDbContext db)
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x", GoogleSubject = Guid.NewGuid().ToString("N") };
        var car = new Vehicle { User = user, Nickname = "Car", Vin = "VIN1" };
        var record = new ServiceRecord { Vehicle = car, Date = Today };
        var template = new ChecklistTemplate { User = user, Name = "T" };
        var item = new ChecklistRunItem
        {
            LabelSnapshot = "L",
            Run = new ChecklistRun { VehicleChecklist = new VehicleChecklist { Vehicle = car, Template = template }, RunAt = Today },
        };
        db.AddRange(user, car, record, template, item,
            new Tire { Vehicle = car, Position = TirePosition.FL, Brand = "A", FittedAt = Today },
            new OdometerReading { Vehicle = car, ValueKm = 1, ReadingDate = Today, ClientRequestId = FixedRequest },
            new Issue { Vehicle = car, Title = "I", SourceRunItem = item });
        await db.SaveChangesAsync();
        return (user, car, record, item, template);
    }

    private static readonly Guid FixedRequest = Guid.Parse("7a5c0000-0000-4000-8000-0000000000aa");

    private static async Task AssertRefusedAsync(AppDbContext db, string constraint, object row)
    {
        db.Add(row);
        var error = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(constraint, Assert.IsType<PostgresException>(error.InnerException).ConstraintName);
        db.ChangeTracker.Clear();
    }

    [Fact]
    public async Task Baseline_EveryCheckConstraint_IsEnforced()
    {
        await using var db = App();
        var (user, car, record, _, template) = await SeedAsync(db);
        var tire = await db.Tires.FirstAsync(t => t.VehicleId == car.Id);
        db.ChangeTracker.Clear();

        var violations = new (string Constraint, object Row)[]
        {
            ("CK_TaskTemplates_Interval", new TaskTemplate { Key = "none", Name = "n", NameHe = "n" }),
            ("CK_NotificationRules_LeadDays", new NotificationRule { UserId = user.Id, LeadDays = NotificationRule.MaxLeadDays + 1 }),
            ("CK_ChecklistTemplateItems_Range", new ChecklistTemplateItem { TemplateId = template.Id, Label = "x", MinValue = 2, MaxValue = 1 }),
            ("CK_MaintenanceTasks_Interval", new MaintenanceTask { VehicleId = car.Id, Name = "x" }),
            ("CK_VehicleDocuments_Cost", new VehicleDocument { VehicleId = car.Id, ExpiryDate = Today, Cost = -1 }),
            ("CK_ServiceItems_Quantity", new ServiceItem { ServiceRecordId = record.Id, Description = "x", Quantity = 0, UnitCost = 1 }),
            ("CK_ServiceItems_UnitCost", new ServiceItem { ServiceRecordId = record.Id, Description = "x", Quantity = 1, UnitCost = -1 }),
            ("CK_Tires_Removal", new Tire { VehicleId = car.Id, Position = TirePosition.Spare, Brand = "x", FittedAt = Today, RemovedAt = Today.AddDays(-1), RemovedOdometerKm = 0 }),
            ("CK_TireMeasurements_Values", new TireMeasurement { TireId = tire.Id, MeasuredAt = Today }),
            ("CK_Attachments_OneParent", new Attachment { FileUrl = "k", FileName = "x", ContentType = "x" }),
            ("CK_Issues_ResolvedAt", new Issue { VehicleId = car.Id, Title = "x", Status = IssueStatus.Done }),
        };
        foreach (var (constraint, row) in violations)
        {
            await AssertRefusedAsync(db, constraint, row);
        }

        // Fails if the schema gains a check nobody tests here.
        Assert.Equal(violations.Select(v => v.Constraint).Order(StringComparer.Ordinal),
            await Strings("SELECT c.conname::text FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'onlycars' AND c.contype = 'c' ORDER BY 1"));
    }

    [Fact]
    public async Task Baseline_EveryFilteredUniqueIndex_RefusesADuplicate_AndAllowsRowsOutsideItsFilter()
    {
        await using var db = App();
        var (user, car, _, item, _) = await SeedAsync(db);
        var (carId, userId, itemId, subject) = (car.Id, user.Id, item.Id, user.GoogleSubject);
        db.ChangeTracker.Clear();

        var duplicates = new (string Index, object Row)[]
        {
            ("IX_Issues_SourceRunItemId", new Issue { VehicleId = carId, Title = "x", SourceRunItemId = itemId }),
            ("IX_OdometerReadings_VehicleId_ClientRequestId", new OdometerReading { VehicleId = carId, ValueKm = 1, ReadingDate = Today, ClientRequestId = FixedRequest }),
            ("IX_Tires_VehicleId_Position_OnCar", new Tire { VehicleId = carId, Position = TirePosition.FL, Brand = "x", FittedAt = Today }),
            ("IX_Users_GoogleSubject", new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x", GoogleSubject = subject }),
            ("IX_Vehicles_UserId_Vin", new Vehicle { UserId = userId, Nickname = "x", Vin = "vin1" }), // differs only in case
        };
        foreach (var (index, row) in duplicates)
        {
            await AssertRefusedAsync(db, index, row);
        }

        // Outside each filter the same values are allowed, twice.
        db.AddRange(new Issue { VehicleId = carId, Title = "a" }, new Issue { VehicleId = carId, Title = "b" },
            new OdometerReading { VehicleId = carId, ValueKm = 2, ReadingDate = Today }, new OdometerReading { VehicleId = carId, ValueKm = 3, ReadingDate = Today },
            new Tire { VehicleId = carId, Position = TirePosition.FL, Brand = "a", FittedAt = Today, RemovedAt = Today, RemovedOdometerKm = 0 },
            new Tire { VehicleId = carId, Position = TirePosition.FL, Brand = "b", FittedAt = Today, RemovedAt = Today, RemovedOdometerKm = 0 },
            new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x" }, new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x" },
            new Vehicle { UserId = userId, Nickname = "a" }, new Vehicle { UserId = userId, Nickname = "b" });
        await db.SaveChangesAsync();

        Assert.Equal(duplicates.Select(d => d.Index).Order(StringComparer.Ordinal),
            await Strings("SELECT c.relname::text FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'onlycars' AND i.indisunique AND i.indpred IS NOT NULL ORDER BY 1"));
    }

    [Fact]
    public async Task Baseline_DeferredKeys_LetACascadeReachOneRowByTwoPaths_ButStillRefuseARawParentDelete()
    {
        await using var db = App();
        var (user, car, _, _, template) = await SeedAsync(db);
        db.ChangeTracker.Clear();

        // Attached to a car: the template can't go alone (the check runs when the statement's own transaction commits).
        var refused = await Assert.ThrowsAsync<PostgresException>(() => db.ChecklistTemplates.Where(t => t.Id == template.Id).ExecuteDeleteAsync());
        Assert.Equal(("23503", "FK_VehicleChecklists_ChecklistTemplates_TemplateId"), (refused.SqlState, refused.ConstraintName));
        Assert.True(await db.ChecklistTemplates.AnyAsync(t => t.Id == template.Id));

        // The user reaches it through the template and through the car: both in one statement.
        await db.Users.Where(u => u.Id == user.Id).ExecuteDeleteAsync();
        Assert.False(await db.Vehicles.AnyAsync(v => v.Id == car.Id));

        // A migration that recreates one of these keys would lose the deferral (the model can't express it), and cascades would start failing.
        Assert.Equal(["FK_ChecklistRunItems_ChecklistTemplateItems_TemplateItemId", "FK_ChecklistRuns_OdometerReadings_OdometerReadingId",
            "FK_Issues_ChecklistRunItems_SourceRunItemId", "FK_OdometerReadings_ServiceRecords_ServiceRecordId", "FK_ServiceRecordTasks_MaintenanceTasks_MaintenanceTaskId",
            "FK_TireRotationMoves_Tires_TireId", "FK_Tires_ServiceRecords_ServiceRecordId", "FK_VehicleChecklists_ChecklistTemplates_TemplateId"],
            await Strings("SELECT c.conname::text FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'onlycars' AND c.contype = 'f' AND c.condeferred ORDER BY 1"));
    }

    [Fact]
    public async Task ARoleWithNoGrants_CantReadTheSchema()
    {
        // Stands in for Supabase's anon, the role behind its public REST API.
        await AppRoleDatabase.ExecuteAsync(database.Admin, "DROP ROLE IF EXISTS anon_standin; CREATE ROLE anon_standin NOLOGIN;");

        Assert.Equal([false], await AppRoleDatabase.QueryAsync<bool>(database.Admin, "SELECT has_schema_privilege('anon_standin', 'onlycars', 'USAGE')"));
        Assert.Equal([false], await AppRoleDatabase.QueryAsync<bool>(database.Admin, "SELECT has_schema_privilege('anon_standin', 'onlycars', 'CREATE')"));
        var refused = await Assert.ThrowsAsync<PostgresException>(() =>
            AppRoleDatabase.ExecuteAsync(database.Admin, "SET ROLE anon_standin; SELECT * FROM onlycars.\"Users\";"));
        Assert.Equal("42501", refused.SqlState);
    }

    [Fact]
    public async Task TheAppRole_HasNoRightsOutsideItsSchema()
    {
        var refused = await Assert.ThrowsAsync<PostgresException>(() => AppRoleDatabase.ExecuteAsync(database.App, "CREATE TABLE public.x (id int);"));
        Assert.Equal("42501", refused.SqlState);
        Assert.Equal([false], await AppRoleDatabase.QueryAsync<bool>(database.App,
            "SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
    }

    [Fact]
    public async Task TheTests_RunOnlyOnTheirOwnContainer()
    {
        var own = new NpgsqlConnectionStringBuilder(TestDbContextFactory.AdminConnection);

        // Not onlycars-pg (Postgres 18 on 5432), the local dev database (5433), or a remote host: a random port on this machine, on Postgres 17.
        Assert.True(own.Host is "127.0.0.1" or "localhost", own.Host);
        Assert.DoesNotContain(own.Port, new[] { 5432, 5433 });
        Assert.StartsWith("17.", Assert.Single(await AppRoleDatabase.QueryAsync<string>(TestDbContextFactory.AdminConnection, "SHOW server_version")));
    }
}
