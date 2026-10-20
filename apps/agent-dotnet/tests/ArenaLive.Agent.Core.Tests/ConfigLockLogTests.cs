using System.Text.Json;
using System.Text.Json.Nodes;

namespace ArenaLive.Agent.Core.Tests;

public sealed class ConfigTests
{
    private const string Token = "abcdefghijklmnopqrstuvwxyz012345";

    private static AgentConfig Parse(string json, string baseDir = "/base") => ConfigFile.Parse(JsonNode.Parse(json), baseDir);

    [Fact]
    public void Config_minima_con_i_default_del_Node()
    {
        var c = Parse($$"""{"watchPath":"/media/E","serverUrl":"https://sir.example.it/","agentToken":"{{Token}}"}""");
        Assert.Equal(1000, c.PollIntervalMs);
        Assert.Equal(700, c.StableMs);
        Assert.Equal("/base/data", c.DataDir);
        Assert.Equal("/base/logs", c.LogDir);
        Assert.Equal(300_000, c.SnapshotRetryMs);
        Assert.Equal(30, c.RetentionDays);
        Assert.Equal("info", c.LogLevel);
    }

    [Fact]
    public void Config_scaricata_dal_portale_e_quella_di_esempio_sono_accettate()
    {
        var example = JsonNode.Parse(File.ReadAllText(Path.Combine(Repo.Root, "apps", "agent", "config.example.json")))!.AsObject();
        Assert.Equal(
            ["agentToken", "dataDir", "logDir", "logLevel", "pollIntervalMs", "retentionDays", "serverUrl", "snapshotRetryMs", "stableMs", "watchPath"],
            example.Select(kv => kv.Key).Order(StringComparer.Ordinal).ToArray());
        example["agentToken"] = Token;
        example["watchPath"] = "/media/E";
        example["dataDir"] = "/srv/data";
        example["logDir"] = "/srv/logs";
        Assert.Equal(300_000, ConfigFile.Parse(example, "/base").SnapshotRetryMs);
    }

