using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace ArenaLive.Agent.Core;

public enum RegistrationErrorCode
{
    Network,
    Aborted,
    Unauthorized,
    RateLimited,
    InvalidRequest,
    InvalidResponse,
    Http,
}

/// <summary>Error of a registration request; `Message` is for the window (Italian, never the secret).</summary>
public sealed class RegistrationException(RegistrationErrorCode code, string message, int? status = null) : Exception(message)
{
    public RegistrationErrorCode Code { get; } = code;
    public int? Status { get; } = status;
}

/// <summary>Answer to `POST /api/agents/registrations` (`CreateRegistrationResponseSchema`).</summary>
public sealed record CreatedRegistration(string RegistrationId, string Secret, string PairingCode, string ExpiresAt);

/// <summary>Answer of `POST /api/agents/registrations/status` (`RegistrationStatusResponseSchema`).</summary>
public sealed record RegistrationStatus(string Status, string? ExpiresAt = null, string? Token = null, string? AgentId = null);

/// <summary>Registration waiting for the approval, in `&lt;dataDir&gt;/registration.json` (same format as the Node agent).</summary>
public sealed record PendingRegistration
{
    [JsonPropertyName("version")] public int Version { get; init; } = 1;
    [JsonPropertyName("registrationId")] public required string RegistrationId { get; init; }
    [JsonPropertyName("secret")] public required string Secret { get; init; }
    [JsonPropertyName("pairingCode")] public required string PairingCode { get; init; }
    [JsonPropertyName("expiresAt")] public required string ExpiresAt { get; init; }
    [JsonPropertyName("name")] public required string Name { get; init; }
}

/// <summary>What the controller needs of the client (a fake one in the tests).</summary>
public interface IRegistrationApi
{
    Task<CreatedRegistration> CreateAsync(string name, CancellationToken cancel);
    Task<RegistrationStatus> StatusAsync(string secret, CancellationToken cancel);
}

/// <summary>Formats of `packages/shared` (`registration.ts`, `strings.ts`), checked as zod does.</summary>
public static partial class RegistrationFormats
{
    [GeneratedRegex(@"^[A-Za-z0-9_-]{20,200}\z")]
    private static partial Regex SecretRegex();

    [GeneratedRegex(@"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)\z")]
    private static partial Regex UuidRegex();

    // z.iso.datetime(): UTC with Z, optional fraction.
    [GeneratedRegex(@"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z\z")]
    private static partial Regex IsoRegex();

    public static bool IsSecret(string? v) => v is not null && SecretRegex().IsMatch(v);
    public static bool IsUuid(string? v) => v is not null && UuidRegex().IsMatch(v);

    public static bool IsIsoDateTime(string? v) =>
        v is not null && IsoRegex().IsMatch(v) &&
        DateTime.TryParseExact(v[..19], "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    public static bool IsPairingCode(string? v) =>
        v is { Length: Contract.PairingCodeLength } && v.All(c => Contract.PairingCodeAlphabet.Contains(c));

    /// <summary>`plainText(100)`: trimmed (JavaScript `trim`), 1-100 characters, no control characters; null if not valid.</summary>
    public static string? PlainText(string? value, int max = 100)
    {
        if (value is null) return null;
        var t = JsText.Trim(value);
        if (t.Length < 1 || t.Length > max) return null;
        return t.Any(c => c <= '\u001F' || c == '\u007F') ? null : t;
    }
}

/// <summary>
/// Client of the public registration routes (`RegistrationClient`): JSON body, no `Origin`. The secret only goes
/// into the `Authorization` header.
/// </summary>
public sealed class RegistrationClient(HttpClient client, string serverUrl, TimeSpan? timeout = null) : IRegistrationApi
{
    private readonly TimeSpan _timeout = timeout ?? TimeSpan.FromSeconds(10);

    public async Task<CreatedRegistration> CreateAsync(string name, CancellationToken cancel)
    {
        var clean = RegistrationFormats.PlainText(name) ??
                    throw new RegistrationException(RegistrationErrorCode.InvalidRequest, "Nome agente non valido: da 1 a 100 caratteri, su una riga");
        using var doc = await PostAsync(ServerUrls.Api(serverUrl, "api/agents/registrations"), RegistrationBodies.Create(clean), null, cancel).ConfigureAwait(false);
        return ParseCreated(doc.RootElement) ?? throw InvalidResponse();
    }

    public async Task<RegistrationStatus> StatusAsync(string secret, CancellationToken cancel)
    {
        using var doc = await PostAsync(ServerUrls.Api(serverUrl, "api/agents/registrations/status"), "{}", secret, cancel).ConfigureAwait(false);
        return ParseStatus(doc.RootElement) ?? throw InvalidResponse();
    }

    private static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static CreatedRegistration? ParseCreated(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        var id = Str(root, "registrationId");
        var secret = Str(root, "secret");
        var code = Str(root, "pairingCode");
        var expires = Str(root, "expiresAt");
        if (!RegistrationFormats.IsUuid(id) || !RegistrationFormats.IsSecret(secret) || !RegistrationFormats.IsPairingCode(code) || !RegistrationFormats.IsIsoDateTime(expires)) return null;
        return new CreatedRegistration(id!, secret!, code!, expires!);
    }

