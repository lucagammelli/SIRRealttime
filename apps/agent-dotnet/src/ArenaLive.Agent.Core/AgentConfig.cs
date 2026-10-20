using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace ArenaLive.Agent.Core;

public enum ConfigErrorCode
{
    NotFound,
    InvalidJson,
    Invalid,
}

/// <summary>Error of the agent configuration (`ConfigError`); `Message` is for the user (Italian).</summary>
public sealed class ConfigException(ConfigErrorCode code, string message) : Exception(message)
{
    public ConfigErrorCode Code { get; } = code;
}

/// <summary>Configuration with absolute paths and defaults applied (`AgentConfig` of the Node agent).</summary>
public sealed record AgentConfig
{
    public required string WatchPath { get; init; }
    public required string ServerUrl { get; init; }
    public bool AllowHttpPrivateNetwork { get; init; }
    public required string AgentToken { get; init; }
    public int PollIntervalMs { get; init; } = 1000;
    public int StableMs { get; init; } = 700;
    public required string DataDir { get; init; }
    public required string LogDir { get; init; }
    public string LogLevel { get; init; } = "info";
    public int SnapshotRetryMs { get; init; } = 300_000;
    public int RetentionDays { get; init; } = 30;
}

/// <summary>
/// `config.json` next to the executable, the same file of the Node agent (`AgentConfigFileSchema`, unknown fields
/// refused): the one downloaded from the portal works with both agents.
/// </summary>
public static partial class ConfigFile
{
    public static readonly string[] LogLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

    private static readonly HashSet<string> KnownFields =
    [
        "watchPath", "serverUrl", "allowHttpPrivateNetwork", "agentToken", "pollIntervalMs", "stableMs", "dataDir",
        "logDir", "logLevel", "snapshotRetryMs", "retentionDays",
    ];

    private static readonly HashSet<string> LocalHosts = ["localhost", "127.0.0.1", "[::1]"];

    [GeneratedRegex(@"^[A-Za-z0-9_-]{20,200}\z")]
    private static partial Regex TokenRegex();

    [GeneratedRegex(@"^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\z")]
    private static partial Regex Ipv4Regex();

    public const string TokenMessage = "agentToken non valido (copialo intero dall’area admin)";

    public static bool IsToken(string? value) => value is not null && TokenRegex().IsMatch(value);

