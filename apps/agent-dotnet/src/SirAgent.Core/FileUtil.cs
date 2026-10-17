using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace SirAgent.Core;

/// <summary>JSON settings shared by files and requests (property names are fixed with attributes).</summary>
public static class Json
{
    /// <summary>Compact, characters not escaped beyond what JSON requires (files stay readable).</summary>
    public static readonly JsonSerializerOptions Compact = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    /// <summary>Indented with two spaces, as `JSON.stringify(value, null, 2)` (config.json).</summary>
    public static readonly JsonSerializerOptions Indented = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = true,
        IndentSize = 2,
    };

    /// <summary>`Date.prototype.toISOString()`: UTC with milliseconds and `Z`.</summary>
    public static string IsoTime(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>`Date.parse` of an ISO 8601 time, or null.</summary>
    public static DateTimeOffset? ParseIsoTime(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var t)
            ? t
            : null;

    /// <summary>Text of a JSON file without a leading BOM (tolerated, as in the Node agent).</summary>
    public static string WithoutBom(string text) => text.StartsWith('\uFEFF') ? text[1..] : text;
}

public static class AtomicFile
{
    private static readonly UTF8Encoding Utf8NoBom = new(false);

    /// <summary>
    /// Writes `data` to `file` atomically: temporary file flushed to disk, then renamed over the old one. On Windows an
    /// antivirus or an indexer can hold the target for a moment: up to 5 new attempts.
    /// </summary>
    public static void Write(string file, string data)
    {
        var tmp = file + ".tmp";
        using (var stream = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var bytes = Utf8NoBom.GetBytes(data);
            stream.Write(bytes);
            stream.Flush(flushToDisk: true);
        }
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                File.Move(tmp, file, overwrite: true);
                return;
            }
            catch (Exception e) when (attempt < 5 && e is IOException or UnauthorizedAccessException)
            {
                Thread.Sleep(50 * (attempt + 1));
            }
        }
    }

    /// <summary>Deletes `file` if it exists (as `rm -f`).</summary>
    public static void Delete(string file)
    {
        try
        {
            File.Delete(file);
        }
        catch (DirectoryNotFoundException)
        {
            // nothing to delete
        }
    }
}
