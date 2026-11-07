using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using OnlyCars.Infrastructure.Persistence;

namespace OnlyCars.DbCopy;

/// <summary>An expected stop. Its message goes to the output, so it may hold table and column names and ids, never a value.</summary>
public sealed class CopyStop(string message) : Exception(message);

public sealed record CopyColumn(string Table, string Name, Type Clr, int? Scale, bool TrimSpaces);

public sealed record CopyTable(string Name, IReadOnlyList<CopyColumn> Columns, int IdIndex);

/// <summary>What to copy, from the EF model: tables in foreign-key order, and each column's canonical form for the row hash.</summary>
public static class CopyPlan
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public static AppDbContext NewContext() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseNpgsql(AppDbContext.NpgsqlOptions).Options);

    public static IReadOnlyList<CopyTable> Tables()
    {
        using var db = NewContext();
        var left = db.GetService<IDesignTimeModel>().Model.GetEntityTypes().OrderBy(t => t.GetTableName(), StringComparer.Ordinal).ToList();
        var tables = new List<CopyTable>();
        while (left.Count > 0)
        {
            // shortcut: a foreign-key cycle stops the tool instead of a second pass; the model has none (DbCopyTests pins that), add the pass if one appears.
            var next = left.FirstOrDefault(t => t.GetForeignKeys().All(k => !left.Contains(k.PrincipalEntityType)))
                ?? throw new CopyStop("The model has a foreign-key cycle, which this tool doesn't handle.");
            left.Remove(next);
            tables.Add(ToTable(next));
        }

        return tables;
    }

    private static CopyTable ToTable(IEntityType type)
    {
        var name = type.GetTableName()!;
        var columns = type.GetProperties().Select(p => ToColumn(name, p)).ToList();
        var id = type.FindPrimaryKey()!.Properties.Single().GetColumnName();
        return new CopyTable(name, columns, columns.FindIndex(c => c.Name == id));
    }

    private static CopyColumn ToColumn(string table, IProperty property)
    {
        var mapping = property.GetRelationalTypeMapping();
        var clr = mapping.Converter?.ProviderClrType ?? mapping.ClrType;
        var scale = Regex.Match(property.GetColumnType(), @",\s*(\d+)\)");
        return new CopyColumn(table, property.GetColumnName(), Nullable.GetUnderlyingType(clr) ?? clr,
            scale.Success ? int.Parse(scale.Groups[1].Value, CultureInfo.InvariantCulture) : null,
            property.GetCollation() == AppDbContext.CaseInsensitiveCollation);
    }

    /// <summary>The only changes the copy makes: UTC at microseconds, which is all Postgres holds, and Email and Vin without trailing U+0020.</summary>
    public static object ToTargetValue(CopyColumn column, object value) => value switch
    {
        string s when column.TrimSpaces => s.TrimEnd(' '),
        DateTimeOffset d => new DateTimeOffset(ToMicroseconds(d), TimeSpan.Zero),
        DateTime d when column.Clr == typeof(DateOnly) => DateOnly.FromDateTime(d),
        _ => value,
    };

    private static long ToMicroseconds(DateTimeOffset d) => d.UtcTicks - d.UtcTicks % 10;

    /// <summary>A value as text for the hash, null for a database null. Only the source side has its trailing spaces removed, so a target that kept them fails.</summary>
    public static string? Canonical(CopyColumn column, object? value, bool isSource) => value switch
    {
        null or DBNull => null,
        string s => isSource && column.TrimSpaces ? s.TrimEnd(' ') : s,
        Guid g => g.ToString("D"),
        DateTimeOffset d => ToMicroseconds(d).ToString(CultureInfo.InvariantCulture),
        DateTime d when column.Clr == typeof(DateOnly) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTime { Kind: DateTimeKind.Utc } d => ToMicroseconds(new DateTimeOffset(d)).ToString(CultureInfo.InvariantCulture),
        DateOnly d => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        decimal m => CanonicalDecimal(column, m),
        bool b => b ? "1" : "0",
        int or long => Convert.ToString(value, CultureInfo.InvariantCulture),
        _ => throw new CopyStop($"{column.Table}.{column.Name}: no canonical form for a {value.GetType().Name}."),
    };

    // More decimals than the column holds must not hash equal to their rounded form, so this never rounds.
    private static string CanonicalDecimal(CopyColumn column, decimal value)
    {
        var scale = column.Scale ?? throw new CopyStop($"{column.Table}.{column.Name}: the model gives no decimal scale.");
        return decimal.Round(value, scale) == value
            ? value.ToString("F" + scale, CultureInfo.InvariantCulture)
            : value.ToString("G29", CultureInfo.InvariantCulture);
    }

    public static byte[] RowHash(CopyTable table, object?[] row, bool isSource)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        for (var i = 0; i < row.Length; i++)
        {
            var text = Canonical(table.Columns[i], row[i], isSource);
            var bytes = text is null ? [] : StrictUtf8.GetBytes(text);
            hash.AppendData(BitConverter.GetBytes(text is null ? -1 : bytes.Length)); // length first, so null, "" and shifted text never hash alike
            hash.AppendData(bytes);
        }

        return hash.GetHashAndReset();
    }

    /// <summary>The row's size as UTF-8 text, a fair guide to what it takes on the target, whose free plan has a limit.</summary>
    public static long RowBytes(CopyTable table, object?[] row) =>
        row.Select((value, i) => Canonical(table.Columns[i], value, isSource: true))
            .Sum(text => text is null || IsInvalidUtf16(text) ? 0L : StrictUtf8.GetByteCount(text));

    /// <summary>Text Postgres can't store as UTF-8: an unpaired surrogate, which SQL Server can hold.</summary>
    public static bool IsInvalidUtf16(string text)
    {
        try
        {
            StrictUtf8.GetByteCount(text);
            return false;
        }
        catch (EncoderFallbackException)
        {
            return true;
        }
    }

    /// <summary>
    /// Two values with the same key collide under und-u-ks-level2. .NET's ICU, with the same strength, because a dry run at gate 3 comes before the target has the collation.
    /// shortcut: .NET's ICU may differ from Postgres's on a rare character (DbCopyTests pins the likely ones); the target's unique index still refuses it and the copy rolls back.
    /// </summary>
    public static string CollisionKey(string value) => Convert.ToHexString(CultureInfo.InvariantCulture.CompareInfo
        .GetSortKey(value.TrimEnd(' '), CompareOptions.IgnoreCase | CompareOptions.IgnoreKanaType | CompareOptions.IgnoreWidth).KeyData);
}