    public static RegistrationStatus? ParseStatus(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        var status = Str(root, "status");
        switch (status)
        {
            case "pending":
                var expires = Str(root, "expiresAt");
                return RegistrationFormats.IsIsoDateTime(expires) ? new RegistrationStatus(status, ExpiresAt: expires) : null;
            case "approved":
                var token = Str(root, "token");
                var agentId = Str(root, "agentId");
                return RegistrationFormats.IsSecret(token) && RegistrationFormats.IsUuid(agentId) ? new RegistrationStatus(status, Token: token, AgentId: agentId) : null;
            case "consumed" or "rejected" or "expired":
                return new RegistrationStatus(status);
            default:
                return null;
        }
    }

    private async Task<JsonDocument> PostAsync(Uri url, string body, string? secret, CancellationToken cancel)
    {
        using var message = new HttpRequestMessage(HttpMethod.Post, url);
        if (secret is not null) message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", secret);
        message.Content = new StringContent(body, new UTF8Encoding(false), new MediaTypeHeaderValue("application/json"));
        message.Content.Headers.ContentType!.CharSet = null;
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeoutSource.CancelAfter(_timeout);
        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(message, timeoutSource.Token).ConfigureAwait(false);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or IOException)
        {
            if (cancel.IsCancellationRequested) throw new RegistrationException(RegistrationErrorCode.Aborted, "Richiesta annullata");
            var why = e is OperationCanceledException ? "timeout della richiesta" : Sender.Describe(e);
            throw new RegistrationException(RegistrationErrorCode.Network, $"Server non raggiungibile: {why}");
        }
        using (response)
        {
            var status = (int)response.StatusCode;
            if (status is < 200 or > 299) throw HttpError(status);
            try
            {
                var text = await response.Content.ReadAsStringAsync(timeoutSource.Token).ConfigureAwait(false);
                return JsonDocument.Parse(text);
            }
            catch (Exception e) when (e is JsonException or HttpRequestException or IOException)
            {
                throw InvalidResponse();
            }
            catch (OperationCanceledException) when (cancel.IsCancellationRequested)
            {
                throw new RegistrationException(RegistrationErrorCode.Aborted, "Richiesta annullata");
            }
            catch (OperationCanceledException)
            {
                throw new RegistrationException(RegistrationErrorCode.Network, "Server non raggiungibile: timeout della richiesta");
            }
        }
    }

    private static RegistrationException InvalidResponse() =>
        new(RegistrationErrorCode.InvalidResponse, "Risposta del server non valida: controlla serverUrl in config.json");

    public static RegistrationException HttpError(int status) => status switch
    {
        401 => new RegistrationException(RegistrationErrorCode.Unauthorized, "Richiesta di registrazione non riconosciuta dal server: registra di nuovo", status),
        429 => new RegistrationException(RegistrationErrorCode.RateLimited, "Troppe richieste di registrazione: riprova tra qualche minuto (o rifiuta dal portale quelle in attesa)", status),
        404 => new RegistrationException(RegistrationErrorCode.Http, "Registrazione non disponibile su questo server (404): controlla serverUrl in config.json", status),
        _ => new RegistrationException(RegistrationErrorCode.Http, $"Il server ha risposto con un errore (HTTP {status})", status),
    };
}

/// <summary>Bodies of the registration requests (validated by the tests against the generated JSON Schema).</summary>
public static class RegistrationBodies
{
    public static string Create(string name) => JsonSerializer.Serialize(new Dictionary<string, string> { ["name"] = name }, Json.Compact);
}

/// <summary>`registration.json`: the pending registration survives a restart of the window.</summary>
public static class PendingRegistrationFile
{
    public static string PathOf(string dataDir) => Path.Combine(dataDir, "registration.json");

    /// <summary>The pending registration, or null (missing or unreadable file: an unreadable one is deleted).</summary>
    public static PendingRegistration? Load(string dataDir)
    {
        var file = PathOf(dataDir);
        string text;
        try
        {
            text = File.ReadAllText(file);
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
        PendingRegistration? parsed = null;
        try
        {
            parsed = JsonSerializer.Deserialize<PendingRegistration>(text, Json.Compact);
        }
        catch (JsonException)
        {
            parsed = null;
        }
        if (parsed is not null && parsed.Version == 1 && RegistrationFormats.IsUuid(parsed.RegistrationId) &&
            RegistrationFormats.IsSecret(parsed.Secret) && RegistrationFormats.IsPairingCode(parsed.PairingCode) &&
            RegistrationFormats.IsIsoDateTime(parsed.ExpiresAt) && RegistrationFormats.PlainText(parsed.Name) is { } name)
        {
            return parsed with { Name = name };
        }
        AtomicFile.Delete(file);
        return null;
    }

    public static void Save(string dataDir, PendingRegistration registration)
    {
        Directory.CreateDirectory(dataDir);
        AtomicFile.Write(PathOf(dataDir), JsonSerializer.Serialize(registration, Json.Compact));
    }

    public static void Clear(string dataDir) => AtomicFile.Delete(PathOf(dataDir));
}