    /// <summary>`isPrivateIPv4`: literal IPv4 in 10/8, 172.16/12, 192.168/16 (never a host name).</summary>
    public static bool IsPrivateIPv4(string hostname)
    {
        var m = Ipv4Regex().Match(hostname);
        if (!m.Success) return false;
        var a = int.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        var b = int.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
        return a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168);
    }

    /// <summary>Host as the WHATWG URL `hostname` (IPv6 in brackets, lowercase).</summary>
    public static string HostName(Uri url) => url.HostNameType == UriHostNameType.IPv6 ? $"[{url.IdnHost.Trim('[', ']')}]" : url.IdnHost.ToLowerInvariant();

    /// <summary>Syntax of `serverUrl`: absolute URL without credentials; null if fine, otherwise the message.</summary>
    public static string? ServerUrlSyntaxProblem(string value, out Uri? url)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out url) || url.IsFile || url.IsUnc || string.IsNullOrEmpty(url.Host))
        {
            url = null;
            return "Invalid URL";
        }
        if (url.UserInfo.Length > 0) return "serverUrl non può contenere credenziali";
        return null;
    }

    /// <summary>`serverUrlProtocolProblem`: https always; http only towards localhost or, if allowed, private IPv4.</summary>
    public static string? ServerUrlProtocolProblem(Uri url, bool allowHttpPrivateNetwork)
    {
        var host = HostName(url);
        if (url.Scheme == "https" || (url.Scheme == "http" && LocalHosts.Contains(host))) return null;
        if (url.Scheme == "http" && IsPrivateIPv4(host))
        {
            if (allowHttpPrivateNetwork) return null;
            return "serverUrl: per http verso un IP privato imposta allowHttpPrivateNetwork: true (solo per prove in rete locale)";
        }
        if (url.Scheme == "http")
        {
            return "serverUrl: http rifiutato verso un host pubblico o un nome host; usa https (http solo verso localhost o, con allowHttpPrivateNetwork, verso un IP privato)";
        }
        return "serverUrl deve usare https (http solo verso localhost o 127.0.0.1)";
    }

    /// <summary>True when the agent will talk plain http to a private-network address on purpose (warning at start-up).</summary>
    public static bool UsesPlainHttpOnPrivateNetwork(string serverUrl, bool allow) =>
        allow && Uri.TryCreate(serverUrl, UriKind.Absolute, out var url) && url.Scheme == "http" && IsPrivateIPv4(HostName(url));

    /// <summary>True when `child` is `parent` or lies inside it (case-insensitive, as on Windows).</summary>
    public static bool IsInside(string parent, string child)
    {
        var rel = Path.GetRelativePath(parent.ToLowerInvariant(), child.ToLowerInvariant());
        return rel == "." || (!rel.StartsWith("..", StringComparison.Ordinal) && !Path.IsPathRooted(rel));
    }

    /// <summary>The USB stick (`watchPath` or the folder of the `.dvw`) never receives our files.</summary>
    public static void AssertNotOnStick(string watchPath, IReadOnlyDictionary<string, string> dirs)
    {
        var stick = watchPath.EndsWith(".dvw", StringComparison.OrdinalIgnoreCase) ? Path.GetDirectoryName(watchPath) ?? watchPath : watchPath;
        foreach (var (name, dir) in dirs)
        {
            if (IsInside(stick, dir))
            {
                throw new ConfigException(ConfigErrorCode.Invalid, $"Configurazione non valida: {name} non può stare dentro watchPath ({stick})");
            }
        }
    }

    private static string? StringField(JsonObject raw, string name) =>
        raw[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static bool IsInteger(JsonNode? node, out long value)
    {
        value = 0;
        if (node is not JsonValue v || v.GetValueKind() != JsonValueKind.Number) return false;
        var d = v.GetValue<double>();
        if (Math.Floor(d) != d || Math.Abs(d) > IngestValidator.MaxSafeInteger) return false;
        value = (long)d;
        return true;
    }

    /// <summary>Validates the parsed JSON (`parseConfig`) and resolves the paths against `baseDir`.</summary>
    public static AgentConfig Parse(JsonNode? node, string baseDir)
    {
        var issues = new List<string>();
        if (node is not JsonObject raw) throw new ConfigException(ConfigErrorCode.Invalid, "Configurazione non valida: config: oggetto atteso");

        foreach (var (key, _) in raw)
        {
            if (!KnownFields.Contains(key)) issues.Add($"config: campo sconosciuto «{key}»");
        }

        var watchPath = StringField(raw, "watchPath");
        if (string.IsNullOrEmpty(watchPath)) issues.Add("watchPath: obbligatorio");

        var serverUrl = StringField(raw, "serverUrl");
        Uri? url = null;
        if (serverUrl is null) issues.Add("serverUrl: obbligatorio");
        else if (ServerUrlSyntaxProblem(serverUrl, out url) is { } syntax) issues.Add($"serverUrl: {syntax}");

        var allow = false;
        if (raw.ContainsKey("allowHttpPrivateNetwork"))
        {
            if (raw["allowHttpPrivateNetwork"] is JsonValue av && av.GetValueKind() is JsonValueKind.True or JsonValueKind.False) allow = av.GetValue<bool>();
            else issues.Add("allowHttpPrivateNetwork: true o false");
        }

        var token = StringField(raw, "agentToken");
        if (!IsToken(token)) issues.Add($"agentToken: {TokenMessage}");

        int Int(string name, int min, int max, int fallback)
        {
            if (!raw.ContainsKey(name)) return fallback;
            if (IsInteger(raw[name], out var v) && v >= min && v <= max) return (int)v;
            issues.Add($"{name}: intero da {min} a {max}");
            return fallback;
        }

        string? OptionalPath(string name)
        {
            if (!raw.ContainsKey(name)) return null;
            var s = StringField(raw, name);
            if (string.IsNullOrEmpty(s)) issues.Add($"{name}: testo non vuoto");
            return s;
        }

        var pollIntervalMs = Int("pollIntervalMs", 10, 60_000, 1000);
        var stableMs = Int("stableMs", 0, 60_000, 700);
        var dataDir = OptionalPath("dataDir");
        var logDir = OptionalPath("logDir");
        var logLevel = "info";
        if (raw.ContainsKey("logLevel"))
        {
            var level = StringField(raw, "logLevel");
            if (level is not null && LogLevels.Contains(level)) logLevel = level;
            else issues.Add($"logLevel: uno tra {string.Join(", ", LogLevels)}");
        }
        var snapshotRetryMs = Int("snapshotRetryMs", 1000, 86_400_000, 300_000);
        var retentionDays = Int("retentionDays", 1, 3650, 30);

        if (url is not null && ServerUrlProtocolProblem(url, allow) is { } protocol) issues.Add($"serverUrl: {protocol}");

        if (issues.Count > 0) throw new ConfigException(ConfigErrorCode.Invalid, $"Configurazione non valida: {string.Join("; ", issues)}");

        var config = new AgentConfig
        {
            WatchPath = Path.GetFullPath(watchPath!, baseDir),
            ServerUrl = serverUrl!,
            AllowHttpPrivateNetwork = allow,
            AgentToken = token!,
            PollIntervalMs = pollIntervalMs,
            StableMs = stableMs,
            DataDir = Path.GetFullPath(dataDir ?? "data", baseDir),
            LogDir = Path.GetFullPath(logDir ?? "logs", baseDir),
            LogLevel = logLevel,
            SnapshotRetryMs = snapshotRetryMs,
            RetentionDays = retentionDays,
        };
        AssertNotOnStick(config.WatchPath, new Dictionary<string, string> { ["dataDir"] = config.DataDir, ["logDir"] = config.LogDir });
        return config;
    }

    /// <summary>Raw content of `config.json` (not validated): ok, missing or invalid with the message for the window.</summary>
    public static JsonObject ReadRaw(string file)
    {
        string text;
        try
        {
            text = File.ReadAllText(file);
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            throw new ConfigException(ConfigErrorCode.NotFound, MissingMessage(file));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            throw new ConfigException(ConfigErrorCode.InvalidJson, $"config.json illeggibile: {file}");
        }
        JsonNode? node;
        try
        {
            node = JsonNode.Parse(Json.WithoutBom(text));
            _ = node?.ToJsonString();
        }
        catch (Exception e) when (e is JsonException or ArgumentException or InvalidOperationException)
        {
            throw new ConfigException(ConfigErrorCode.InvalidJson, $"config.json non è un JSON valido: {file}");
        }
        return node as JsonObject ?? throw new ConfigException(ConfigErrorCode.InvalidJson, $"config.json non contiene un oggetto JSON: {file}");
    }

    public static string MissingMessage(string file) =>
        $"config.json non trovato ({file}): scaricalo dall'area admin, pagina «Agenti», e mettilo accanto a arenalive-agent.exe";

    /// <summary>Reads and validates a `config.json` (`loadConfig`).</summary>
    public static AgentConfig Load(string file, string baseDir)
    {
        JsonObject raw;
        try
        {
            raw = ReadRaw(file);
        }
        catch (ConfigException e) when (e.Code == ConfigErrorCode.NotFound)
        {
            throw new ConfigException(ConfigErrorCode.NotFound, $"File di configurazione non trovato o illeggibile: {file}");
        }
        return Parse(raw, baseDir);
    }

    public static string DefaultPath(string baseDir) => Path.Combine(baseDir, "config.json");

    private static string Text(JsonObject? raw, string name) => raw is null ? "" : StringField(raw, name) ?? "";

    /// <summary>Whether a token is saved and its last 4 characters (the token itself never reaches the window).</summary>
    public static (bool Present, string? Last4) TokenInfo(JsonObject? raw)
    {
        var token = Text(raw, "agentToken");
        return token.Length == 0 ? (false, null) : (true, token.Length >= 4 ? token[^4..] : token);
    }

    public static (string WatchPath, string ServerUrl) WindowFields(JsonObject? raw) => (Text(raw, "watchPath"), Text(raw, "serverUrl"));

    /// <summary>Folders and level before the configuration is validated (defaults as `parseConfig`).</summary>
    public static (string DataDir, string LogDir, string Level) GuiPaths(JsonObject? raw, string baseDir)
    {
        var dataDir = Text(raw, "dataDir");
        var logDir = Text(raw, "logDir");
        var level = Text(raw, "logLevel");
        return (Path.GetFullPath(dataDir.Length > 0 ? dataDir : "data", baseDir),
            Path.GetFullPath(logDir.Length > 0 ? logDir : "logs", baseDir),
            LogLevels.Contains(level) ? level : "info");
    }

    /// <summary>`registrationServerUrl`: `serverUrl` checked as at START, for the self-registration.</summary>
    public static string RegistrationServerUrl(JsonObject raw)
    {
        var value = JsText.Trim(Text(raw, "serverUrl"));
        if (value.Length == 0)
        {
            throw new ConfigException(ConfigErrorCode.Invalid, "serverUrl mancante in config.json: scaricalo dall’area admin, pagina «Agenti»");
        }
        if (ServerUrlSyntaxProblem(value, out var url) is { } syntax)
        {
            throw new ConfigException(ConfigErrorCode.Invalid, $"Configurazione non valida: serverUrl: {syntax}");
        }
        var allow = raw["allowHttpPrivateNetwork"] is JsonValue v && v.GetValueKind() == JsonValueKind.True;
        if (ServerUrlProtocolProblem(url!, allow) is { } problem) throw new ConfigException(ConfigErrorCode.Invalid, $"Configurazione non valida: {problem}");
        return value;
    }

    /// <summary>`registrationDataDir`: data folder of the self-registration, refused when on the USB stick.</summary>
    public static string RegistrationDataDir(JsonObject raw, string baseDir)
    {
        var paths = GuiPaths(raw, baseDir);
        var watchPath = JsText.Trim(Text(raw, "watchPath"));
        if (watchPath.Length > 0)
        {
            AssertNotOnStick(Path.GetFullPath(watchPath, baseDir), new Dictionary<string, string> { ["dataDir"] = paths.DataDir, ["logDir"] = paths.LogDir });
        }
        return paths.DataDir;
    }

    /// <summary>
    /// `guiWritablePaths`: folders of the window process that are safe to write (the configured ones, or
    /// `fallbackDir` when they lie on the USB stick, with the message for the window).
    /// </summary>
    public static (string DataDir, string LogDir, string Level, string? Problem) GuiWritablePaths(JsonObject? raw, string baseDir, string fallbackDir)
    {
        var paths = GuiPaths(raw, baseDir);
        var watchPath = JsText.Trim(Text(raw, "watchPath"));
        if (watchPath.Length == 0) return (paths.DataDir, paths.LogDir, paths.Level, null);
        try
        {
            AssertNotOnStick(Path.GetFullPath(watchPath, baseDir), new Dictionary<string, string> { ["dataDir"] = paths.DataDir, ["logDir"] = paths.LogDir });
            return (paths.DataDir, paths.LogDir, paths.Level, null);
        }
        catch (ConfigException e)
        {
            return (Path.Combine(fallbackDir, "data"), Path.Combine(fallbackDir, "logs"), paths.Level,
                $"{e.Message}: correggi config.json (intanto finestra e log in {fallbackDir})");
        }
    }

    private static void WriteIfChanged(string file, JsonObject before, JsonObject after)
    {
        var a = after.ToJsonString(Json.Compact);
        if (a != before.ToJsonString(Json.Compact)) AtomicFile.Write(file, after.ToJsonString(Json.Indented) + "\n");
    }

    /// <summary>`saveTokenToFile`: saves `agentToken` keeping every other field; returns the saved token.</summary>
    public static string SaveToken(string file, string token)
    {
        var trimmed = JsText.Trim(token);
        if (!IsToken(trimmed)) throw new ConfigException(ConfigErrorCode.Invalid, $"Configurazione non valida: {TokenMessage}");
        var raw = ReadRaw(file);
        var merged = (JsonObject)raw.DeepClone();
        merged["agentToken"] = trimmed;
        WriteIfChanged(file, raw, merged);
        return trimmed;
    }

    /// <summary>`saveWatchPath`: sets `watchPath` (validated with `Parse` before writing) keeping every other field.</summary>
    public static AgentConfig SaveWatchPath(string file, string baseDir, string watchPath)
    {
        var raw = ReadRaw(file);
        var merged = (JsonObject)raw.DeepClone();
        merged["watchPath"] = watchPath;
        var config = Parse(merged, baseDir);
        WriteIfChanged(file, raw, merged);
        return config;
    }
}
