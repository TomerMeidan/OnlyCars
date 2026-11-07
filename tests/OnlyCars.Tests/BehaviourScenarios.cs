using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using OnlyCars.Application.Auth.Dtos;
using OnlyCars.Application.Checklists;
using OnlyCars.Application.Checklists.Dtos;
using OnlyCars.Application.Common.Exceptions;
using OnlyCars.Application.Maintenance;
using OnlyCars.Application.Maintenance.Dtos;
using OnlyCars.Application.Odometer;
using OnlyCars.Application.Odometer.Dtos;
using OnlyCars.Application.Reports;
using OnlyCars.Application.Vehicles;
using OnlyCars.Application.Vehicles.Dtos;
using OnlyCars.Domain;
using OnlyCars.Domain.Entities;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.Tests;

/// <summary>
/// DB-1b: the behaviour scenarios, each giving "input => result" lines. This same file was run on SQL Server (LocalDB, commit 15df39e) to get the
/// fixed lists in BehaviourParityTests, so the old results don't depend on memory (docs/contracts/DB-1b.md).
/// </summary>
public static class BehaviourScenarios
{
    private static readonly DateOnly D = new(2025, 6, 15);
    private static readonly Guid OilTemplate = Guid.Parse("7a5c0000-0000-4000-8000-000000000001");

    // Marks and invisible characters as \uXXXX, so a list reads the same in any editor.
    public static string Show(string? text)
    {
        if (text is null) return "null";
        var b = new StringBuilder();
        foreach (var c in text)
        {
            var cat = char.GetUnicodeCategory(c);
            b.Append(cat is UnicodeCategory.NonSpacingMark or UnicodeCategory.Format or UnicodeCategory.Control || c == '\\' ? $"\\u{(int)c:X4}" : c.ToString());
        }
        return b.ToString();
    }

    private static string Join(IEnumerable<string> names) => string.Join(" | ", names.Select(Show));

    private static async Task<(Guid User, Guid Car)> CarAsync(AppDbContext db, string nickname = "Car")
    {
        var user = new User { Email = $"{Guid.NewGuid():N}@x.test", PasswordHash = "x" };
        var car = new Vehicle { User = user, Nickname = nickname, CurrentOdometerKm = 50_000 };
        db.AddRange(user, car);
        await db.SaveChangesAsync();
        return (user.Id, car.Id);
    }

    // --- AC1 ---

    public static readonly string[] SearchTerms =
    [
        // Hebrew: final letters, several words
        "שלום", "שלומ", "שלו", "מוסך", "מוסכ", "מוסך שלום", "שלום מוסך", "שמן", "שמנ", "מנוע", "מנוע שמן", "שמן מנוע", "פילטר", "בוש", "בלמים", "בלמימ", "בלם",
        // Niqqud: on the search, on the stored text, on both; cantillation; presentation forms; maqaf
        "שָׁלוֹם", "שׁלום", "עליכם", "עֲלֵיכֶם", "עלֵיכם", "בית", "בֵּית", "ספר", "בית־ספר", "בית-ספר", "תורה", "תּוֹרָה", "תורה\u0591", "כותב", "\uFB20ין", "עין", "גלגלים", "ג\u200Fלגלים", "דרך", "דרכ", "דֶּרֶךְ", "קרקע",
        // English
        "speedy", "SPEEDY", "SpEeDy", "garage speedy", "oil", "CHANGE", "bosch", "BOSCH", "ab-1234", "AB1234", "1234", "engine", "ENGINE OIL", "filter oil",
        // Accents, ligatures, other alphabets, width
        "cafe", "CAFE", "caf\u00E9", "CAF\u00C9", "muller", "m\u00FCller", "M\u00DCLLER", "strasse", "STRASSE", "stra\u00DFe", "STRA\u1E9EE", "istanbul", "\u0130stanbul", "\u0131stanbul", "\u03C3\u03B1\u03C2", "\u03A3\u0391\u03A3", "\u03C3\u03B1\u03C3", "\uFF2F\uFF29\uFF2C", "\uFF53\uFF50\uFF45\uFF45\uFF44\uFF59", "\uFB01lter",
        // Literal wildcards
        "%", "_", "[", "]", "\\", "^", "-", "50%", "%off", "5%", "a_b", "a%b", "[x]", "[x", "x]", "[a-z]", "c:\\temp", "\\temp", "c:", "temp",
    ];

