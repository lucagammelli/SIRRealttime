using System.Text.Json;
using System.Text.Json.Serialization;

namespace SirAgent.Core;

public sealed record StoredContent
{
    [JsonPropertyName("header")] public required string Header { get; init; }
    [JsonPropertyName("lines")] public required IReadOnlyList<string> Lines { get; init; }

    public DvwContent ToContent() => new(Header, Lines);
    public static StoredContent From(DvwContent c) => new() { Header = c.Header, Lines = c.Lines };
}

public sealed record Confirmed
{
    [JsonPropertyName("seq")] public required long Seq { get; init; }
    [JsonPropertyName("lineCount")] public required int LineCount { get; init; }

    [JsonPropertyName("contentHash")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ContentHash { get; init; }

    [JsonPropertyName("at")] public required string At { get; init; }
}

public sealed record Queued
{
    [JsonPropertyName("request")] public required IngestRequest Request { get; init; }
    /// <summary>Global order of the queue (across matches).</summary>
    [JsonPropertyName("order")] public required long Order { get; init; }
}

/// <summary>
/// What is persisted for each match in `&lt;dataDir&gt;/matches/&lt;matchKey&gt;.json`: same format (`version` 1) as the Node
/// agent (`MatchRecordSchema`), so the queue survives a switch from one agent to the other.
/// </summary>
public sealed record MatchRecord
{
    [JsonPropertyName("version")] public int Version { get; init; } = 1;
    [JsonPropertyName("matchKey")] public required string MatchKey { get; init; }
    /// <summary>Next `seq` to use: never decreases.</summary>
    [JsonPropertyName("nextSeq")] public long NextSeq { get; init; }
    /// <summary>Content the server will have once the queue is delivered (base of the next diff).</summary>
    [JsonPropertyName("base")] public StoredContent? Base { get; init; }
    [JsonPropertyName("confirmed")] public Confirmed? Confirmed { get; init; }
    /// <summary>The next change is sent as a snapshot (after a refused request).</summary>
    [JsonPropertyName("forceSnapshot")] public bool ForceSnapshot { get; init; }
    [JsonPropertyName("queue")] public IReadOnlyList<Queued> Queue { get; init; } = [];

    [JsonPropertyName("sourceFile")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceFile { get; init; }

    /// <summary>Epoch ms of the next attempt of a snapshot refused by the server (with `forceSnapshot`).</summary>
    [JsonPropertyName("retrySnapshotAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public double? RetrySnapshotAt { get; init; }

    /// <summary>ISO time of the last save (retention).</summary>
    [JsonPropertyName("updatedAt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? UpdatedAt { get; init; }

    public static MatchRecord New(string matchKey) => new() { MatchKey = matchKey };

    /// <summary>Same checks as `MatchRecordSchema` (the queued requests as `IngestRequestSchema`).</summary>
    public bool IsValid() =>
        Version == 1 && IngestValidator.IsMatchKey(MatchKey) && NextSeq >= 0 && Queue is not null &&
        (Base is null || (Base.Header is not null && Base.Lines is not null && Base.Lines.All(l => l is not null))) &&
        (Confirmed is null || (Confirmed.Seq >= -1 && Confirmed.LineCount >= 0 && Confirmed.At is not null)) &&
        Queue.All(q => q is not null && q.Order >= 0 && q.Request is not null && q.Request.Lines is not null &&
                       IngestValidator.Problems(q.Request).Count == 0);
}

public sealed record StoreWarning(string File, string Reason);

/// <summary>Persistent state and queue of every match, one JSON file each (`MatchStore` of the Node agent).</summary>
public sealed class MatchStore
{
    private readonly Dictionary<string, MatchRecord> _records = new(StringComparer.Ordinal);
    private readonly int _retentionDays;
    private readonly TimeProvider _time;
    private long _order;

    public MatchStore(string dataDir, int retentionDays = 30, TimeProvider? time = null)
    {
        Dir = Path.Combine(dataDir, "matches");
        _retentionDays = retentionDays;
        _time = time ?? TimeProvider.System;
    }

    public string Dir { get; }

    /// <summary>A record with an empty queue not updated for more than the retention days.</summary>
    private bool Expired(MatchRecord record)
    {
        if (record.Queue.Count > 0 || record.UpdatedAt is null) return false;
        var updated = Json.ParseIsoTime(record.UpdatedAt);
        return updated is not null && (_time.GetUtcNow() - updated.Value).TotalMilliseconds > _retentionDays * 86_400_000.0;
    }

    /// <summary>Loads the records; unreadable files are renamed `.corrupt`, expired ones deleted.</summary>
    public List<StoreWarning> Load()
    {
        Directory.CreateDirectory(Dir);
        var warnings = new List<StoreWarning>();
        foreach (var file in Directory.GetFiles(Dir).Order(StringComparer.Ordinal))
        {
            var name = Path.GetFileName(file);
            if (!name.EndsWith(".json", StringComparison.Ordinal)) continue;
            MatchRecord? record = null;
            try
            {
                var parsed = JsonSerializer.Deserialize<MatchRecord>(File.ReadAllText(file), Json.Compact);
                if (parsed is not null && parsed.IsValid() && $"{parsed.MatchKey}.json" == name) record = parsed;
            }
            catch (Exception e) when (e is JsonException or IOException or UnauthorizedAccessException or NotSupportedException or ArgumentException)
            {
                record = null;
            }
            if (record is null)
            {
                warnings.Add(new StoreWarning(file, "file di stato non valido: rinominato in .corrupt"));
                try
                {
                    File.Move(file, file + ".corrupt", overwrite: true);
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    // left as it is: reported anyway
                }
                continue;
            }
            if (Expired(record))
            {
                warnings.Add(new StoreWarning(file, "partita non aggiornata da troppo tempo: stato cancellato"));
                AtomicFile.Delete(file);
                continue;
            }
            _records[record.MatchKey] = record;
            foreach (var q in record.Queue) _order = Math.Max(_order, q.Order + 1);
        }
        return warnings;
    }

    public MatchRecord? Get(string matchKey) => _records.GetValueOrDefault(matchKey);

    public List<MatchRecord> All() => [.. _records.Values];

    public long NextOrder() => _order++;

    public int QueueSize() => _records.Values.Sum(r => r.Queue.Count);

    /// <summary>Record whose first queued message is the oldest.</summary>
    public MatchRecord? NextToSend()
    {
        MatchRecord? best = null;
        foreach (var r in _records.Values)
        {
            if (r.Queue.Count == 0) continue;
            if (best is null || r.Queue[0].Order < best.Queue[0].Order) best = r;
        }
        return best;
    }

    public void Save(MatchRecord record)
    {
        var stamped = record with { UpdatedAt = Json.IsoTime(_time.GetUtcNow()) };
        _records[record.MatchKey] = stamped;
        Directory.CreateDirectory(Dir);
        AtomicFile.Write(Path.Combine(Dir, $"{record.MatchKey}.json"), JsonSerializer.Serialize(stamped, Json.Compact));
    }

    public void Remove(string matchKey)
    {
        _records.Remove(matchKey);
        AtomicFile.Delete(Path.Combine(Dir, $"{matchKey}.json"));
    }
}
