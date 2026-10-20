using System.Buffers.Binary;
using System.Text.Json;

namespace ArenaLive.Agent.Core;

/// <summary>Graphics of the window: colours already validated (`#rrggbb`), logo checked on its bytes.</summary>
public sealed record WindowBranding(string Name, string Primary, string OnPrimary, string? LogoPath);

public sealed record BrandingRead(WindowBranding? Branding, IReadOnlyList<string> Problems);

/// <summary>
/// `branding.json` and `logo.png`/`logo.jpg` next to the executable (zip downloaded from the portal), read as the Node
/// agent does (`readWindowBranding`): a missing or invalid file never stops the window.
/// </summary>
public static class Branding
{
    public const string BrandingFile = "branding.json";

    /// <summary>Logos of ArenaLive embedded in the window: positive (dark text) and negative (white text).</summary>
    public const string ProductLogoPositive = "arenalive-positivo.png";
    public const string ProductLogoNegative = "arenalive-negativo.png";

    /// <summary>
    /// Pure: the logo of ArenaLive meant for a background (`pickSystemLogo` of @arenalive/shared): the negative one when
    /// the WCAG relative luminance is below 0.5, the positive one otherwise.
    /// </summary>
    public static string ProductLogoFor(byte r, byte g, byte b)
    {
        static double Channel(byte c)
        {
            var s = c / 255.0;
            return s <= 0.04045 ? s / 12.92 : Math.Pow((s + 0.055) / 1.055, 2.4);
        }
        var luminance = 0.2126 * Channel(r) + 0.7152 * Channel(g) + 0.0722 * Channel(b);
        return luminance < 0.5 ? ProductLogoNegative : ProductLogoPositive;
    }
    private const int MaxBrandingBytes = 16 * 1024;
    private static readonly string[] ColorNames = ["primary", "onPrimary", "accent", "onAccent", "background", "onBackground"];

