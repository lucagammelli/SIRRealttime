using System.Text;

namespace ArenaLive.Agent.Core;

/// <summary>
/// Decoding of a DVW file, identical to `decodeDvw` of `@arenalive/dvw-parser`: with the UTF-8 BOM, tolerant UTF-8
/// (invalid or truncated bytes become U+FFFD); without, UTF-8 if valid, otherwise Windows-1252 as iconv-lite does it
/// (the five bytes not defined by the code page become U+FFFD, not C1 controls as in .NET's code page 1252).
/// </summary>
public static class DvwDecoder
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);
    private static readonly UTF8Encoding LenientUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: false);

    /// <summary>Bytes 0x80-0x9F of Windows-1252 (iconv-lite table); the other bytes are the same code point.</summary>
    private static readonly char[] High =
    [
        '\u20AC', '\uFFFD', '\u201A', '\u0192', '\u201E', '\u2026', '\u2020', '\u2021',
        '\u02C6', '\u2030', '\u0160', '\u2039', '\u0152', '\uFFFD', '\u017D', '\uFFFD',
        '\uFFFD', '\u2018', '\u2019', '\u201C', '\u201D', '\u2022', '\u2013', '\u2014',
        '\u02DC', '\u2122', '\u0161', '\u203A', '\u0153', '\uFFFD', '\u017E', '\u0178',
    ];

    private static bool HasBom(ReadOnlySpan<byte> bytes) =>
        bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;

    /// <summary>Never throws.</summary>
    public static string Decode(ReadOnlySpan<byte> bytes)
    {
        if (HasBom(bytes))
        {
            var rest = bytes[3..];
            // TextDecoder drops a BOM at the start of what it decodes: a second BOM goes too.
            if (HasBom(rest)) rest = rest[3..];
            return LenientUtf8.GetString(rest);
        }
        try
        {
            return StrictUtf8.GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return DecodeWindows1252(bytes);
        }
    }

    public static string DecodeWindows1252(ReadOnlySpan<byte> bytes)
    {
        var chars = new char[bytes.Length];
        for (var i = 0; i < bytes.Length; i++)
        {
            var b = bytes[i];
            chars[i] = b is >= 0x80 and <= 0x9F ? High[b - 0x80] : (char)b;
        }
        return new string(chars);
    }
}