    // Invisible characters in stored text, each on a record of its own: the search "קרקע" shows which ones it looks through.
    private static readonly char[] IgnorableMarks = ['\u200E', '\u200F', '\u200B', '\u200C', '\u200D', '\u00AD', '\uFEFF', '\u2060', '\u202A', '\u202C', '\u2066', '\u061C', '\u034F'];

    public static async Task<List<string>> SearchAsync(AppDbContext db)
    {
        var (user, car) = await CarAsync(db);
        var vehicles = new VehicleService(db);
        var tasks = new MaintenanceTaskService(db, vehicles);
        var labels = new Dictionary<Guid, string>();
        var day = 0;

        async Task Add(string label, string? shop = null, string? notes = null, ServiceItem? item = null, string? taskName = null, Guid? template = null)
        {
            var record = new ServiceRecord { VehicleId = car, Date = D.AddDays(-day++), OdometerKm = 1000, ShopName = shop, Notes = notes };
            if (item is not null) record.Items.Add(item);
            if (taskName is not null)
            {
                var task = await tasks.CreateAsync(user, car, new CreateMaintenanceTaskRequest(template, taskName, "Other", 5_000, 365, 40_000, D));
                record.Tasks.Add(new ServiceRecordTask { MaintenanceTaskId = task.Id, PreviousLastDoneDate = D });
            }
            db.ServiceRecords.Add(record);
            await db.SaveChangesAsync();
            labels[record.Id] = label;
        }

        ServiceItem Item(string description, string? brand = null, string? part = null) => new() { Description = description, Brand = brand, PartNumber = part, Quantity = 1, UnitCost = 1 };

        await Add("heShop", shop: "מוסך שלום");
        await Add("heNotes", notes: "החלפתי שמן במנוע");
        await Add("heItem", item: Item("פילטר שמן", "בוש"));
        await Add("heTask", taskName: "בדיקת בלמים");
        await Add("template", taskName: "Renamed task", template: OilTemplate);
        await Add("niqqud", notes: "שָׁלוֹם עֲלֵיכֶם");
        await Add("maqaf", notes: "בֵּית־סֵפֶר");
        await Add("cantillation", notes: "תּוֹרָ\u0591ה");
        await Add("presentation", notes: "\uFB20ין \uFB3Bותב");
        await Add("rlm", notes: "גל\u200Fגלים");
        await Add("finalNiqqud", notes: "דֶּרֶךְ");
        await Add("enShop", shop: "Speedy Garage");
        await Add("enNotes", notes: "OIL Change");
        await Add("enItem", item: Item("Wiper", "BoSch", "AB-1234"));
        await Add("accent", notes: "Caf\u00E9 M\u00FCller");
        await Add("sharpS", notes: "Stra\u00DFe");
        await Add("dottedI", notes: "\u0130stanbul");
        await Add("greek", notes: "\u03A3\u0391\u03A3");
        await Add("percent", notes: "50% off");
        await Add("under", notes: "a_b");
        await Add("bracket", notes: "[x]");
        await Add("backslash", notes: "c:\\temp");
        await Add("control", notes: "50 off axb x c:temp");
        foreach (var mark in IgnorableMarks)
        {
            await Add($"cf{(int)mark:X4}", notes: $"ק{mark}רקע");
        }

        var lines = new List<string>();
        foreach (var term in SearchTerms)
        {
            var page = await tasks.SearchRecordsAsync(user, null, null, null, null, term, 0, 100);
            lines.Add($"{Show(term)} => {string.Join(",", page.Items.Select(r => labels[r.Id]).Order(StringComparer.Ordinal))}");
        }
        return lines;
    }

    // --- AC2 ---

