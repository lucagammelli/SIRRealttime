namespace ArenaLive.Agent.Core;

/// <summary>
/// Same rules as `IngestRequestSchema` (with its refinements): a request that would be refused is never queued.
/// Lengths in UTF-16 units, as zod counts them.
/// </summary>
public static class IngestValidator
{
    public const long MaxSafeInteger = 9_007_199_254_740_991;

    public static bool IsMatchKey(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 128) return false;
        foreach (var c in value)
        {
            if (!(char.IsAsciiLetterOrDigit(c) || c is '.' or '_' or '-')) return false;
        }
        return true;
    }

    public static bool IsSha256Hex(string? value) =>
        value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    /// <summary>`^\s*\[3[A-Z0-9-]+\]\s*$` with JavaScript `\s`.</summary>
    public static bool IsSectionLine(string line)
    {
        var t = JsText.Trim(line);
        if (t.Length < 4 || !t.StartsWith("[3", StringComparison.Ordinal) || t[^1] != ']') return false;
        return t[2..^1].All(c => c is >= 'A' and <= 'Z' or >= '0' and <= '9' or '-');
    }

    /// <summary>Why a scout line would be refused, or null.</summary>
    public static string? LineProblem(string line)
    {
        if (line.Length > Contract.IngestMaxLineLength) return "riga troppo lunga";
        if (line.Contains('\r') || line.Contains('\n')) return "una riga non può contenere a capo";
        if (line.Contains('\0')) return "carattere NUL non ammesso";
        if (IsSectionLine(line)) return "una riga non può aprire una sezione DVW";
        return null;
    }

    /// <summary>Paths of the fields that break the rules (empty: valid), like the `issues` of zod.</summary>
    public static List<string> Problems(IngestRequest r)
    {
        var problems = new List<string>();
        if (r.Protocol != Contract.IngestProtocol) problems.Add("protocol");
        if (!IsMatchKey(r.MatchKey)) problems.Add("matchKey");
        if (r.Seq < 0 || r.Seq > MaxSafeInteger) problems.Add("seq");
        if (r.Kind is not (IngestKind.Append or IngestKind.Snapshot)) problems.Add("kind");
        if (r.FromIndex < 0) problems.Add("fromIndex");
        if (r.Lines.Count > Contract.IngestMaxLines) problems.Add("lines");
        for (var i = 0; i < r.Lines.Count; i++)
        {
            if (LineProblem(r.Lines[i]) is not null) problems.Add($"lines.{i}");
        }
        if (r.Header is not null &&
            (r.Header.Length > Contract.IngestMaxHeaderLength || r.Header.Contains('\0') ||
             r.Header.Contains(Dvw.ScoutSectionMarker, StringComparison.Ordinal)))
        {
            problems.Add("header");
        }
        if (!IsSha256Hex(r.ContentHash)) problems.Add("contentHash");
        if (r.Kind == IngestKind.Snapshot && r.Header is null) problems.Add("header");
        if (r.Kind == IngestKind.Snapshot && r.FromIndex != 0) problems.Add("fromIndex");
        return problems;
    }
}
