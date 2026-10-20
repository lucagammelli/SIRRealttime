using System.Net;
using System.Text;
using System.Text.Json.Nodes;

namespace ArenaLive.Agent.Core.Tests;

/// <summary>The loop of the agent against a fake server: same behaviour as the Node agent.</summary>
public sealed class AgentTests : IDisposable
{
    private const string Token = "tokenAgente_0123456789abcdef";
    private readonly TempDir _dir = new();
    private readonly ManualTime _time = new(DateTimeOffset.Parse("2026-10-17T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture));
    private readonly NullLog _log = new();
    private readonly string _dvw;
    private readonly byte[] _original = File.ReadAllBytes(Path.Combine(Repo.Root, "packages", "dvw-parser", "test", "fixtures", "partita.dvw"));

    public AgentTests()
    {
        Directory.CreateDirectory(Path.Combine(_dir.Path, "pennina"));
        _dvw = Path.Combine(_dir.Path, "pennina", "partita.dvw");
        File.WriteAllBytes(_dvw, _original);
    }

    public void Dispose() => _dir.Dispose();

    private AgentConfig Config => new()
    {
        WatchPath = Path.Combine(_dir.Path, "pennina"),
        ServerUrl = "https://sir.example.it/",
        AgentToken = Token,
        StableMs = 0,
        DataDir = Path.Combine(_dir.Path, "data"),
        LogDir = Path.Combine(_dir.Path, "logs"),
    };

    private Agent NewAgent(FakeHandler handler) =>
        Agent.Create(Config, _log, new HttpClient(handler), new AgentTiming { RereadMs = 0 }, _time, () => 0.5);

    private async Task Step(Agent agent, int times = 1)
    {
        for (var i = 0; i < times; i++)
        {
            _time.Advance(TimeSpan.FromSeconds(1));
            await agent.StepAsync();
        }
    }

    private void AppendLine(string line) => File.AppendAllText(_dvw, line + "\r\n", Encoding.Latin1);

    [Fact]
    public async Task Snapshot_poi_append_con_seq_crescente_e_token_solo_nell_intestazione()
    {
        var handler = new FakeHandler(FakeHandler.AcceptIngest);
        var agent = NewAgent(handler);
        await Step(agent);
        AppendLine("*p02:00;;;;;;;18.00.20;1;1;6;1;120;;7;14;18;2;17;12;6;8;5;3;9;11;");
        await Step(agent);
        Assert.Equal(2, handler.Seen.Count);
        var first = JsonNode.Parse(handler.Seen[0].Body)!.AsObject();
        var second = JsonNode.Parse(handler.Seen[1].Body)!.AsObject();
        Assert.Equal("snapshot", first["kind"]!.GetValue<string>());
        Assert.Equal(0, first["seq"]!.GetValue<int>());
        Assert.Equal("append", second["kind"]!.GetValue<string>());
        Assert.Equal(1, second["seq"]!.GetValue<int>());
        Assert.Equal(19, second["fromIndex"]!.GetValue<int>());
        Assert.Null(second["header"]);
        Assert.All(handler.Seen, r =>
        {
            Assert.Equal($"Bearer {Token}", r.Authorization);
            Assert.Equal("https://sir.example.it/api/ingest", r.Url.ToString());
            Assert.DoesNotContain(Token, r.Body, StringComparison.Ordinal);
            Assert.True(Repo.IsValid("ingest-request.schema.json", r.Body));
        });
        var status = agent.Status();
        Assert.Equal(20, status.Lines);
        Assert.Equal(0, status.Queue);
        Assert.Equal("10-01-2026_18-00-00_pci_osp_0f451be797", status.MatchKey);
        Assert.DoesNotContain(_log.Lines, l => (l.Message + string.Join(",", l.Fields?.Values ?? [])).Contains(Token, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Riga_passata_corretta_diventa_snapshot()
    {
        var handler = new FakeHandler(FakeHandler.AcceptIngest);
        var agent = NewAgent(handler);
        await Step(agent);
        var text = Encoding.Latin1.GetString(_original).Replace("*07RQ+;", "*07RQ#;", StringComparison.Ordinal);
        File.WriteAllText(_dvw, text, Encoding.Latin1);
        await Step(agent);
        var last = JsonNode.Parse(handler.Seen[^1].Body)!.AsObject();
        Assert.Equal("snapshot", last["kind"]!.GetValue<string>());
        Assert.Equal(1, last["seq"]!.GetValue<int>());
    }

    [Fact]
    public async Task Rete_assente_la_coda_resta_su_disco_e_riparte()
    {
        var online = false;
        var handler = new FakeHandler(r => online ? FakeHandler.AcceptIngest(r) : throw new HttpRequestException("rete assente"));
        var agent = NewAgent(handler);
        await Step(agent);
        AppendLine("*p02:00;;;;;;;18.00.20;1;1;6;1;120;;7;14;18;2;17;12;6;8;5;3;9;11;");
        await Step(agent);
        Assert.Equal(2, agent.Status().Queue);
        Assert.False(agent.Status().ServerReachable);
        Assert.True(_log.Has("server non raggiungibile: i dati restano in coda"));
        // A new agent (restart) takes the queue from disk.
        online = true;
        var restarted = NewAgent(handler);
        Assert.True(_log.Has("coda ripresa dal disco"));
        _time.Advance(TimeSpan.FromMinutes(1));
        await Step(restarted, 2);
        Assert.Equal(0, restarted.Status().Queue);
        var sent = handler.Seen.Skip(2).Select(r => JsonNode.Parse(r.Body)!["seq"]!.GetValue<int>()).ToList();
        Assert.Equal(sent.Order().ToList(), sent);
    }

    [Fact]
    public async Task Risposta_401_registrazione_scaduta()
    {
        var handler = new FakeHandler(_ => FakeHandler.Json(HttpStatusCode.Unauthorized, $$"""{"error":"{{Contract.AgentExpiredError}}"}"""));
        var agent = NewAgent(handler);
        await Step(agent);
        Assert.True(agent.Status().RegistrationExpired);
        Assert.Equal(1, agent.Status().Queue);
        Assert.True(_log.Has("Registrazione scaduta: registrati di nuovo: nuovo tentativo tra 60 s, la coda è conservata"));
        // Token revoked (generic 401): not "expired".
        var revoked = new FakeHandler(_ => FakeHandler.Json(HttpStatusCode.Unauthorized, """{"error":"Token non valido"}"""));
        var other = NewAgent(revoked);
        _time.Advance(TimeSpan.FromMinutes(2));
        await Step(other);
        Assert.False(other.Status().RegistrationExpired);
        Assert.True(_log.Has("token agente non valido o revocato"));
    }

    [Fact]
    public async Task NeedSnapshot_riallinea_con_uno_snapshot_oltre_il_seq_del_server()
    {
        var calls = 0;
        var handler = new FakeHandler(r =>
        {
            calls++;
            return calls == 2
                ? FakeHandler.Json(HttpStatusCode.OK, """{"status":"needSnapshot","seq":41,"lineCount":0}""")
                : FakeHandler.AcceptIngest(r);
        });
        var agent = NewAgent(handler);
        await Step(agent);
        AppendLine("*p02:00;;;;;;;18.00.20;1;1;6;1;120;;7;14;18;2;17;12;6;8;5;3;9;11;");
        await Step(agent);
        await Step(agent);
        var last = JsonNode.Parse(handler.Seen[^1].Body)!.AsObject();
        Assert.Equal("snapshot", last["kind"]!.GetValue<string>());
        Assert.Equal(42, last["seq"]!.GetValue<int>());
        Assert.True(_log.Has("server non allineato: invio uno snapshot"));
    }

    [Fact]
    public async Task Risposta_413_svuota_la_coda_e_riprova_lo_snapshot_piu_tardi()
    {
        var refuse = true;
        var handler = new FakeHandler(r => refuse ? new HttpResponseMessage(HttpStatusCode.RequestEntityTooLarge) : FakeHandler.AcceptIngest(r));
        var agent = NewAgent(handler);
        await Step(agent);
        Assert.Equal(0, agent.Status().Queue);
        refuse = false;
        _time.Advance(TimeSpan.FromMinutes(6));
        await Step(agent);
        Assert.True(_log.Has("nuovo tentativo dello snapshot rifiutato"));
        Assert.Equal("snapshot", JsonNode.Parse(handler.Seen[^1].Body)!["kind"]!.GetValue<string>());
    }

    [Fact]
    public async Task File_troncato_si_invia_solo_dopo_due_letture_uguali()
    {
        var handler = new FakeHandler(FakeHandler.AcceptIngest);
        var agent = NewAgent(handler);
        File.WriteAllBytes(_dvw, _original[..^25]);
        await Step(agent);
        Assert.Empty(handler.Seen);
        Assert.True(_log.Has("contenuto da confermare con una seconda lettura"));
        await Step(agent);
        Assert.Single(handler.Seen);
        Assert.True(_log.Has("contenuto confermato da due letture uguali"));
    }

    [Fact]
    public async Task Senza_scout_non_invia_mai_niente()
    {
        var handler = new FakeHandler(FakeHandler.AcceptIngest);
        var agent = NewAgent(handler);
        File.WriteAllText(_dvw, "[3MATCH]\n10/01/2026;18.00.00;\n");
        await Step(agent, 3);
        Assert.Empty(handler.Seen);
        Assert.True(_log.Has("lettura incompleta, attendo la prossima scrittura"));
    }

    [Fact]
    public async Task Once_esce_con_0_quando_tutto_e_inviato()
    {
        var handler = new FakeHandler(FakeHandler.AcceptIngest);
        var agent = Agent.Create(Config with { PollIntervalMs = 10 }, _log, new HttpClient(handler));
        Assert.Equal(0, await agent.RunOnceAsync(5000, CancellationToken.None));
        var offline = Agent.Create(Config with { PollIntervalMs = 10, DataDir = Path.Combine(_dir.Path, "data2") }, _log, new HttpClient(new FakeHandler(_ => throw new HttpRequestException("giù"))));
        Assert.Equal(2, await offline.RunOnceAsync(5000, CancellationToken.None));
    }
}