    public static readonly string[] SortNames =
    [
        "Zed", "beta check", "alpha", "ALPHA2", "Alpha1", "Beta check 2", "apple", "\u05D1\u05D9\u05EA\u05E1\u05E4\u05E8", "banana", "\u05E6\u05F3\u05E8\u05D9", "\u00C9clair", "eclair2", "Eclair3", "\u05E6\u05E8\u05D9",
        "Car 10", "car 2", "Car-1", "car1", "car 1", "co-op", "coop", "Coop2", "o'neil", "oneil", "_under", "1st", "\u05E6'\u05E8\u05D9", "\u05D1\u05D9\u05EA\u05BE\u05E1\u05E4\u05E8", "(paren)", "\u00C4rger", "arger2",
        "טויוטה", "מאזדה", "אבג", "אבד", "בית", "ביתא", "מכונית", "מכוניות", "שלום", "שלומ", "שָׁלוֹם", "שלונ", "ץ", "צבי", "\u05DE\u05DB\u05D5\u05DF", "קיה", "תשע",
    ];

    // Two or more hyphens, apostrophes, or both, between names that show whether every one is ignored.
    public static readonly string[] SeparatorSortNames =
    [
        "abb", "a-b-c", "abd", "A-B-D", "abc", "a-b-c-d", "abcd", "abce", "aa", "ab", "a--b", "ac",
        "o'ne'il", "o'n'e'i'l", "oneik", "oneil", "oneim",
        "rock-'n'-roll", "rock'n'roll", "rocknroll", "rocknrolk", "rocknrolm", "x-y'z", "xyy", "xyz", "xyzz", "x'y-z-z",
        "--m--", "l", "m", "n", "co-op-2", "co-op2", "coop3",
        "ג'ו'ב", "גוא", "גוב", "גוג", "ת-ל-א", "תל", "תלב",
    ];

    private static readonly string[] CaseOnly = ["Beta", "beta", "BETA"];

    public static async Task<List<string>> SortAsync(AppDbContext db, string[]? names = null)
    {
        var (user, _) = await CarAsync(db, "seed");
        var vehicles = new VehicleService(db);
        var tasks = new MaintenanceTaskService(db, vehicles);
        var templates = new ChecklistTemplateService(db);
        var car = await vehicles.CreateAsync(user, new CreateVehicleRequest("Tasks", null, null, null, null, null, null, null, null, null, 50_000));
        var taskIds = new List<Guid>();
        foreach (var name in names ?? SortNames)
        {
            await vehicles.CreateAsync(user, new CreateVehicleRequest(name, null, null, null, null, null, null, null, null, null, null));
            await templates.CreateAsync(user, new ChecklistTemplateRequest(name, []));
            taskIds.Add((await tasks.CreateAsync(user, car.Id, new CreateMaintenanceTaskRequest(null, name, "Other", 5_000, 365, 40_000, D))).Id);
        }

        var lines = new List<string>();
        lines.Add("vehicles => " + Join((await vehicles.ListAsync(user, false)).Select(v => v.Nickname).Where(n => n is not ("seed" or "Tasks"))));
        lines.Add("templates => " + Join((await templates.ListAsync(user)).Select(t => t.Name)));
        lines.Add("tasks => " + Join((await tasks.ListAsync(user, car.Id)).Select(t => t.Name)));
        var created = await tasks.CreateRecordAsync(user, car.Id, new CreateServiceRecordRequest(null, 50_000, "s", null, null, taskIds));
        lines.Add("record tasks (:415) => " + Join(created.Record.Tasks.Select(t => t.Name)));
        db.ChangeTracker.Clear();
        var voided = await tasks.VoidAsync(user, car.Id, created.Record.Id);
        lines.Add("void (:603) => " + Join(voided.Select(t => t.Name)));
        db.ChangeTracker.Clear();
        return lines;
    }

