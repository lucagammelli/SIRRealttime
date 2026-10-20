using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;

namespace ArenaLive.Agent.Core;

/// <summary>
/// Limits and fixed texts of the contracts (`packages/shared`): the tests compare them with
/// `schemas/agent-constants.json`, generated from the zod schemas.
/// </summary>
public static class Contract
{
    public const int IngestProtocol = 1;
    public const int IngestMaxLines = 5000;
    public const int IngestMaxLineLength = 2000;
    public const int IngestMaxHeaderLength = 512 * 1024;
    public const string AgentExpiredError = "Registrazione scaduta: registrati di nuovo";
    public const string PairingCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    public const int PairingCodeLength = 6;
    public const int AgentBrandingVersion = 1;
    public const int AgentLogoMaxBytes = 2 * 1024 * 1024;
    public const int AgentLogoMaxSide = 1024;
    /// <summary>Bodies larger than this are sent with `Content-Encoding: gzip` (as `GZIP_THRESHOLD_BYTES`).</summary>
    public const int GzipThresholdBytes = 4 * 1024;
}

/// <summary>Body of `POST /api/ingest` (`IngestRequestSchema`).</summary>
public sealed record IngestRequest
{
    [JsonPropertyName("protocol")] public int Protocol { get; init; } = Contract.IngestProtocol;
    [JsonPropertyName("matchKey")] public required string MatchKey { get; init; }
    [JsonPropertyName("seq")] public required long Seq { get; init; }
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("fromIndex")] public required int FromIndex { get; init; }
    [JsonPropertyName("lines")] public required IReadOnlyList<string> Lines { get; init; }

    [JsonPropertyName("header")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Header { get; init; }

    [JsonPropertyName("contentHash")] public required string ContentHash { get; init; }
}

/// <summary>Answer of `POST /api/ingest` (`IngestResponseSchema`).</summary>
public sealed record IngestResponse
{
    [JsonPropertyName("status")] public required string Status { get; init; }
    [JsonPropertyName("seq")] public required long Seq { get; init; }
    [JsonPropertyName("lineCount")] public required int LineCount { get; init; }

    [JsonPropertyName("contentHash")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ContentHash { get; init; }
}

public static class IngestKind
{
    public const string Append = "append";
    public const string Snapshot = "snapshot";
}

/// <summary>A request still without `protocol`, `matchKey` and `seq` (assigned when it is queued).</summary>
public sealed record PlannedRequest(string Kind, int FromIndex, IReadOnlyList<string> Lines, string? Header, string ContentHash);

/// <summary>Pure: diff of the scout lines, content hash and planned requests (`diffScoutLines`, `hashScoutLines`, `planRequests`).</summary>
public static class ScoutSync
{
    /// <summary>sha256 hex of the scout lines joined with "\n" (UTF-8).</summary>
    public static string HashScoutLines(IEnumerable<string> lines) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', lines))));

    /// <summary>`append` of the new lines when `prev` is a prefix of `next` (even with none), otherwise null (snapshot).</summary>
    public static int? AppendFrom(IReadOnlyList<string> prev, IReadOnlyList<string> next)
    {
        if (prev.Count > next.Count) return null;
        for (var i = 0; i < prev.Count; i++)
        {
            if (!string.Equals(prev[i], next[i], StringComparison.Ordinal)) return null;
        }
        return prev.Count;
    }

    /// <summary>
    /// The requests that bring the server from `baseContent` (null if nothing was sent) to `next`. Empty when nothing
    /// changed (even with `forceSnapshot`). Snapshot without base, when a past line changed or, if something changed,
    /// with `forceSnapshot`; the header travels with the snapshot and whenever it changes. Requests of more than
    /// `maxLines` lines are split; every `ContentHash` is that of the lines after the request.
    /// </summary>
    public static List<PlannedRequest> PlanRequests(DvwContent? baseContent, DvwContent next, bool forceSnapshot = false, int maxLines = Contract.IngestMaxLines)
    {
        int? appendFrom = baseContent is null ? null : AppendFrom(baseContent.Lines, next.Lines);
        var headerChanged = baseContent is null || !string.Equals(baseContent.Header, next.Header, StringComparison.Ordinal);
        if (appendFrom is not null && appendFrom == next.Lines.Count && !headerChanged) return [];
        var snapshot = appendFrom is null || forceSnapshot;
        var index = snapshot ? 0 : appendFrom!.Value;
        var lines = next.Lines;
        var output = new List<PlannedRequest>();
        do
        {
            var end = Math.Min(lines.Count, index + maxLines);
            var first = output.Count == 0;
            var kind = first && snapshot ? IngestKind.Snapshot : IngestKind.Append;
            output.Add(new PlannedRequest(
                kind,
                kind == IngestKind.Snapshot ? 0 : index,
                lines.Skip(index).Take(end - index).ToList(),
                first && (snapshot || headerChanged) ? next.Header : null,
                HashScoutLines(lines.Take(end))));
            index = end;
        } while (index < lines.Count);
        return output;
    }

    public static IngestRequest ToRequest(string matchKey, long seq, PlannedRequest p) => new()
    {
        MatchKey = matchKey,
        Seq = seq,
        Kind = p.Kind,
        FromIndex = p.FromIndex,
        Lines = p.Lines,
        Header = p.Header,
        ContentHash = p.ContentHash,
    };
}
