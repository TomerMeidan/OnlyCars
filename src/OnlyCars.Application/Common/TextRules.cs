using System.Text;
using System.Text.RegularExpressions;

namespace OnlyCars.Application.Common;

/// <summary>
/// DB-1b: what SQL Server's collation did to text and Postgres does not. The recorded results are in BehaviourParityTests and docs/contracts/DB-1b.md.
/// </summary>
public static class TextRules
{
    // No weight in the old collation, so a search looked through them. U+200B, U+200C and U+00AD were recorded as not ignored.
    private const string IgnoredMarks = "\u034F\u061C\u200D\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF";

    /// <summary>
    /// A pattern (for RegexOptions.IgnoreCase) that finds the word as the old LIKE did: a final Hebrew letter equals its plain form, and the marks above are looked through.
    /// A pattern and not LIKE, because Postgres's LIKE compares bytes and can't use a non-deterministic collation. It runs the same on Postgres and in .NET (the InMemory tests).
    /// </summary>
    public static string SearchPattern(string word)
    {
        var pattern = new StringBuilder();
        foreach (var letter in Regex.Replace(word, $"[{IgnoredMarks}]", "").EnumerateRunes())
        {
            pattern.Append(letter.ToString() switch
            {
                "ך" or "כ" => "[ךכ]",
                "ם" or "מ" => "[םמ]",
                "ן" or "נ" => "[ןנ]",
                "ף" or "פ" => "[ףפ]",
                "ץ" or "צ" => "[ץצ]",
                var c and ("\\" or "^" or "$" or "." or "|" or "?" or "*" or "+" or "(" or ")" or "[" or "]" or "{" or "}") => "\\" + c,
                var c => c,
            }).Append($"[{IgnoredMarks}]*");
        }
        return pattern.ToString();
    }
}
