using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using Json.Schema;

namespace ArenaLive.Agent.Core.Tests;

/// <summary>Clock moved by hand.</summary>
public sealed class ManualTime(DateTimeOffset start) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = start;
    public override DateTimeOffset GetUtcNow() => Now;
    public void Advance(TimeSpan by) => Now += by;
}

/// <summary>Temporary folder deleted at the end of the test.</summary>
public sealed class TempDir : IDisposable
{
    public TempDir()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "arenalive-agent-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path);
    }

    public string Path { get; }

    public string File(string name) => System.IO.Path.Combine(Path, name);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // best effort
        }
    }
}

/// <summary>A request seen by the fake server.</summary>
public sealed record SeenRequest(string Method, Uri Url, string? Authorization, string? ContentEncoding, string Body, IReadOnlyDictionary<string, string> Headers);

/// <summary>Fake HTTP server: records the requests and answers with `respond`.</summary>
public sealed class FakeHandler(Func<SeenRequest, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<SeenRequest> Seen { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var bytes = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        var encoding = request.Content?.Headers.ContentEncoding.FirstOrDefault();
        if (encoding == "gzip")
        {
            using var input = new GZipStream(new MemoryStream(bytes), CompressionMode.Decompress);
            using var output = new MemoryStream();
            await input.CopyToAsync(output, cancellationToken);
            bytes = output.ToArray();
        }
        var headers = request.Headers.Concat(request.Content?.Headers ?? Enumerable.Empty<KeyValuePair<string, IEnumerable<string>>>())
            .ToDictionary(h => h.Key.ToLowerInvariant(), h => string.Join(",", h.Value));
        var seen = new SeenRequest(request.Method.Method, request.RequestUri!, request.Headers.Authorization?.ToString(), encoding, Encoding.UTF8.GetString(bytes), headers);
        lock (Seen) Seen.Add(seen);
        return respond(seen);
    }

    public static HttpResponseMessage Json(HttpStatusCode status, string body) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    /// <summary>Server that accepts every ingest request (`ok`, same seq and hash).</summary>
    public static HttpResponseMessage AcceptIngest(SeenRequest r)
    {
        var body = JsonNode.Parse(r.Body)!.AsObject();
        var lines = body["lines"]!.AsArray().Count;
        var from = body["fromIndex"]!.GetValue<int>();
        return Json(HttpStatusCode.OK, $$"""{"status":"ok","seq":{{body["seq"]}},"lineCount":{{from + lines}},"contentHash":"{{body["contentHash"]}}"}""");
    }
}

public sealed class NullLog : ILog
{
    public List<(LogLevel Level, string Message, IReadOnlyDictionary<string, object?>? Fields)> Lines { get; } = [];

    public void Write(LogLevel level, string message, IReadOnlyDictionary<string, object?>? fields = null)
    {
        lock (Lines) Lines.Add((level, message, fields));
    }

    public bool Has(string message)
    {
        lock (Lines) return Lines.Any(l => l.Message.Contains(message, StringComparison.Ordinal));
    }
}

/// <summary>Files of the repository (the tests run from the build folder, inside the repository).</summary>
public static class Repo
{
    public static string Root
    {
        get
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("radice del repository non trovata");
        }
    }

    public static string SchemaDir => Path.Combine(AppContext.BaseDirectory, "schemas");

    public static JsonSchema Schema(string name) => JsonSchema.FromText(File.ReadAllText(Path.Combine(SchemaDir, name)));

    public static bool IsValid(string schemaName, string json)
    {
        var schema = Schema(schemaName);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        return schema.Evaluate(doc.RootElement, new EvaluationOptions { OutputFormat = OutputFormat.Flag }).IsValid;
    }
}