    /// <summary>Names equal but for case, created one way and then the other: templates tie-break on CreatedAt.</summary>
    public static async Task<List<string>> CaseOnlySortAsync(AppDbContext db)
    {
        var lines = new List<string>();
        var templates = new ChecklistTemplateService(db);
        var vehicles = new VehicleService(db);
        foreach (var order in new[] { CaseOnly, CaseOnly.Reverse().ToArray() })
        {
            var (user, car) = await CarAsync(db, "aaa");
            var tasks = new MaintenanceTaskService(db, vehicles);
            foreach (var name in order)
            {
                await Task.Delay(5);
                await templates.CreateAsync(user, new ChecklistTemplateRequest(name, []));
                await vehicles.CreateAsync(user, new CreateVehicleRequest(name, null, null, null, null, null, null, null, null, null, null));
                await tasks.CreateAsync(user, car, new CreateMaintenanceTaskRequest(null, name, "Other", 5_000, 365, 40_000, D));
            }
            var label = Join(order);
            lines.Add($"templates created {label} => {Join((await templates.ListAsync(user)).Select(t => t.Name))}");
        }
        return lines;
    }

    // --- AC3 ---

    private static async Task<string> Try(AppDbContext db, Func<Task<string>> action)
    {
        try
        {
            return await action();
        }
        catch (AppException e)
        {
            db.ChangeTracker.Clear();
            return e.Code;
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return "DbUpdateException";
        }
    }

    public static async Task<List<string>> EmailAsync(AppDbContext db)
    {
        const string password = "right-password-1";
        var lines = new List<string>();
        var registered = await AccountDeleteTests.Auth(db).RegisterAsync(new RegisterRequest("A@X.com", password));
        lines.Add($"register A@X.com => {registered.User.Email}");

        foreach (var email in new[] { "a@x.com", "A@x.com", "A@X.COM", "a@x.com ", " a@x.com", "  A@X.COM  ", "a@x.com\t", "\uFF41@x.com", "\u00E1@x.com", "a@x.co", "a@x.comm" })
        {
            lines.Add($"login '{Show(email)}' => {await Try(db, async () => (await AccountDeleteTests.Auth(db).LoginAsync(new LoginRequest(email, password))).User.Email)}");
        }
        foreach (var email in new[] { "a@x.com", "A@X.COM", "a@x.com ", " A@x.com", "\uFF41@x.com", "\u00E1@x.com" })
        {
            lines.Add($"register '{Show(email)}' => {await Try(db, async () => (await AccountDeleteTests.Auth(db).RegisterAsync(new RegisterRequest(email, password))).User.Email)}");
        }
        foreach (var email in new[] { "A@X.COM", "a@x.com ", "\uFF41@x.com" })
        {
            var result = await Try(db, async () =>
            {
                db.Users.Add(new User { Email = email, PasswordHash = "x" });
                await db.SaveChangesAsync();
                return "accepted";
            });
            db.ChangeTracker.Clear();
            lines.Add($"unique index '{Show(email)}' => {result}");
        }
        return lines;
    }

    private static CreateVehicleRequest NewCar(string? vin) => new("Car", null, null, null, vin, null, null, null, null, null, null);

    private static UpdateVehicleRequest Edit(string? vin) => new("Car", null, null, null, vin, null, null, null, null, null);

    public static readonly string[] VinVariants = ["ABC123", "abc123", "Abc123", "ABC123 ", "abc123   ", " ABC123", "ABC123\t", "\uFF21\uFF22\uFF23123", "\u00C0BC123", "ABC1234"];

