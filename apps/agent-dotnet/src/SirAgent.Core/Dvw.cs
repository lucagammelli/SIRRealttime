using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace SirAgent.Core;

/// <summary>Header and scout lines of a DVW file, as sent to the server.</summary>
public sealed record DvwContent(string Header, IReadOnlyList<string> Lines);

/// <summary>Result of a read: never sent (`Incomplete`), or content with the final newline flag.</summary>
public abstract record DvwRead
{
    private DvwRead() { }

    /// <summary>Empty file or no `[3SCOUT]` section: wait for the next write.</summary>
    public sealed record Incomplete(string Reason) : DvwRead;

    /// <summary>`EndsWithNewline` false: DataVolley may still be writing the file.</summary>
    public sealed record Content(DvwContent Value, bool EndsWithNewline) : DvwRead;
}

/// <summary>
/// Pure functions on DVW files, ported one by one from the Node agent (`apps/agent/src/dvw.ts`) and from the parts of
/// `@sir/dvw-parser` and `@sir/shared` they use: same split, same matchKey, same suspicion. Checked against the
/// reference produced by the Node code (`riferimento/genera-riferimento.ts`).
/// </summary>
public static class Dvw
{
    public const string ScoutSectionMarker = "[3SCOUT]";

    /// <summary>`splitLines` of the parser: one leading U+FEFF dropped, split on CRLF, LF or CR.</summary>
    public static List<string> SplitLines(string text)
    {
        if (text.StartsWith('\uFEFF')) text = text[1..];
        var lines = new List<string>();
        var start = 0;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c != '\n' && c != '\r') continue;
            lines.Add(text[start..i]);
            if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
            start = i + 1;
        }
        lines.Add(text[start..]);
        return lines;
    }

    /// <summary>Name of a `[3NAME]` line (after `trim()`), or null.</summary>
    private static string? SectionName(string line)
    {
        var t = JsText.Trim(line);
        if (t.Length < 4 || !t.StartsWith("[3", StringComparison.Ordinal) || t[^1] != ']') return null;
        var name = t[2..^1];
        if (name.Length == 0) return null;
        foreach (var c in name)
        {
            if (!(c is >= 'A' and <= 'Z' or >= '0' and <= '9' or '-')) return null;
        }
        return name;
    }

    /// <summary>`splitSections` of the parser: section name → lines (without the `[3NAME]` line).</summary>
    public static Dictionary<string, List<string>> SplitSections(string text)
    {
        var sections = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        List<string>? current = null;
        foreach (var line in SplitLines(text))
        {
            var name = SectionName(line);
            if (name is not null)
            {
                if (!sections.TryGetValue(name, out current))
                {
                    current = [];
                    sections[name] = current;
                }
            }
            else
            {
                current?.Add(line);
            }
        }
        return sections;
    }

    private static List<string> NonEmpty(IEnumerable<string>? lines) =>
        lines is null ? [] : lines.Where(l => JsText.Trim(l).Length > 0).ToList();

    /// <summary>`extractScoutLines`: non-empty lines of the `[3SCOUT]` section.</summary>
    public static List<string> ExtractScoutLines(string text) =>
        NonEmpty(SplitSections(text).GetValueOrDefault("SCOUT"));

    /// <summary>
    /// Index of the first match of `/^[ \t]*\[3SCOUT\][ \t]*$/m` (JavaScript: `^` and `$` also at U+2028 and U+2029),
    /// or -1.
    /// </summary>
    public static int FindScoutMarker(string text)
    {
        for (var start = 0; start <= text.Length; start++)
        {
            if (start > 0 && !JsText.IsLineTerminator(text[start - 1])) continue;
            var i = start;
            while (i < text.Length && text[i] is ' ' or '\t') i++;
            if (string.CompareOrdinal(text, i, ScoutSectionMarker, 0, ScoutSectionMarker.Length) != 0) continue;
            i += ScoutSectionMarker.Length;
            while (i < text.Length && text[i] is ' ' or '\t') i++;
            if (i == text.Length || JsText.IsLineTerminator(text[i])) return start;
        }
        return -1;
    }

    /// <summary>`splitDvwText` of `@sir/shared`: header before the `[3SCOUT]` line and the scout lines.</summary>
    public static DvwContent SplitDvwText(string text)
    {
        var marker = FindScoutMarker(text);
        var header = marker >= 0 ? text[..marker] : text;
        return new DvwContent(header, ExtractScoutLines(text));
    }

    /// <summary>`readDvw`: decodes a read of the file into header and scout lines.</summary>
    public static DvwRead Read(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length == 0) return new DvwRead.Incomplete("file vuoto");
        var text = DvwDecoder.Decode(bytes);
        if (FindScoutMarker(text) < 0) return new DvwRead.Incomplete($"sezione {ScoutSectionMarker} assente");
        return new DvwRead.Content(SplitDvwText(text), text.EndsWith('\n'));
    }

    /// <summary>
    /// `suspicion`: why a read could be a half-written file compared with the content last queued for the same match,
    /// or null if it can be sent.
    /// </summary>
    public static string? Suspicion(DvwRead.Content read, DvwContent? baseContent)
    {
        if (!read.EndsWithNewline) return "file senza a capo finale";
        if (baseContent is not null && read.Value.Lines.Count < baseContent.Lines.Count)
        {
            return $"righe scout diminuite da {baseContent.Lines.Count} a {read.Value.Lines.Count}";
        }
        return null;
    }

    /// <summary>sha256 hex of raw bytes (to recognise the same read twice).</summary>
    public static string BytesHash(ReadOnlySpan<byte> bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static string Sha256Hex(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static string ShortHash(string value) => Sha256Hex(value)[..10];

    private static string? Clean(string? value)
    {
        if (value is null) return null;
        var t = JsText.Trim(value);
        return t.Length == 0 ? null : t;
    }

    private static string FieldOf(string[] fields, int index) => index < fields.Length ? fields[index] : "";

    /// <summary>
    /// `deriveMatchKey`: key of the match from date and time of [3MATCH] and the team codes of [3TEAMS] plus a short
    /// hash; without date and time, from the file name. Lowercase, always valid as matchKey.
    /// </summary>
    public static string DeriveMatchKey(string header, string filePath)
    {
        var sections = SplitSections(header);
        var matchLine = NonEmpty(sections.GetValueOrDefault("MATCH")).FirstOrDefault() ?? "";
        var matchFields = matchLine.Split(';');
        var teams = NonEmpty(sections.GetValueOrDefault("TEAMS")).Take(2).Select(l => Clean(l.Split(';')[0])).ToList();
        string?[] raw =
        [
            Clean(FieldOf(matchFields, 0)),
            Clean(FieldOf(matchFields, 1)),
            teams.Count > 0 ? teams[0] : null,
            teams.Count > 1 ? teams[1] : null,
        ];
        var fields = raw.Select(f => JsLower.ToLower(JsText.CollapseSpaces(JsText.Trim(f ?? "")))).ToArray();
        var (date, time, home, away) = (fields[0], fields[1], fields[2], fields[3]);
        if (date.Length > 0 || time.Length > 0)
        {
            var readable = new[] { Slug(date, 12), Slug(time, 10), Slug(home, 20), Slug(away, 20) }.Where(s => s.Length > 0);
            return $"{string.Join('_', readable)}_{ShortHash(string.Join('\0', fields))}";
        }
        var name = Win32BaseName(filePath);
        if (name.EndsWith(".dvw", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        var slug = Slug(name, 60);
        return $"file_{(slug.Length > 0 ? slug : "dvw")}_{ShortHash(JsLower.ToLower(name))}";
    }

    /// <summary>`slug` of the Node agent: NFKD without combining marks, lowercase, `[^a-z0-9]+` → `-`.</summary>
    public static string Slug(string? value, int max)
    {
        var normalized = SafeNormalizeKd(value ?? "");
        var withoutMarks = new StringBuilder(normalized.Length);
        foreach (var c in normalized)
        {
            if (c is < '\u0300' or > '\u036F') withoutMarks.Append(c);
        }
        var lower = JsLower.ToLower(withoutMarks.ToString());
        var sb = new StringBuilder(lower.Length);
        var dash = false;
        foreach (var c in lower)
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                sb.Append(c);
                dash = false;
            }
            else if (!dash)
            {
                sb.Append('-');
                dash = true;
            }
        }
        var slug = sb.ToString().Trim('-');
        return slug.Length > max ? slug[..max] : slug;
    }

    /// <summary>NFKD; lone surrogates (only possible in a file name) become U+FFFD instead of throwing.</summary>
    private static string SafeNormalizeKd(string value)
    {
        try
        {
            return value.Normalize(NormalizationForm.FormKD);
        }
        catch (ArgumentException)
        {
            var sb = new StringBuilder(value.Length);
            for (var i = 0; i < value.Length; i++)
            {
                var c = value[i];
                if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
                {
                    sb.Append(c).Append(value[++i]);
                }
                else
                {
                    sb.Append(char.IsSurrogate(c) ? '\uFFFD' : c);
                }
            }
            return sb.ToString().Normalize(NormalizationForm.FormKD);
        }
    }

    /// <summary>`path.win32.basename`: last segment, `\` and `/` both separators, drive letter and trailing separators ignored.</summary>
    public static string Win32BaseName(string path)
    {
        var start = 0;
        if (path.Length >= 2 && char.IsAsciiLetter(path[0]) && path[1] == ':') start = 2;
        var end = path.Length;
        while (end > start && path[end - 1] is '\\' or '/') end--;
        var begin = end;
        while (begin > start && path[begin - 1] is not ('\\' or '/')) begin--;
        return path[begin..end];
    }
}

/// <summary>
/// `String.prototype.toLowerCase()` (full Unicode mapping, locale independent): `ToLowerInvariant` plus the two
/// special cases of SpecialCasing.txt that are not locale dependent: U+0130 → "i\u0307" and the final sigma.
/// </summary>
public static class JsLower
{
    public static string ToLower(string value)
    {
        if (!value.Contains('\u0130') && !value.Contains('\u03A3')) return value.ToLowerInvariant();
        var sb = new StringBuilder(value.Length + 4);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (c == '\u0130') sb.Append("i\u0307");
            else if (c == '\u03A3') sb.Append(IsFinalSigma(value, i) ? '\u03C2' : '\u03C3');
            else if (char.IsHighSurrogate(c) && i + 1 < value.Length && char.IsLowSurrogate(value[i + 1]))
            {
                sb.Append(value.Substring(i, 2).ToLowerInvariant());
                i++;
            }
            else sb.Append(char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    private static bool IsCaseIgnorable(char c)
    {
        var category = CharUnicodeInfo.GetUnicodeCategory(c);
        return category is UnicodeCategory.NonSpacingMark or UnicodeCategory.EnclosingMark or UnicodeCategory.Format
                or UnicodeCategory.ModifierLetter or UnicodeCategory.ModifierSymbol
            || c is '\'' or '.' or ':' or '^' or '`' or '\u00B7' or '\u2018' or '\u2019' or '\u2024' or '\u2027';
    }

    private static bool IsCased(char c) => char.IsUpper(c) || char.IsLower(c) || CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.TitlecaseLetter;

    /// <summary>Final_Sigma of Unicode: a cased letter before (ignoring case-ignorable ones) and none after.</summary>
    private static bool IsFinalSigma(string value, int index)
    {
        var before = false;
        for (var i = index - 1; i >= 0; i--)
        {
            if (IsCaseIgnorable(value[i])) continue;
            before = IsCased(value[i]);
            break;
        }
        if (!before) return false;
        for (var i = index + 1; i < value.Length; i++)
        {
            if (IsCaseIgnorable(value[i])) continue;
            return !IsCased(value[i]);
        }
        return true;
    }
}
