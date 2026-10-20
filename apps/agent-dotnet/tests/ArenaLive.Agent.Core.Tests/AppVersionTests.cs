namespace ArenaLive.Agent.Core.Tests;

/// <summary>The version shown by the window comes from the InformationalVersion put in by the build script.</summary>
public sealed class AppVersionTests
{
    [Theory]
    [InlineData("1.0.0+85952d0", "1.0.0 (85952d0)")]
    [InlineData("1.0.0", "1.0.0")]
    [InlineData("1.0.0+", "1.0.0")]
    [InlineData("+abc", "0.0.0")]
    [InlineData("", "0.0.0")]
    [InlineData(null, "0.0.0")]
    public void Display_formatta_la_versione_informativa(string? informational, string atteso)
    {
        Assert.Equal(atteso, AppVersion.Display(informational));
    }

    [Fact]
    public void Current_non_e_vuota()
    {
        Assert.False(string.IsNullOrWhiteSpace(AppVersion.Current));
    }
}