    public static async Task<List<string>> VinAsync(AppDbContext db)
    {
        var lines = new List<string>();
        var vehicles = new VehicleService(db);
        string Quote(string? vin) => vin is null ? "null" : $"'{Show(vin)}'";

        foreach (var vin in VinVariants)
        {
            var (user, _) = await CarAsync(db, "x");
            await vehicles.CreateAsync(user, NewCar("ABC123"));
            lines.Add($"create {Quote(vin)} with ABC123 on the account => {await Try(db, async () => Quote((await vehicles.CreateAsync(user, NewCar(vin))).Vin))}");
            db.ChangeTracker.Clear();

            var (user1, _) = await CarAsync(db, "x");
            await vehicles.CreateAsync(user1, NewCar("ABC123"));
            var other = await vehicles.CreateAsync(user1, NewCar(null));
            lines.Add($"edit another car to {Quote(vin)} => {await Try(db, async () => Quote((await vehicles.UpdateAsync(user1, other.Id, Edit(vin))).Vin))}");
            db.ChangeTracker.Clear();

            var (user2, _) = await CarAsync(db, "x");
            await vehicles.CreateAsync(user2, NewCar("ABC123"));
            var index = await Try(db, async () =>
            {
                db.Vehicles.Add(new Vehicle { UserId = user2, Nickname = "raw", Vin = vin });
                await db.SaveChangesAsync();
                return "accepted";
            });
            db.ChangeTracker.Clear();
            lines.Add($"unique index {Quote(vin)} => {index}");

            var (user3, _) = await CarAsync(db, "y");
            var own = await vehicles.CreateAsync(user3, NewCar("ABC123"));
            var edited = await Try(db, async () =>
            {
                await vehicles.UpdateAsync(user3, own.Id, Edit(vin));
                db.ChangeTracker.Clear();
                return Quote((await vehicles.GetAsync(user3, own.Id)).Vin);
            });
            db.ChangeTracker.Clear();
            lines.Add($"edit its own ABC123 to {Quote(vin)} => {edited}");
        }

        // Blank: no check runs, so the index decides.
        foreach (var (first, second) in new[] { ("", ""), ("", "  "), ("  ", ""), (" ", "  ") })
        {
            var (user, _) = await CarAsync(db, "z");
            await vehicles.CreateAsync(user, NewCar(first));
            lines.Add($"create {Quote(second)} with {Quote(first)} on the account => {await Try(db, async () => Quote((await vehicles.CreateAsync(user, NewCar(second))).Vin))}");
            db.ChangeTracker.Clear();
        }

        // Another user's VIN is free, whatever its case.
        var (a, _) = await CarAsync(db, "a");
        var (b, _) = await CarAsync(db, "b");
        await vehicles.CreateAsync(a, NewCar("SAME1"));
        lines.Add($"another user's VIN in another case => {await Try(db, async () => Quote((await vehicles.CreateAsync(b, NewCar("same1"))).Vin))}");
        return lines;
    }

    // --- AC4 ---

    private static string Dec(decimal? value) => value?.ToString(CultureInfo.InvariantCulture) ?? "null";

