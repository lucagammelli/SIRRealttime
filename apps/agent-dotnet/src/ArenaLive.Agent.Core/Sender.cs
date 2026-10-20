using System.IO.Compression;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace ArenaLive.Agent.Core;

public abstract record SendResult
{
    private SendResult() { }

    public sealed record Ok(IngestResponse Response) : SendResult;

    /// <summary>HTTP error status (`RetryAfterMs` from `Retry-After`; `Expired`: 401 because the registration expired).</summary>
    public sealed record Http(int Status, double? RetryAfterMs, bool Expired) : SendResult;

    /// <summary>Network error, timeout or an answer that is not a valid ingest response.</summary>
    public sealed record Network(string Message) : SendResult;
}

public static class ServerUrls
{
    /// <summary>`apiUrl`: `path` (relative, e.g. `api/ingest`) on the server, keeping a path prefix of `serverUrl`.</summary>
    public static Uri Api(string serverUrl, string path)
    {
        var baseUrl = serverUrl.EndsWith('/') ? serverUrl : serverUrl + "/";
        return new Uri(new Uri(baseUrl), path);
    }

    public static Uri Ingest(string serverUrl) => Api(serverUrl, "api/ingest");
}

/// <summary>
/// HTTP client of the agent: normal certificate validation (no bypass), no cookies, no automatic redirect towards
/// another host with the token. One instance per process.
/// </summary>
public static class AgentHttp
{
    public static HttpClient CreateClient(HttpMessageHandler? handler = null)
    {
        handler ??= new SocketsHttpHandler
        {
            UseCookies = false,
            AllowAutoRedirect = false,
            AutomaticDecompression = System.Net.DecompressionMethods.None,
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
        };
        var client = new HttpClient(handler, disposeHandler: true) { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd($"arenalive-agent-dotnet/{typeof(AgentHttp).Assembly.GetName().Version}");
        return client;
    }
}

/// <summary>Sends ingest requests (`Sender` of the Node agent); the token only ever goes into the `Authorization` header.</summary>
public sealed class Sender(HttpClient client, string serverUrl, string agentToken, TimeSpan timeout)
{
    private readonly Uri _url = ServerUrls.Ingest(serverUrl);

    /// <summary>The body of a request: JSON, gzip beyond 4 KB.</summary>
    public static (byte[] Body, bool Gzip) Encode(IngestRequest request)
    {
        var json = JsonSerializer.SerializeToUtf8Bytes(request, Json.Compact);
        if (json.Length <= Contract.GzipThresholdBytes) return (json, false);
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true)) gzip.Write(json);
        return (output.ToArray(), true);
    }

    public async Task<SendResult> SendAsync(IngestRequest request, CancellationToken cancel = default)
    {
        var (body, gzip) = Encode(request);
        using var message = new HttpRequestMessage(HttpMethod.Post, _url);
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", agentToken);
        message.Content = new ByteArrayContent(body);
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        if (gzip) message.Content.Headers.ContentEncoding.Add("gzip");
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeoutSource.CancelAfter(timeout);
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, timeoutSource.Token).ConfigureAwait(false);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or OperationCanceledException or IOException)
        {
            return new SendResult.Network(e is OperationCanceledException ? "timeout della richiesta" : Describe(e));
        }
        using (response)
        {
            var status = (int)response.StatusCode;
            if (status is < 200 or > 299)
            {
                // Only the 401 says why (registration expired or token not valid): the other bodies are not read.
                var expired = status == 401 && await ExpiredAnswerAsync(response, timeoutSource.Token).ConfigureAwait(false);
                double? retryAfter = response.Headers.RetryAfter?.Delta is { } delta && delta > TimeSpan.Zero ? delta.TotalMilliseconds : null;
                return new SendResult.Http(status, retryAfter, expired);
            }
            string text;
            try
            {
                text = await response.Content.ReadAsStringAsync(timeoutSource.Token).ConfigureAwait(false);
            }
            catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException)
            {
                return new SendResult.Network($"risposta non letta: {Describe(e)}");
            }
            var parsed = ResponseValidator.ParseIngestResponse(text);
            return parsed is null ? new SendResult.Network("risposta del server non valida") : new SendResult.Ok(parsed);
        }
    }

    private static async Task<bool> ExpiredAnswerAsync(HttpResponseMessage response, CancellationToken cancel)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(cancel).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(text);
            return doc.RootElement.ValueKind == JsonValueKind.Object &&
                   doc.RootElement.TryGetProperty("error", out var error) && error.ValueKind == JsonValueKind.String &&
                   error.GetString() == Contract.AgentExpiredError;
        }
        catch (Exception e) when (e is JsonException or HttpRequestException or OperationCanceledException or IOException)
        {
            return false;
        }
    }

    /// <summary>Short description of an error for the logs (never the request: it carries the token).</summary>
    public static string Describe(Exception e)
    {
        var sb = new StringBuilder(e.Message);
        if (e.InnerException is { } inner) sb.Append(": ").Append(inner.Message);
        return sb.ToString();
    }
}

/// <summary>Validation of the answers of the server, as the zod schemas of `packages/shared` (`safeParse`).</summary>
public static class ResponseValidator
{
    private static bool IsInt(JsonElement e, long min, out long value)
    {
        value = 0;
        if (e.ValueKind != JsonValueKind.Number || !e.TryGetDouble(out var d) || Math.Floor(d) != d || d < min || d > IngestValidator.MaxSafeInteger) return false;
        value = (long)d;
        return true;
    }

    public static IngestResponse? ParseIngestResponse(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            if (!root.TryGetProperty("status", out var status) || status.ValueKind != JsonValueKind.String) return null;
            var s = status.GetString();
            if (s is not ("ok" or "duplicate" or "needSnapshot")) return null;
            if (!root.TryGetProperty("seq", out var seqEl) || !IsInt(seqEl, -1, out var seq)) return null;
            if (!root.TryGetProperty("lineCount", out var lcEl) || !IsInt(lcEl, 0, out var lineCount) || lineCount > int.MaxValue) return null;
            string? hash = null;
            if (root.TryGetProperty("contentHash", out var h))
            {
                if (h.ValueKind != JsonValueKind.String || !IngestValidator.IsSha256Hex(h.GetString())) return null;
                hash = h.GetString();
            }
            return new IngestResponse { Status = s, Seq = seq, LineCount = (int)lineCount, ContentHash = hash };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