    [Theory]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://x.it","agentToken":"T","extra":1}""", "campo sconosciuto")]
    [InlineData("""{"watchPath":"/w","serverUrl":"http://sir.example.it","agentToken":"T"}""", "http rifiutato")]
    [InlineData("""{"watchPath":"/w","serverUrl":"http://192.168.1.10:8085","agentToken":"T"}""", "allowHttpPrivateNetwork")]
    [InlineData("""{"watchPath":"/w","serverUrl":"ftp://x.it","agentToken":"T"}""", "deve usare https")]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://u:p@x.it","agentToken":"T"}""", "credenziali")]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://x.it","agentToken":"corto"}""", "agentToken non valido")]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://x.it","agentToken":"T","pollIntervalMs":5}""", "pollIntervalMs")]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://x.it","agentToken":"T","stableMs":1.5}""", "stableMs")]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://x.it","agentToken":"T","logLevel":"verbose"}""", "logLevel")]
    [InlineData("""{"watchPath":"/w","serverUrl":"https://x.it","agentToken":"T","dataDir":"/w/data"}""", "dataDir non può stare dentro watchPath")]
    [InlineData("""{"watchPath":"/w/partita.dvw","serverUrl":"https://x.it","agentToken":"T","logDir":"/W/logs"}""", "logDir non può stare dentro watchPath")]
    public void Config_non_valide_con_messaggio_chiaro(string json, string message)
    {
        var e = Assert.Throws<ConfigException>(() => Parse(json.Replace("\"T\"", $"\"{Token}\"", StringComparison.Ordinal)));
        Assert.Contains(message, e.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("http://localhost:8090", false, true)]
    [InlineData("http://127.0.0.1:8090", false, true)]
    [InlineData("http://[::1]:8090", false, true)]
    [InlineData("http://10.1.2.3", true, true)]
    [InlineData("http://172.31.0.1", true, true)]
    [InlineData("http://172.32.0.1", true, false)]
    [InlineData("http://0300.0250.0.1", true, true)]
    [InlineData("http://3232235777", true, true)]
    [InlineData("http://sir.lan", true, false)]
    [InlineData("https://sir.example.it/sub", false, true)]
    public void Regole_di_http_e_https_come_nel_Node(string url, bool allow, bool ok)
    {
        Assert.Null(ConfigFile.ServerUrlSyntaxProblem(url, out var parsed));
        Assert.Equal(ok, ConfigFile.ServerUrlProtocolProblem(parsed!, allow) is null);
    }

    [Fact]
    public void Url_delle_api_mantiene_il_prefisso()
    {
        Assert.Equal("https://sir.example.it/api/ingest", ServerUrls.Ingest("https://sir.example.it").ToString());
        Assert.Equal("https://sir.example.it/sir/api/ingest", ServerUrls.Ingest("https://sir.example.it/sir").ToString());
        Assert.Equal("https://sir.example.it/sir/api/agents/registrations/status", ServerUrls.Api("https://sir.example.it/sir/", "api/agents/registrations/status").ToString());
    }

    [Fact]
    public void Salvare_token_e_cartella_conserva_gli_altri_campi()
    {
        using var dir = new TempDir();
        var file = dir.File("config.json");
        File.WriteAllText(file, "\uFEFF{\"watchPath\":\"E:\\\\\",\"serverUrl\":\"https://sir.example.it/\",\"dataDir\":\"" + dir.File("data") + "\",\"logDir\":\"" + dir.File("logs") + "\"}");
        Assert.Throws<ConfigException>(() => ConfigFile.SaveToken(file, "no"));
        Assert.Equal(Token, ConfigFile.SaveToken(file, $"  {Token} "));
        var config = ConfigFile.SaveWatchPath(file, dir.Path, "/media/E");
        Assert.Equal("/media/E", config.WatchPath);
        var saved = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
        Assert.Equal(Token, saved["agentToken"]!.GetValue<string>());
        Assert.Equal("https://sir.example.it/", saved["serverUrl"]!.GetValue<string>());
        Assert.Equal((true, "2345"), ConfigFile.TokenInfo(saved));
        // Not valid: nothing written.
        var before = File.ReadAllText(file);
        Assert.Throws<ConfigException>(() => ConfigFile.SaveWatchPath(file, dir.Path, dir.Path));
        Assert.Equal(before, File.ReadAllText(file));
    }

    [Fact]
    public void Config_mancante_o_rotta()
    {
        using var dir = new TempDir();
        Assert.Contains("scaricalo dall'area admin", Assert.Throws<ConfigException>(() => ConfigFile.ReadRaw(dir.File("config.json"))).Message, StringComparison.Ordinal);
        File.WriteAllText(dir.File("config.json"), "{");
        Assert.Equal(ConfigErrorCode.InvalidJson, Assert.Throws<ConfigException>(() => ConfigFile.ReadRaw(dir.File("config.json"))).Code);
        File.WriteAllText(dir.File("config.json"), "[]");
        Assert.Equal(ConfigErrorCode.InvalidJson, Assert.Throws<ConfigException>(() => ConfigFile.ReadRaw(dir.File("config.json"))).Code);
    }

    [Fact]
    public void Cartelle_sulla_pennina_finiscono_nella_cartella_di_riserva()
    {
        var raw = JsonNode.Parse("""{"watchPath":"/media/E","dataDir":"/media/E/data"}""")!.AsObject();
        var paths = ConfigFile.GuiWritablePaths(raw, "/base", "/tmp/ArenaLiveAgent");
        Assert.Equal("/tmp/ArenaLiveAgent/data", paths.DataDir);
        Assert.Contains("dataDir non può stare dentro watchPath", paths.Problem, StringComparison.Ordinal);
    }
}

public sealed class LockTests
{
    [Fact]
    public void Un_solo_agente_per_cartella_dati()
    {
        using var dir = new TempDir();
        using var first = AgentLock.Acquire(dir.Path, pid: 4242, isAlive: _ => true);
        var e = Assert.Throws<LockHeldException>(() => AgentLock.Acquire(dir.Path, pid: 5151, isAlive: _ => true));
        Assert.Equal(4242, e.Pid);
        Assert.Contains("servizio ArenaLiveAgent", e.Message, StringComparison.Ordinal);
        first.Release();
        using var second = AgentLock.Acquire(dir.Path, pid: 5151, isAlive: _ => true);
        Assert.Contains("5151", File.ReadAllText(AgentLock.PathOf(dir.Path)), StringComparison.Ordinal);
    }

    [Fact]
    public void Lucchetto_stantio_sostituito()
    {
        using var dir = new TempDir();
        var file = AgentLock.PathOf(dir.Path);
        // Process gone.
        File.WriteAllText(file, $$"""{"pid":4242,"startedAt":"{{Json.IsoTime(DateTimeOffset.UtcNow)}}"}""");
        AgentLock.Acquire(dir.Path, pid: 1, isAlive: _ => false).Release();
        // Written before the boot.
        File.WriteAllText(file, """{"pid":4242,"startedAt":"2000-01-01T00:00:00.000Z"}""");
        AgentLock.Acquire(dir.Path, pid: 1, isAlive: _ => true).Release();
        // Unreadable.
        File.WriteAllText(file, "rotto");
        AgentLock.Acquire(dir.Path, pid: 1, isAlive: _ => true).Release();
        // Our own pid.
        File.WriteAllText(file, $$"""{"pid":7,"startedAt":"{{Json.IsoTime(DateTimeOffset.UtcNow)}}"}""");
        using var own = AgentLock.Acquire(dir.Path, pid: 7, isAlive: _ => true);
        Assert.True(File.Exists(file));
    }

    [Fact]
    public void Il_rilascio_non_toglie_il_lucchetto_di_un_altro()
    {
        using var dir = new TempDir();
        var mine = AgentLock.Acquire(dir.Path, pid: 10, isAlive: _ => true);
        File.WriteAllText(AgentLock.PathOf(dir.Path), $$"""{"pid":11,"startedAt":"{{Json.IsoTime(DateTimeOffset.UtcNow)}}"}""");
        mine.Release();
        Assert.True(File.Exists(AgentLock.PathOf(dir.Path)));
    }