    /// <summary>Every numeric column of the model at its limits, on rows from a full seed.</summary>
    public static async Task<List<string>> DecimalLimitsAsync(AppDbContext db)
    {
        var owner = Guid.NewGuid();
        await ExportTests.SeedAsync(db, owner, "limits");
        db.ChangeTracker.Clear();

        var lines = new List<string>();
        foreach (var entity in db.Model.GetEntityTypes().OrderBy(e => e.ClrType.Name, StringComparer.Ordinal))
        {
            var columns = entity.GetProperties().Where(p => (Nullable.GetUnderlyingType(p.ClrType) ?? p.ClrType) == typeof(decimal)).OrderBy(p => p.Name, StringComparer.Ordinal).ToList();
            if (columns.Count == 0) continue;
            var set = (IQueryable<object>)typeof(DbContext).GetMethods().Single(m => m is { Name: "Set", IsGenericMethod: true } && m.GetParameters().Length == 0).MakeGenericMethod(entity.ClrType).Invoke(db, null)!;

            foreach (var column in columns)
            {
                var match = Regex.Match(column.GetColumnType(), @"\((\d+),(\d+)\)");
                var (precision, scale) = (int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value));
                var step = 1m;
                for (var i = 0; i < scale; i++) step /= 10;
                var max = (decimal)Math.Pow(10, precision - scale) - step;
                foreach (var value in new[] { max, step, -max })
                {
                    var result = await Try(db, async () =>
                    {
                        // The same row every time: the oldest, as Postgres moves a row when it is updated and the Id sort differs.
                        var row = await set.OrderBy(x => EF.Property<DateTimeOffset>(x, "CreatedAt")).FirstAsync();
                        var id = (Guid)db.Entry(row).Property("Id").CurrentValue!;
                        db.Entry(row).Property(column.Name).CurrentValue = value;
                        await db.SaveChangesAsync();
                        db.ChangeTracker.Clear();
                        var back = await set.SingleAsync(x => EF.Property<Guid>(x, "Id") == id);
                        return Dec((decimal?)db.Entry(back).Property(column.Name).CurrentValue);
                    });
                    db.ChangeTracker.Clear();
                    lines.Add($"{entity.ClrType.Name}.{column.Name} ({precision},{scale}) {Dec(value)} => {result}");
                }
            }
        }
        return lines;
    }

    private static readonly decimal[] Extra12 = [1.004m, 1.005m, 1.006m, 1.015m, 1.025m, 1.994m, 1.995m, 1.999m, 0.005m, 0.009m, 10.555m, 9999999999.989m, 9999999999.994m, 9999999999.995m, 9999999999.999m, 10000000000.00m];

    /// <summary>More decimals than the column, saved through EF as a service would.</summary>
    public static async Task<List<string>> DecimalExtraAsync(AppDbContext db)
    {
        var lines = new List<string>();
        var (user, car) = await CarAsync(db);
        var tire = new Tire { VehicleId = car, Position = TirePosition.FL, Brand = "A", FittedAt = D };
        var record = new ServiceRecord { VehicleId = car, Date = D };
        db.AddRange(tire, record);
        await db.SaveChangesAsync();

        async Task Column(string name, Func<decimal, object> row, Func<object, IQueryable<decimal?>> read, decimal[] values)
        {
            foreach (var value in values)
            {
                var result = await Try(db, async () =>
                {
                    var added = row(value);
                    db.Add(added);
                    await db.SaveChangesAsync();
                    db.ChangeTracker.Clear();
                    return Dec(await read(added).SingleAsync());
                });
                db.ChangeTracker.Clear();
                lines.Add($"{name} {Dec(value)} => {result}");
            }
        }

        await Column("(12,2) ServiceRecord.TotalCost",
            v => new ServiceRecord { VehicleId = car, Date = D, TotalCost = v },
            o => db.ServiceRecords.Where(r => r.Id == ((ServiceRecord)o).Id).Select(r => r.TotalCost),
            Extra12);
        await Column("(12,2) negative Vehicle.PurchasePrice",
            v => new Vehicle { UserId = user, Nickname = "p", PurchasePrice = v },
            o => db.Vehicles.Where(r => r.Id == ((Vehicle)o).Id).Select(r => r.PurchasePrice),
            [-1.004m, -1.005m, -1.006m, -1.999m, -0.009m]);
        await Column("(9,2) ServiceItem.Quantity",
            v => new ServiceItem { ServiceRecordId = record.Id, Description = "x", Quantity = v, UnitCost = 1 },
            o => db.ServiceItems.Where(r => r.Id == ((ServiceItem)o).Id).Select(r => (decimal?)r.Quantity),
            [1.004m, 1.005m, 1.015m, 1.999m, 0.009m, 9999999.994m, 9999999.995m, 9999999.999m]);
        var measured = 0;
        await Column("(4,2) TireMeasurement.PressureBar",
            v => new TireMeasurement { TireId = tire.Id, MeasuredAt = D.AddDays(measured++), PressureBar = v },
            o => db.TireMeasurements.Where(r => r.Id == ((TireMeasurement)o).Id).Select(r => r.PressureBar),
            [1.004m, 1.005m, 1.015m, 1.999m, 99.994m, 99.995m, 99.999m]);
        await Column("(4,1) TireMeasurement.TreadDepthMm",
            v => new TireMeasurement { TireId = tire.Id, MeasuredAt = D.AddDays(measured++), TreadDepthMm = v },
            o => db.TireMeasurements.Where(r => r.Id == ((TireMeasurement)o).Id).Select(r => r.TreadDepthMm),
            [1.04m, 1.05m, 1.15m, 1.99m, 0.09m, 999.94m, 999.95m, 999.99m]);

        // Through the services that take any decimals: what the call returns, then what a later read gives.
        var vehicles = new VehicleService(db);
        foreach (var value in new[] { 1.005m, 1.999m })
        {
            var created = await vehicles.CreateAsync(user, new CreateVehicleRequest("Priced", null, null, null, null, null, null, null, value, null, 1000 + value));
            db.ChangeTracker.Clear();
            var read = await vehicles.GetAsync(user, created.Id);
            lines.Add($"POST /vehicles price and km {Dec(value)} => returned {Dec(created.PurchasePrice)} {Dec(created.CurrentOdometerKm)}, then read {Dec(read.PurchasePrice)} {Dec(read.CurrentOdometerKm)}");
        }
        return lines;
    }

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping, Converters = { new JsonStringEnumConverter(allowIntegerValues: false) }
    };

    private static string ToJson<T>(T value) => Regex.Replace(JsonSerializer.Serialize(value, Json), @"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "ID");

    public static async Task<List<string>> ReportsAsync(AppDbContext db)
    {
        var lines = new List<string>();
        var vehicles = new VehicleService(db);
        var tasks = new MaintenanceTaskService(db, vehicles);
        var reports = new ReportService(db);
        (string Name, decimal?[] Costs)[] cases =
        [
            ("none", []), ("all null", [null, null]), ("one", [10.5m]), ("mixed", [10.5m, 20.25m, null]), ("thirds", [0.01m, 0.01m, 0.02m]), ("midpoint", [2.00m, 2.01m]),
            ("below midpoint", [1.00m, 1.00m, 1.01m]), ("whole", [200m, 200m]), ("repeating", [100m, 200m, 400m]), ("zero", [0m]), ("limit", [9999999999.99m, 9999999999.99m, 9999999999.99m]),
            ("cents", [0.01m]),
        ];
        foreach (var (name, costs) in cases)
        {
            var (user, car) = await CarAsync(db, "Report car");
            var vehicle = db.Vehicles.Find(car)!;
            vehicle.PurchasePrice = 1000.5m;
            vehicle.CurrentOdometerKm = 12345.6m;
            db.OdometerReadings.Add(new OdometerReading { VehicleId = car, ValueKm = 10000.25m, ReadingDate = D.AddDays(-40) });
            var task = new MaintenanceTask { VehicleId = car, Name = "T", Category = TaskCategory.Oil, IntervalKm = 1000 };
            var task2 = new MaintenanceTask { VehicleId = car, Name = "U", Category = TaskCategory.Filters, IntervalKm = 1000 };
            db.AddRange(task, task2);
            foreach (var (cost, i) in costs.Select((c, i) => (c, i)))
            {
                var record = new ServiceRecord { VehicleId = car, Date = D.AddDays(-i), OdometerKm = 11000.5m, TotalCost = cost };
                record.Tasks.Add(new ServiceRecordTask { MaintenanceTaskId = task.Id, PreviousLastDoneDate = D });
                record.Tasks.Add(new ServiceRecordTask { MaintenanceTaskId = task2.Id, PreviousLastDoneDate = D });
                db.ServiceRecords.Add(record);
            }
            await db.SaveChangesAsync();
            db.ChangeTracker.Clear();

            var page = await tasks.SearchRecordsAsync(user, null, null, null, null, null, 0, 1);
            lines.Add($"{name} search => {ToJson(new { page.TotalCount, page.TotalCost, page.AverageCost, First = page.Items.FirstOrDefault()?.TotalCost, Km = page.Items.FirstOrDefault()?.OdometerKm })}");
            var report = await reports.CostsAsync(user, D.Year.ToString(CultureInfo.InvariantCulture), null);
            lines.Add($"{name} report => {ToJson(report)}");
            db.ChangeTracker.Clear();
            var month = DateOnly.FromDateTime(DateTime.UtcNow);
            db.ServiceRecords.AddRange(costs.Select(c => new ServiceRecord { VehicleId = car, Date = month, OdometerKm = 11000.5m, TotalCost = c }));
            await db.SaveChangesAsync();
            var dashboard = await tasks.DashboardAsync(user, month);
            lines.Add($"{name} dashboard => {ToJson(new { dashboard.MonthTotalCost, dashboard.MonthServiceCount })}");
            db.ChangeTracker.Clear();
        }
        return lines;
    }
}
