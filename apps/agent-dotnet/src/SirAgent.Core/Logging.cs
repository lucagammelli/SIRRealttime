using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SirAgent.Core;

public enum LogLevel
{
    Trace = 10,
    Debug = 20,
    Info = 30,
    Warn = 40,
    Error = 50,
    Fatal = 60,
}

/// <summary>One line of the log, as shown in the window.</summary>
public sealed record LogEntry(string Time, string Level, string Message);

/// <summary>Logger of the agent: JSON lines in the same format of pino (the Node agent), never a token.</summary>
public interface ILog
{
    void Write(LogLevel level, string message, IReadOnlyDictionary<string, object?>? fields = null);
}

public static class LogExtensions
{
    public static void Info(this ILog log, string message, IReadOnlyDictionary<string, object?>? fields = null) => log.Write(LogLevel.Info, message, fields);
    public static void Warn(this ILog log, string message, IReadOnlyDictionary<string, object?>? fields = null) => log.Write(LogLevel.Warn, message, fields);
    public static void Error(this ILog log, string message, IReadOnlyDictionary<string, object?>? fields = null) => log.Write(LogLevel.Error, message, fields);
    public static void Debug(this ILog log, string message, IReadOnlyDictionary<string, object?>? fields = null) => log.Write(LogLevel.Debug, message, fields);
    public static void Fatal(this ILog log, string message, IReadOnlyDictionary<string, object?>? fields = null) => log.Write(LogLevel.Fatal, message, fields);
}

/// <summary>
/// Destination of `sir-agent-YYYY-MM-DD.log` per UTC day (same names as the Node agent), a new part `.1`, `.2`…
/// beyond `maxBytes`, files older than `keepDays` deleted. A write error is swallowed: logging never stops the agent.
/// </summary>
public sealed partial class RotatingFileLog : IDisposable
{
    private readonly string _dir;
    private readonly long _maxBytes;
    private readonly int _keepDays;
    private readonly TimeProvider _time;
    private readonly Lock _gate = new();
    private FileStream? _stream;
    private string _day = "";
    private int _part;
    private long _size;

    [GeneratedRegex(@"^sir-agent-([0-9]{4}-[0-9]{2}-[0-9]{2})(?:\.([0-9]+))?\.log\z")]
    private static partial Regex FilePattern();

    public RotatingFileLog(string dir, long maxBytes = 10 * 1024 * 1024, int keepDays = 14, TimeProvider? time = null)
    {
        _dir = dir;
        _maxBytes = maxBytes;
        _keepDays = keepDays;
        _time = time ?? TimeProvider.System;
    }

    public string CurrentFile => Path.Combine(_dir, FileName(_day, _part));

    public void WriteLine(string line)
    {
        lock (_gate)
        {
            try
            {
                var day = _time.GetUtcNow().UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
                if (_stream is null || day != _day || _size >= _maxBytes) Rotate(day);
                if (_stream is null) return;
                var bytes = Encoding.UTF8.GetBytes(line + "\n");
                _stream.Write(bytes);
                _stream.Flush();
                _size += bytes.Length;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                CloseStream();
            }
        }
    }

    private static string FileName(string day, int part) => $"sir-agent-{day}{(part > 0 ? $".{part}" : "")}.log";

    private void Rotate(string day)
    {
        CloseStream();
        Directory.CreateDirectory(_dir);
        if (day != _day)
        {
            _day = day;
            _part = 0;
            Prune();
        }
        while (true)
        {
            var file = Path.Combine(_dir, FileName(day, _part));
            var size = File.Exists(file) ? new FileInfo(file).Length : 0;
            if (size < _maxBytes)
            {
                _stream = new FileStream(file, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                _size = size;
                return;
            }
            _part++;
        }
    }

    private void Prune()
    {
        var limit = (_time.GetUtcNow() - TimeSpan.FromDays(_keepDays)).UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        foreach (var file in Directory.GetFiles(_dir))
        {
            var m = FilePattern().Match(Path.GetFileName(file));
            if (m.Success && string.CompareOrdinal(m.Groups[1].Value, limit) < 0) AtomicFile.Delete(file);
        }
    }

    private void CloseStream()
    {
        try
        {
            _stream?.Dispose();
        }
        catch (IOException)
        {
            // already closed
        }
        _stream = null;
    }

    public void Dispose()
    {
        lock (_gate) CloseStream();
    }
}

/// <summary>
/// The logger: pino-compatible JSON lines (`level`, `time`, `app`, fields, `msg`) to the file and, if wanted, to the
/// console and to the window. Fields named like a token (`REDACT_PATHS` of the Node agent) are written as
/// `[nascosto]`, and every known secret is replaced in the whole line as a second line of defence.
/// </summary>
public sealed class AgentLogger : ILog, IDisposable
{
    public const string Redacted = "[nascosto]";
    private static readonly HashSet<string> RedactKeys = new(StringComparer.Ordinal) { "agentToken", "authorization", "secret", "token" };

