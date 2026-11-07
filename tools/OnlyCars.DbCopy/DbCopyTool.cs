using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.DbCopy;

public enum CopyMode { DryRun, Write, Verify, ApplyBaseline }

/// <summary>
/// DB-1c: copies every row from SQL Server to Postgres and proves the copy identical. See docs/contracts/DB-1c.md.
/// The output holds names, counts and ids only. An exception's message can quote a connection string or a row, so none is ever printed.
/// </summary>
public static class DbCopyTool
{
    public const string UserSecretsId = "c89723e4-171d-41cf-a030-c2738362f890"; // src/OnlyCars.Api's
    public const string PinnedMigration = "20261106063910_TemplateHebrewNames";
    private const int BatchRows = 500;
    private static readonly TimeSpan WakeStep = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan WakeLimit = TimeSpan.FromMinutes(2);

    // Which values must stay unique under the new collation, and within what.
    private static readonly (string Table, string Column, string? Scope)[] UniqueRules = [("Users", "Email", null), ("Vehicles", "Vin", "UserId")];

    public static Task<int> Main(string[] args) =>
        CliAsync(args, Console.Out, () => new ConfigurationBuilder().AddUserSecrets(UserSecretsId).Build());

    /// <summary>Without keys it reads the user-secrets; with them, only environment variables, so a rehearsal never opens the secrets file.</summary>
    public static async Task<int> CliAsync(string[] args, TextWriter output, Func<IConfiguration> secrets)
    {
        try
        {
            var mode = CopyMode.DryRun;
            string? sourceKey = null, targetKey = null;
            for (var i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--write" when mode == CopyMode.DryRun: mode = CopyMode.Write; break;
                    case "--verify" when mode == CopyMode.DryRun: mode = CopyMode.Verify; break;
                    case "--apply-baseline" when mode == CopyMode.DryRun: mode = CopyMode.ApplyBaseline; break;
                    case "--source-key" when i + 1 < args.Length: sourceKey = args[++i]; break;
                    case "--target-key" when i + 1 < args.Length: targetKey = args[++i]; break;
                    default: throw new CopyStop("Usage: [--write | --verify | --apply-baseline] [--source-key <name> --target-key <name>]");
                }
            }

            if ((sourceKey is null) != (targetKey is null))
            {
                throw new CopyStop("Give both --source-key and --target-key, or neither.");
            }

            Func<string, string?> read;
            if (sourceKey is null)
            {
                var config = secrets();
                read = name => config[$"ConnectionStrings:{name}"];
            }
            else
            {
                read = name => Environment.GetEnvironmentVariable($"ConnectionStrings__{name}");
            }

            return await RunAsync(mode, Required(read, sourceKey ?? "AzureSource"), Required(read, targetKey ?? "SupabaseApp"), output, Task.Delay);
        }
        catch (Exception e)
        {
            await output.WriteLineAsync($"db-copy stopped: {Safe(e)}");
            return 1;
        }
    }

    private static string Required(Func<string, string?> read, string name) =>
        read(name) is { Length: > 0 } value ? value : throw new CopyStop($"Connection string {name} is not set.");

    /// <summary>The run itself. 0 when it did its job and found nothing that stops a --write; 1 otherwise, with the reason printed.</summary>
    public static async Task<int> RunAsync(CopyMode mode, string sourceConnection, string targetConnection, TextWriter output, Func<TimeSpan, Task> delay)
    {
        try
        {
            var timer = Stopwatch.StartNew();
            var exit = await RunCheckedAsync(mode, sourceConnection, targetConnection, output, delay);
            await output.WriteLineAsync($"Time: {timer.Elapsed.TotalSeconds:F1} s");
            return exit;
        }
        catch (Exception e)
        {
            await output.WriteLineAsync($"db-copy stopped: {Safe(e)}");
            await output.WriteLineAsync(mode == CopyMode.Write ? "Nothing was committed; the target is as it was." : mode == CopyMode.ApplyBaseline ? "The migration runs in one transaction, so the target is as it was." : "Nothing was written.");
            return 1;
        }
    }

    private static async Task<int> RunCheckedAsync(CopyMode mode, string sourceConnection, string targetConnection, TextWriter output, Func<TimeSpan, Task> delay)
    {
        var sourceNames = new SqlConnectionStringBuilder(sourceConnection);
        var targetNames = new NpgsqlConnectionStringBuilder(targetConnection);
        await output.WriteLineAsync($"Source: database {sourceNames.InitialCatalog} on {sourceNames.DataSource}");
        await output.WriteLineAsync($"Target: database {targetNames.Database} on {targetNames.Host}");
        await output.WriteLineAsync($"Mode: {(mode == CopyMode.DryRun ? "dry run, nothing is written" : mode.ToString().ToLowerInvariant())}");

        if (mode == CopyMode.ApplyBaseline)
        {
            // Gate 5, so the string stays in the user-secrets: dotnet ef would need it on a command line or in the environment.
            await using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(targetConnection, AppDbContext.NpgsqlOptions).Options);
            await db.Database.MigrateAsync();
            await output.WriteLineAsync($"Target migrated to {ExpectedTargetMigration()}.");
            return 0;
        }

        var tables = CopyPlan.Tables();
        var source = new SourceReader(sourceConnection, delay);
        await CheckSourceAsync(source, tables, output);

        await using var target = new NpgsqlConnection(targetConnection);
        await target.OpenAsync();
        await using var transaction = await target.BeginTransactionAsync(); // disposed without a commit, it rolls back
        var state = await ReadTargetStateAsync(target, transaction, tables, readOnly: mode != CopyMode.Write);

        if (mode == CopyMode.Verify)
        {
            return state.Migration != ExpectedTargetMigration()
                ? throw new CopyStop("The target has no baseline migration, so there is nothing to verify.")
                : await VerifyAsync(source, target, transaction, tables, output) ? 0 : 1;
        }

        var rows = new Dictionary<string, List<object?[]>>();
        foreach (var table in tables)
        {
            rows[table.Name] = await source.ReadAsync(table);
        }

        var stops = await ReportSourceAsync(tables, rows, output);
        stops.AddRange(await ReportTargetAsync(state, mode, output));

        if (stops.Count > 0)
        {
            await output.WriteLineAsync($"Stopped before writing anything: {string.Join("; ", stops)}.");
            return 1;
        }

        if (mode == CopyMode.DryRun)
        {
            await output.WriteLineAsync("Dry run done, nothing written. Nothing in this report would stop --write.");
            return 0;
        }

        await InsertAsync(target, transaction, tables, rows);
        if (!await VerifyAsync(source, target, transaction, tables, output))
        {
            await transaction.RollbackAsync();
            await output.WriteLineAsync("Rolled back; the target is as it was.");
            return 1;
        }

        await transaction.CommitAsync();
        await output.WriteLineAsync($"Committed {rows.Values.Sum(r => r.Count)} rows in {tables.Count} tables.");
        return 0;
    }

    private static string ExpectedTargetMigration()
    {
        using var db = CopyPlan.NewContext();
        return db.Database.GetMigrations().Last();
    }

    private static async Task CheckSourceAsync(SourceReader source, IReadOnlyList<CopyTable> tables, TextWriter output)
    {
        var migration = await source.QueryAsync("SELECT TOP 1 [MigrationId] FROM [dbo].[__EFMigrationsHistory] ORDER BY [MigrationId] DESC");
        var last = migration.Count == 0 ? null : (string)migration[0][0]!;
        if (last != PinnedMigration)
        {
            throw new CopyStop($"The source's last migration is {last ?? "missing"}, not {PinnedMigration}.");
        }

        await output.WriteLineAsync($"Source migration: {last}");

        var columns = await source.QueryAsync("SELECT [TABLE_NAME], [COLUMN_NAME], [COLLATION_NAME] FROM [INFORMATION_SCHEMA].[COLUMNS] WHERE [TABLE_SCHEMA] = 'dbo'");
        var present = columns.Select(c => $"{c[0]}.{c[1]}").ToHashSet(StringComparer.Ordinal);
        var missing = tables.SelectMany(t => t.Columns).Select(c => $"{c.Table}.{c.Name}").Where(c => !present.Contains(c)).ToList();
        if (missing.Count > 0)
        {
            throw new CopyStop($"Missing from the source: {string.Join(", ", missing)}.");
        }

        var collation = (string)(await source.QueryAsync("SELECT CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation'))"))[0][0]!;
        var different = columns.Where(c => c[2] is string name && name != collation).Select(c => $"{c[0]}.{c[1]} {c[2]}").ToList();
        await output.WriteLineAsync($"Source collation: {collation}; string columns with a different one: {(different.Count == 0 ? "none" : string.Join(", ", different))}");

        foreach (var row in await source.QueryAsync("SELECT [name] FROM [sys].[tables] WHERE [name] LIKE 'Legacy[_]%' ORDER BY [name]"))
        {
            var name = (string)row[0]!;
            var count = (await source.QueryAsync($"SELECT COUNT_BIG(*) FROM [dbo].[{name.Replace("]", "]]")}]"))[0][0];
            await output.WriteLineAsync($"Not copied: {name}, {count} rows");
        }
    }

    private static async Task<List<string>> ReportSourceAsync(IReadOnlyList<CopyTable> tables, Dictionary<string, List<object?[]>> rows, TextWriter output)
    {
        var nuls = new List<string>();
        var invalid = new List<string>();
        var trimmed = new Dictionary<string, List<string>>();

        foreach (var table in tables)
        {
            var bytes = 0L;
            foreach (var row in rows[table.Name])
            {
                bytes += CopyPlan.RowBytes(table, row);
                for (var i = 0; i < row.Length; i++)
                {
                    if (row[i] is not string text)
                    {
                        continue;
                    }

                    var column = $"{table.Name}.{table.Columns[i].Name}";
                    var id = row[table.IdIndex]!.ToString()!;
                    if (text.Contains('\0'))
                    {
                        nuls.Add($"{column} {id}");
                    }

                    if (CopyPlan.IsInvalidUtf16(text))
                    {
                        invalid.Add($"{column} {id}");
                    }

                    if (table.Columns[i].TrimSpaces && text.EndsWith(' '))
                    {
                        trimmed.TryAdd(column, []);
                        trimmed[column].Add(id);
                    }
                }
            }

            await output.WriteLineAsync($"{table.Name}: {rows[table.Name].Count} rows, {bytes} bytes");
        }

        await output.WriteLineAsync($"Values with U+0000: {nuls.Count}{List(nuls)}");
        await output.WriteLineAsync($"Values with an unpaired surrogate: {invalid.Count}{List(invalid)}");
        var stops = new List<string>();
        if (nuls.Count > 0)
        {
            stops.Add($"{nuls.Count} values with U+0000");
        }

        if (invalid.Count > 0)
        {
            stops.Add($"{invalid.Count} values with an unpaired surrogate");
        }

        foreach (var (tableName, columnName, scope) in UniqueRules)
        {
            var column = $"{tableName}.{columnName}";
            var ids = trimmed.GetValueOrDefault(column, []);
            await output.WriteLineAsync($"Trailing spaces, removed by --write: {column}: {ids.Count}{List(ids)}");

            var table = tables.Single(t => t.Name == tableName);
            var valueAt = IndexOf(table, columnName);
            var scopeAt = scope is null ? -1 : IndexOf(table, scope);
            var collisions = rows[tableName].Where(r => r[valueAt] is string)
                .GroupBy(r => (Scope: scopeAt < 0 ? null : r[scopeAt], Key: CopyPlan.CollisionKey((string)r[valueAt]!)))
                .Where(g => g.Count() > 1)
                .Select(g => string.Join(" = ", g.Select(r => r[table.IdIndex])))
                .ToList();
            await output.WriteLineAsync($"Collisions after trimming: {column}: {collisions.Count}{List(collisions)}");
            if (collisions.Count > 0)
            {
                stops.Add($"{collisions.Count} collisions in {column}");
            }
        }

        return stops;
    }

    private static string List(IEnumerable<string> items)
    {
        var text = string.Join(", ", items);
        return text.Length == 0 ? "" : $" ({text})";
    }

    private static int IndexOf(CopyTable table, string column) => table.Columns.ToList().FindIndex(c => c.Name == column);

    private sealed record TargetState(string? Migration, Dictionary<string, long> Counts);

    private static async Task<TargetState> ReadTargetStateAsync(NpgsqlConnection target, NpgsqlTransaction transaction, IReadOnlyList<CopyTable> tables, bool readOnly)
    {
        if (readOnly)
        {
            await ExecuteAsync(target, transaction, "SET TRANSACTION READ ONLY");
        }

        var history = $"\"{AppDbContext.Schema}\".\"__EFMigrationsHistory\"";
        await using var exists = new NpgsqlCommand($"SELECT to_regclass('{history}') IS NOT NULL", target, transaction);
        if (!(bool)(await exists.ExecuteScalarAsync())!)
        {
            return new TargetState(null, []);
        }

        await using var last = new NpgsqlCommand($"SELECT \"MigrationId\" FROM {history} ORDER BY \"MigrationId\" DESC LIMIT 1", target, transaction);
        var migration = (string?)await last.ExecuteScalarAsync();
        var counts = new Dictionary<string, long>();
        if (migration == ExpectedTargetMigration())
        {
            foreach (var table in tables)
            {
                await using var count = new NpgsqlCommand($"SELECT COUNT(*) FROM {Quoted(table)}", target, transaction);
                counts[table.Name] = (long)(await count.ExecuteScalarAsync())!;
            }
        }

        return new TargetState(migration, counts);
    }

    private static async Task<List<string>> ReportTargetAsync(TargetState state, CopyMode mode, TextWriter output)
    {
        var stops = new List<string>();
        if (state.Migration != ExpectedTargetMigration())
        {
            await output.WriteLineAsync($"Target: not at the baseline; --write needs {ExpectedTargetMigration()} applied first.");
            if (mode == CopyMode.Write)
            {
                stops.Add("the target is not at the baseline");
            }

            return stops;
        }

        var filled = state.Counts.Where(c => c.Key != "TaskTemplates" && c.Value > 0).Select(c => $"{c.Key} {c.Value}").ToList();
        await output.WriteLineAsync(filled.Count == 0
            ? $"Target: empty, apart from {state.Counts["TaskTemplates"]} TaskTemplates, which --write replaces."
            : $"Target: not empty: {string.Join(", ", filled)}");
        if (filled.Count > 0)
        {
            stops.Add("the target is not empty");
        }

        return stops;
    }

    private static async Task InsertAsync(NpgsqlConnection target, NpgsqlTransaction transaction, IReadOnlyList<CopyTable> tables, Dictionary<string, List<object?[]>> rows)
    {
        await ExecuteAsync(target, transaction, $"DELETE FROM {Quoted(tables.Single(t => t.Name == "TaskTemplates"))}");
        foreach (var table in tables)
        {
            var columns = string.Join(", ", table.Columns.Select(c => $"\"{c.Name}\""));
            foreach (var batch in rows[table.Name].Chunk(BatchRows))
            {
                await using var insert = new NpgsqlCommand { Connection = target, Transaction = transaction };
                var values = new List<string>(batch.Length);
                foreach (var row in batch)
                {
                    var marks = new string[row.Length];
                    for (var i = 0; i < row.Length; i++)
                    {
                        insert.Parameters.Add(new NpgsqlParameter { Value = row[i] is null ? DBNull.Value : CopyPlan.ToTargetValue(table.Columns[i], row[i]!) });
                        marks[i] = $"${insert.Parameters.Count}";
                    }

                    values.Add($"({string.Join(", ", marks)})");
                }

                insert.CommandText = $"INSERT INTO {Quoted(table)} ({columns}) VALUES {string.Join(", ", values)}";
                await insert.ExecuteNonQueryAsync();
            }
        }
    }

    private static async Task<bool> VerifyAsync(SourceReader source, NpgsqlConnection target, NpgsqlTransaction transaction, IReadOnlyList<CopyTable> tables, TextWriter output)
    {
        var differences = new List<string>();
        foreach (var table in tables)
        {
            var sourceHashes = (await source.ReadAsync(table)).ToDictionary(r => (Guid)r[table.IdIndex]!, r => CopyPlan.RowHash(table, r, isSource: true));
            var targetHashes = (await ReadTargetAsync(target, transaction, table)).ToDictionary(r => (Guid)r[table.IdIndex]!, r => CopyPlan.RowHash(table, r, isSource: false));
            var before = differences.Count;
            foreach (var (id, hash) in sourceHashes)
            {
                if (!targetHashes.TryGetValue(id, out var other))
                {
                    differences.Add($"{table.Name} {id}: missing from the target");
                }
                else if (!hash.SequenceEqual(other))
                {
                    differences.Add($"{table.Name} {id}: different");
                }
            }

            differences.AddRange(targetHashes.Keys.Where(id => !sourceHashes.ContainsKey(id)).Select(id => $"{table.Name} {id}: not in the source"));
            await output.WriteLineAsync($"Verify {table.Name}: source {sourceHashes.Count}, target {targetHashes.Count}, differences {differences.Count - before}");
        }

        foreach (var difference in differences)
        {
            await output.WriteLineAsync($"Difference: {difference}");
        }

        await output.WriteLineAsync(differences.Count == 0 ? "Verify passed: same rows, same hashes." : $"Verify FAILED: {differences.Count} differences.");
        return differences.Count == 0;
    }

    private static async Task<List<object?[]>> ReadTargetAsync(NpgsqlConnection target, NpgsqlTransaction transaction, CopyTable table)
    {
        await using var select = new NpgsqlCommand($"SELECT {string.Join(", ", table.Columns.Select(c => $"\"{c.Name}\""))} FROM {Quoted(table)}", target, transaction);
        await using var reader = await select.ExecuteReaderAsync();
        var rows = new List<object?[]>();
        while (await reader.ReadAsync())
        {
            var row = new object?[reader.FieldCount];
            reader.GetValues(row!);
            rows.Add(row);
        }

        return rows;
    }

    private static async Task ExecuteAsync(NpgsqlConnection target, NpgsqlTransaction transaction, string sql)
    {
        await using var command = new NpgsqlCommand(sql, target, transaction);
        await command.ExecuteNonQueryAsync();
    }

    private static string Quoted(CopyTable table) => $"\"{AppDbContext.Schema}\".\"{table.Name}\"";

    /// <summary>Only what can't hold a value: an expected stop's own text, or an exception's type and code.</summary>
    public static string Safe(Exception e) => e switch
    {
        CopyStop => e.Message,
        SqlException sql => $"SqlException, number {sql.Number}",
        PostgresException postgres => $"PostgresException, SQLSTATE {postgres.SqlState}{(postgres.ConstraintName is { } name ? $", constraint {name}" : "")}",
        _ => e.GetType().Name,
    };

    /// <summary>Azure's free database answers 40613 for about a minute while it wakes.</summary>
    public static async Task<T> RetryWhileWakingAsync<T>(Func<Task<T>> read, Func<Exception, bool> isWaking, Func<TimeSpan, Task> delay)
    {
        var waited = TimeSpan.Zero;
        while (true)
        {
            try
            {
                return await read();
            }
            catch (Exception e) when (isWaking(e) && waited < WakeLimit)
            {
                await delay(WakeStep);
                waited += WakeStep;
            }
        }
    }

    /// <summary>Every statement the source receives goes through here, and each is a SELECT (DbCopyTests captures them on the server).</summary>
    private sealed class SourceReader(string connection, Func<TimeSpan, Task> delay)
    {
        // Text as raw UTF-16: SqlClient turns an unpaired surrogate into U+FFFD when it decodes, and the verify would then pass over a changed value.
        public async Task<List<object?[]>> ReadAsync(CopyTable table)
        {
            var columns = table.Columns.Select(c => c.Clr == typeof(string) ? $"CAST([{c.Name}] AS varbinary(max))" : $"[{c.Name}]");
            var rows = await QueryAsync($"SELECT {string.Join(", ", columns)} FROM [dbo].[{table.Name}]");
            foreach (var row in rows)
            {
                for (var i = 0; i < row.Length; i++)
                {
                    if (row[i] is byte[] utf16)
                    {
                        row[i] = new string(MemoryMarshal.Cast<byte, char>(utf16));
                    }
                }
            }

            return rows;
        }

        public Task<List<object?[]>> QueryAsync(string select) => RetryWhileWakingAsync(async () =>
        {
            await using var source = new SqlConnection(connection);
            await source.OpenAsync();
            await using var command = new SqlCommand(select, source);
            await using var reader = await command.ExecuteReaderAsync();
            var rows = new List<object?[]>();
            while (await reader.ReadAsync())
            {
                var row = new object?[reader.FieldCount];
                reader.GetValues(row!);
                rows.Add(row.Select(v => v is DBNull ? null : v).ToArray());
            }

            return rows;
        }, e => e is SqlException { Number: 40613 }, delay);
    }
}
