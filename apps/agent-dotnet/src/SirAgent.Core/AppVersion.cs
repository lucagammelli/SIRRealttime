using System.Reflection;

namespace SirAgent.Core;

/// <summary>
/// Version of the agent: the one of the root package.json, put in the exe by scripts/costruisci-agente-dotnet.sh as
/// InformationalVersion `a.b.c+commit`. Shown in the title of the window and in the properties of the exe.
/// </summary>
public static class AppVersion
{
    /// <summary>`1.0.0+85952d0` becomes `1.0.0 (85952d0)`; without commit just `1.0.0`; empty becomes `0.0.0`.</summary>
    public static string Display(string? informational)
    {
        var text = (informational ?? "").Trim();
        if (text.Length == 0) return "0.0.0";
        var plus = text.IndexOf('+');
        if (plus < 0) return text;
        var version = text[..plus];
        var commit = text[(plus + 1)..];
        if (version.Length == 0) return "0.0.0";
        return commit.Length == 0 ? version : $"{version} ({commit})";
    }

    /// <summary>Version of this build, from the assembly (InformationalVersion).</summary>
    public static string Current { get; } = Display(
        typeof(AppVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
}