    [Fact]
    public async Task Il_servizio_aspetta_il_lucchetto_invece_di_uscire()
    {
        using var dir = new TempDir();
        File.WriteAllText(AgentLock.PathOf(dir.Path), $$"""{"pid":{{Environment.ProcessId + 100000}},"startedAt":"{{Json.IsoTime(DateTimeOffset.UtcNow)}}"}""");
        // That pid does not exist: the lock is stale and taken at once.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var held = await AgentLock.WaitAsync(dir.Path, _ => { }, cts.Token, TimeSpan.FromMilliseconds(10));
        Assert.NotNull(held);
    }

    [Fact]
    public void Processo_corrente_vivo()
    {
        Assert.True(AgentLock.IsProcessAlive(Environment.ProcessId));
        Assert.False(AgentLock.IsProcessAlive(int.MaxValue));
    }
}

public sealed class LogTests
{
    [Fact]
    public void Righe_json_come_pino_e_token_mai_scritti()
    {
        using var dir = new TempDir();
        var time = new ManualTime(DateTimeOffset.Parse("2026-10-17T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture));
        var entries = new List<LogEntry>();
        using (var log = new AgentLogger("info", new RotatingFileLog(dir.Path, time: time), time: time))
        {
            log.Entry += entries.Add;
            log.AddSecret("segretissimo-1234567890");
            log.Info("avvio", new Dictionary<string, object?> { ["agentToken"] = "x", ["nested"] = new Dictionary<string, object?> { ["secret"] = "y" }, ["n"] = 3 });
            log.Warn("token segretissimo-1234567890 nel messaggio");
            log.Debug("non scritto");
        }
        var lines = File.ReadAllLines(Path.Combine(dir.Path, "arenalive-agent-2026-10-17.log"));
        Assert.Equal(2, lines.Length);
        var first = JsonDocument.Parse(lines[0]).RootElement;
        Assert.Equal(30, first.GetProperty("level").GetInt32());
        Assert.Equal("arenalive-agent", first.GetProperty("app").GetString());
        Assert.Equal("[nascosto]", first.GetProperty("agentToken").GetString());
        Assert.Equal("[nascosto]", first.GetProperty("nested").GetProperty("secret").GetString());
        Assert.DoesNotContain("segretissimo", string.Join("\n", lines), StringComparison.Ordinal);
        Assert.Equal("token [nascosto] nel messaggio", entries[1].Message);
    }

    [Fact]
    public void Rotazione_per_dimensione_giorno_e_pulizia()
    {
        using var dir = new TempDir();
        File.WriteAllText(Path.Combine(dir.Path, "arenalive-agent-2026-09-01.log"), "vecchio");
        File.WriteAllText(Path.Combine(dir.Path, "altro.log"), "resta");
        var time = new ManualTime(DateTimeOffset.Parse("2026-10-17T23:59:00Z", System.Globalization.CultureInfo.InvariantCulture));
        using var file = new RotatingFileLog(dir.Path, maxBytes: 100, time: time);
        for (var i = 0; i < 5; i++) file.WriteLine(new string('x', 60));
        Assert.True(File.Exists(Path.Combine(dir.Path, "arenalive-agent-2026-10-17.1.log")));
        time.Advance(TimeSpan.FromMinutes(2));
        file.WriteLine("domani");
        Assert.Equal("domani\n", File.ReadAllText(Path.Combine(dir.Path, "arenalive-agent-2026-10-18.log")));
        Assert.False(File.Exists(Path.Combine(dir.Path, "arenalive-agent-2026-09-01.log")));
        Assert.True(File.Exists(Path.Combine(dir.Path, "altro.log")));
    }
}

public sealed class CliTests
{
    [Theory]
    [InlineData(new string[0], RunMode.Window)]
    [InlineData(new[] { "--gui" }, RunMode.Window)]
    [InlineData(new[] { "--config", "c.json" }, RunMode.Continuous)]
    [InlineData(new[] { "--console" }, RunMode.Continuous)]
    [InlineData(new[] { "--once", "--config", "c.json" }, RunMode.Once)]
    [InlineData(new[] { "--service" }, RunMode.Service)]
    [InlineData(new[] { "--help" }, RunMode.Help)]
    public void Modi_dell_eseguibile(string[] args, RunMode mode) => Assert.Equal(mode, Cli.Parse(args).Mode);

    [Theory]
    [InlineData("--gui", "--once")]
    [InlineData("--gui", "--console")]
    [InlineData("--service", "--once")]
    [InlineData("--boh", "")]
    [InlineData("--config", "")]
    public void Combinazioni_rifiutate(string a, string b) =>
        Assert.Throws<CliException>(() => Cli.Parse(b.Length > 0 ? [a, b] : [a]));

    [Fact]
    public async Task Once_con_config_non_valida_esce_con_1()
    {
        using var dir = new TempDir();
        using var err = new StringWriter();
        var code = await HeadlessRunner.RunAsync(new CliOptions(RunMode.Once, dir.File("manca.json"), false), dir.Path, err, null, CancellationToken.None);
        Assert.Equal(1, code);
        Assert.Contains("non trovato", err.ToString(), StringComparison.Ordinal);
    }
}
