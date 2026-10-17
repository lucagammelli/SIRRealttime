using System.Text;

namespace SirAgent.Core;

/// <summary>
/// Text rules of JavaScript reproduced exactly (the Node agent and the server use them): `\s`, `trim()`, line
/// terminators of the `m` flag. .NET has slightly different sets (e.g. U+FEFF is not white space for .NET), and a
/// different character would change the matchKey or the split of the file.
/// </summary>
public static class JsText
{
    /// <summary>JavaScript `\s` (WhiteSpace and LineTerminator of ECMA-262).</summary>
    public static bool IsSpace(char c) =>
        c is '\t' or '\n' or '\u000B' or '\f' or '\r' or ' ' or '\u00A0' or '\u1680' or '\u2028' or '\u2029'
            or '\u202F' or '\u205F' or '\u3000' or '\uFEFF'
        || (c >= '\u2000' && c <= '\u200A');

    /// <summary>Line terminators of ECMA-262 (where `^` and `$` match with the `m` flag).</summary>
    public static bool IsLineTerminator(char c) => c is '\n' or '\r' or '\u2028' or '\u2029';

    /// <summary>`String.prototype.trim()`.</summary>
    public static string Trim(string value)
    {
        var start = 0;
        var end = value.Length;
        while (start < end && IsSpace(value[start])) start++;
        while (end > start && IsSpace(value[end - 1])) end--;
        return value.Substring(start, end - start);
    }

    /// <summary>`value.replace(/\s+/g, ' ')`.</summary>
    public static string CollapseSpaces(string value)
    {
        var sb = new StringBuilder(value.Length);
        var inSpace = false;
        foreach (var c in value)
        {
            if (IsSpace(c))
            {
                if (!inSpace) sb.Append(' ');
                inSpace = true;
            }
            else
            {
                sb.Append(c);
                inSpace = false;
            }
        }
        return sb.ToString();
    }

    /// <summary>True when the whole string is JavaScript white space (also empty).</summary>
    public static bool IsBlank(string value)
    {
        foreach (var c in value)
        {
            if (!IsSpace(c)) return false;
        }
        return true;
    }
}