    /// <summary>`HexColorSchema` after its `trim().toLowerCase()`: `#rrggbb`.</summary>
    private static string? HexColor(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.String) return null;
        var v = JsLower.ToLower(JsText.Trim(e.GetString() ?? ""));
        return v.Length == 7 && v[0] == '#' && v[1..].All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f') ? v : null;
    }

    /// <summary>`AgentBrandingSchema` (strict objects): name and the six colours, or null.</summary>
    public static (string Name, Dictionary<string, string> Colors)? ParseBranding(string text)
    {
        try
        {
            using var doc = JsonDocument.Parse(Json.WithoutBom(text));
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var keys = root.EnumerateObject().Select(p => p.Name).ToList();
            if (keys.Count != 3 || !keys.Contains("version") || !keys.Contains("name") || !keys.Contains("colors")) return null;
            if (root.GetProperty("version") is not { ValueKind: JsonValueKind.Number } version || !version.TryGetInt32(out var v) || v != Contract.AgentBrandingVersion) return null;
            var nameEl = root.GetProperty("name");
            var name = nameEl.ValueKind == JsonValueKind.String ? RegistrationFormats.PlainText(nameEl.GetString()) : null;
            if (name is null) return null;
            var colorsEl = root.GetProperty("colors");
            if (colorsEl.ValueKind != JsonValueKind.Object) return null;
            var colors = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var p in colorsEl.EnumerateObject())
            {
                if (!ColorNames.Contains(p.Name) || HexColor(p.Value) is not { } color) return null;
                colors[p.Name] = color;
            }
            return colors.Count == ColorNames.Length ? (name, colors) : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>`imageSize`: width and height of a PNG (IHDR) or a JPEG (SOF marker), or null.</summary>
    public static (int Width, int Height)? ImageSize(ReadOnlySpan<byte> data, bool png)
    {
        if (png)
        {
            ReadOnlySpan<byte> signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            if (data.Length < 24 || !data[..8].SequenceEqual(signature) || !data[12..16].SequenceEqual("IHDR"u8)) return null;
            var w = BinaryPrimitives.ReadUInt32BigEndian(data[16..20]);
            var h = BinaryPrimitives.ReadUInt32BigEndian(data[20..24]);
            return w > int.MaxValue || h > int.MaxValue ? (int.MaxValue, int.MaxValue) : ((int)w, (int)h);
        }
        if (data.Length < 4 || data[0] != 0xFF || data[1] != 0xD8) return null;
        var at = 2;
        while (at + 9 <= data.Length)
        {
            if (data[at] != 0xFF) return null;
            var marker = data[at + 1];
            if (marker == 0xFF)
            {
                at += 1;
                continue;
            }
            var length = BinaryPrimitives.ReadUInt16BigEndian(data[(at + 2)..]);
            if (marker is >= 0xC0 and <= 0xCF && marker is not (0xC4 or 0xC8 or 0xCC))
            {
                return (BinaryPrimitives.ReadUInt16BigEndian(data[(at + 7)..]), BinaryPrimitives.ReadUInt16BigEndian(data[(at + 5)..]));
            }
            if (marker is 0xD9 or 0xDA || length < 2) return null;
            at += 2 + length;
        }
        return null;
    }

    private static (string? Path, string? Problem) ReadLogo(string baseDir)
    {
        foreach (var (name, png) in new[] { ("logo.png", true), ("logo.jpg", false) })
        {
            var path = Path.Combine(baseDir, name);
            FileInfo info;
            try
            {
                info = new FileInfo(path);
                if (!info.Exists && !Directory.Exists(path)) continue;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return (null, $"{name} illeggibile: logo non mostrato");
            }
            if (!info.Exists || info.LinkTarget is not null) return (null, $"{name} non è un file: logo non mostrato");
            if (info.Length > Contract.AgentLogoMaxBytes) return (null, $"{name} supera 2 MB: logo non mostrato");
            byte[] data;
            try
            {
                data = File.ReadAllBytes(path);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return (null, $"{name} illeggibile: logo non mostrato");
            }
            var size = data.Length <= Contract.AgentLogoMaxBytes ? ImageSize(data, png) : null;
            if (size is null || size.Value.Width == 0 || size.Value.Height == 0) return (null, $"{name} non è un'immagine valida: logo non mostrato");
            if (size.Value.Width > Contract.AgentLogoMaxSide || size.Value.Height > Contract.AgentLogoMaxSide)
            {
                return (null, $"{name} supera {Contract.AgentLogoMaxSide}×{Contract.AgentLogoMaxSide} pixel: logo non mostrato");
            }
            return (path, null);
        }
        return (null, null);
    }

    public static BrandingRead Read(string baseDir)
    {
        var file = Path.Combine(baseDir, BrandingFile);
        string text;
        try
        {
            var info = new FileInfo(file);
            if (!info.Exists)
            {
                if (!Directory.Exists(file)) return new BrandingRead(null, []);
                return new BrandingRead(null, [$"{BrandingFile} non valido: grafica predefinita"]);
            }
            if (info.LinkTarget is not null || info.Length > MaxBrandingBytes) return new BrandingRead(null, [$"{BrandingFile} non valido: grafica predefinita"]);
            text = File.ReadAllText(file);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new BrandingRead(null, [$"{BrandingFile} illeggibile: grafica predefinita"]);
        }
        bool isJson;
        try
        {
            using var _ = JsonDocument.Parse(Json.WithoutBom(text));
            isJson = true;
        }
        catch (JsonException)
        {
            isJson = false;
        }
        if (!isJson) return new BrandingRead(null, [$"{BrandingFile} non è un JSON valido: grafica predefinita"]);
        var parsed = ParseBranding(text);
        if (parsed is null) return new BrandingRead(null, [$"{BrandingFile} non valido: grafica predefinita"]);
        var logo = ReadLogo(baseDir);
        var (name, colors) = parsed.Value;
        return new BrandingRead(new WindowBranding(name, colors["primary"], colors["onPrimary"], logo.Path), logo.Problem is null ? [] : [logo.Problem]);
    }
}