    private readonly LogLevel _min;
    private readonly bool _silent;
    private readonly RotatingFileLog? _file;
    private readonly TextWriter? _console;
    private readonly TimeProvider _time;
    private readonly Lock _gate = new();
    private readonly HashSet<string> _secrets = new(StringComparer.Ordinal);

    public AgentLogger(string level, RotatingFileLog? file, TextWriter? console = null, TimeProvider? time = null)
    {
        _silent = level == "silent";
        _min = ParseLevel(level);
        _file = file;
        _console = console;
        _time = time ?? TimeProvider.System;
    }

    /// <summary>Copy of every line for the window (same level, same redaction).</summary>
    public event Action<LogEntry>? Entry;

    public static LogLevel ParseLevel(string level) => level switch
    {
        "trace" => LogLevel.Trace,
        "debug" => LogLevel.Debug,
        "warn" => LogLevel.Warn,
        "error" => LogLevel.Error,
        "fatal" or "silent" => LogLevel.Fatal,
        _ => LogLevel.Info,
    };

    public static string LevelName(LogLevel level) => level switch
    {
        LogLevel.Trace => "trace",
        LogLevel.Debug => "debug",
        LogLevel.Warn => "warn",
        LogLevel.Error => "error",
        LogLevel.Fatal => "fatal",
        _ => "info",
    };

    /// <summary>A secret (token, registration secret) never written, even inside a message.</summary>
    public void AddSecret(string? secret)
    {
        if (string.IsNullOrEmpty(secret) || secret.Length < 4) return;
        lock (_gate) _secrets.Add(secret);
    }

    public string Redact(string text)
    {
        lock (_gate)
        {
            foreach (var s in _secrets)
            {
                if (text.Contains(s, StringComparison.Ordinal)) text = text.Replace(s, Redacted, StringComparison.Ordinal);
            }
        }
        return text;
    }

    private static JsonNode? ToNode(string key, object? value, int depth)
    {
        if (RedactKeys.Contains(key)) return JsonValue.Create(Redacted);
        return value switch
        {
            null => null,
            string s => JsonValue.Create(s),
            bool b => JsonValue.Create(b),
            int i => JsonValue.Create(i),
            long l => JsonValue.Create(l),
            double d => JsonValue.Create(d),
            IReadOnlyDictionary<string, object?> map when depth < 2 => ToObject(map, depth + 1),
            IEnumerable<string> list => new JsonArray([.. list.Select(x => (JsonNode?)JsonValue.Create(x))]),
            _ => JsonValue.Create(Convert.ToString(value, CultureInfo.InvariantCulture)),
        };
    }

    private static JsonObject ToObject(IReadOnlyDictionary<string, object?> map, int depth)
    {
        var o = new JsonObject();
        foreach (var (k, v) in map) o[k] = ToNode(k, v, depth);
        return o;
    }

    public void Write(LogLevel level, string message, IReadOnlyDictionary<string, object?>? fields = null)
    {
        if (_silent || level < _min) return;
        var time = Json.IsoTime(_time.GetUtcNow());
        var line = new JsonObject { ["level"] = (int)level, ["time"] = time, ["app"] = "sir-agent" };
        if (fields is not null)
        {
            foreach (var (k, v) in fields)
            {
                if (k is "level" or "time" or "app" or "msg") continue;
                line[k] = ToNode(k, v, 0);
            }
        }
        line["msg"] = message;
        var text = Redact(line.ToJsonString(Json.Compact));
        _file?.WriteLine(text);
        if (_console is not null)
        {
            lock (_gate) _console.WriteLine(text);
        }
        Entry?.Invoke(new LogEntry(time, LevelName(level), Redact(message)));
    }

    public void Dispose() => _file?.Dispose();
}

/// <summary>Last `max` messages of the log, for the window (`LogSink`).</summary>
public sealed class LogSink(int max = 200)
{
    private readonly Queue<LogEntry> _recent = new();
    private readonly Lock _gate = new();

    public event Action<LogEntry>? Message;

    public void Add(LogEntry entry)
    {
        lock (_gate)
        {
            _recent.Enqueue(entry);
            while (_recent.Count > max) _recent.Dequeue();
        }
        Message?.Invoke(entry);
    }

    public List<LogEntry> Recent()
    {
        lock (_gate) return [.. _recent];
    }
}
