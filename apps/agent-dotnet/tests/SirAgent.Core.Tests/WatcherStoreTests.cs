using System.Text.Json;

namespace SirAgent.Core.Tests;

public sealed class WatcherTests
{
    [Fact]
    public void Legge_solo_dopo_che_il_file_resta_stabile()
    {
        using var dir = new TempDir();
        var file = dir.File("a.dvw");
        File.WriteAllText(file, "[3SCOUT]\nx\n");
        var w = new FileWatcher(file, stableMs: 700, rereadMs: 10_000);
        Assert.IsType<WatchEvent.Idle>(w.Poll(0));
        Assert.IsType<WatchEvent.Idle>(w.Poll(500));
        Assert.IsType<WatchEvent.Read>(w.Poll(800));
        Assert.IsType<WatchEvent.Idle>(w.Poll(1800));
        Assert.IsType<WatchEvent.Read>(w.Poll(11_000));
        w.RequestReread();
        Assert.IsType<WatchEvent.Read>(w.Poll(11_800));
    }

    [Fact]
    public void Nella_cartella_prende_il_dvw_piu_recente_e_ignora_gli_altri()
    {
        using var dir = new TempDir();
        File.WriteAllText(dir.File("vecchia.dvw"), "v");
        File.SetLastWriteTimeUtc(dir.File("vecchia.dvw"), DateTime.UtcNow.AddHours(-1));
        File.WriteAllText(dir.File("nuova.DVW"), "n");
        File.SetLastWriteTimeUtc(dir.File("nuova.DVW"), DateTime.UtcNow.AddMinutes(-1));
        File.WriteAllText(dir.File("~lock.dvw"), "l");
        File.WriteAllText(dir.File(".nascosta.dvw"), "h");
        File.WriteAllText(dir.File("copia.dvw.tmp"), "t");
        var w = new FileWatcher(dir.Path, stableMs: 0, rereadMs: 10_000);
        var read = Assert.IsType<WatchEvent.Read>(w.Poll(0));
        Assert.Equal(dir.File("nuova.DVW"), read.Path);
    }

    [Fact]
    public void Pennina_tolta_e_file_occupato_non_sono_errori()
    {
        using var dir = new TempDir();
        var w = new FileWatcher(Path.Combine(dir.Path, "E"), stableMs: 0, rereadMs: 10_000);
        Assert.Contains("non raggiungibile", Assert.IsType<WatchEvent.Missing>(w.Poll(0)).Reason, StringComparison.Ordinal);
        var empty = new FileWatcher(dir.Path, 0, 10_000);
        Assert.Contains("nessun file .dvw", Assert.IsType<WatchEvent.Missing>(empty.Poll(0)).Reason, StringComparison.Ordinal);
        File.WriteAllText(dir.File("a.dvw"), "x");
        var busy = new FileWatcher(dir.Path, 0, 10_000) { Reader = _ => new ReadOutcome.Busy("EBUSY") };
        Assert.IsType<WatchEvent.Busy>(busy.Poll(0));
        busy.Reader = SharedFileReader.ReadAll;
        Assert.IsType<WatchEvent.Read>(busy.Poll(1));
    }
}

public sealed class StoreTests
{
    private static IngestRequest Request(string key, long seq) =>
        ScoutSync.ToRequest(key, seq, ScoutSync.PlanRequests(null, new DvwContent("[3MATCH]\n", ["*p01:00;"]))[0]);

    [Fact]
    public void Salva_e_ricarica_nello_stesso_formato_del_Node()
    {
        using var dir = new TempDir();
        var time = new ManualTime(DateTimeOffset.Parse("2026-10-17T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture));
        var store = new MatchStore(dir.Path, 30, time);
        store.Load();
        store.Save(MatchRecord.New("k1") with { NextSeq = 1, Base = new StoredContent { Header = "h", Lines = ["a"] }, Queue = [new Queued { Request = Request("k1", 0), Order = store.NextOrder() }] });
        var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(dir.Path, "matches", "k1.json"))).RootElement;
        Assert.Equal(1, json.GetProperty("version").GetInt32());
        Assert.Equal("2026-10-17T10:00:00.000Z", json.GetProperty("updatedAt").GetString());
        Assert.False(json.TryGetProperty("retrySnapshotAt", out _));
        Assert.Equal("snapshot", json.GetProperty("queue")[0].GetProperty("request").GetProperty("kind").GetString());
        var again = new MatchStore(dir.Path, 30, time);
        Assert.Empty(again.Load());
        Assert.Equal(1, again.QueueSize());
        Assert.Equal(1, again.NextOrder());
    }

    [Fact]
    public void Legge_un_record_scritto_dal_agente_Node()
    {
        using var dir = new TempDir();
        Directory.CreateDirectory(Path.Combine(dir.Path, "matches"));
        var hash = ScoutSync.HashScoutLines(["a"]);
        File.WriteAllText(Path.Combine(dir.Path, "matches", "k2.json"),
            $$"""{"version":1,"matchKey":"k2","nextSeq":3,"base":{"header":"h","lines":["a"]},"confirmed":{"seq":2,"lineCount":1,"contentHash":"{{hash}}","at":"2026-10-16T10:00:00.000Z"},"forceSnapshot":false,"queue":[],"sourceFile":"E:\\a.dvw","retrySnapshotAt":1760000000000,"updatedAt":"2026-10-16T10:00:00.000Z","altro":1}""");
        var store = new MatchStore(dir.Path, 30, new ManualTime(DateTimeOffset.Parse("2026-10-17T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Empty(store.Load());
        var r = store.Get("k2")!;
        Assert.Equal(3, r.NextSeq);
        Assert.Equal(1_760_000_000_000d, r.RetrySnapshotAt);
        Assert.Equal(hash, r.Confirmed!.ContentHash);
    }

    [Fact]
    public void File_rotto_diventa_corrupt_e_vecchi_record_si_cancellano()
    {
        using var dir = new TempDir();
        var matches = Path.Combine(dir.Path, "matches");
        Directory.CreateDirectory(matches);
        File.WriteAllText(Path.Combine(matches, "rotto.json"), "{non json");
        File.WriteAllText(Path.Combine(matches, "nome-diverso.json"), """{"version":1,"matchKey":"altro","nextSeq":0,"base":null,"confirmed":null,"forceSnapshot":false,"queue":[]}""");
        File.WriteAllText(Path.Combine(matches, "vecchio.json"), """{"version":1,"matchKey":"vecchio","nextSeq":0,"base":null,"confirmed":null,"forceSnapshot":false,"queue":[],"updatedAt":"2026-01-01T00:00:00.000Z"}""");
        var store = new MatchStore(dir.Path, 30, new ManualTime(DateTimeOffset.Parse("2026-10-17T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture)));
        var warnings = store.Load();
        Assert.Equal(3, warnings.Count);
        Assert.True(File.Exists(Path.Combine(matches, "rotto.json.corrupt")));
        Assert.True(File.Exists(Path.Combine(matches, "nome-diverso.json.corrupt")));
        Assert.False(File.Exists(Path.Combine(matches, "vecchio.json")));
        Assert.Empty(store.All());
    }

    [Fact]
    public void Una_richiesta_non_valida_in_coda_rende_il_record_non_valido()
    {
        using var dir = new TempDir();
        var matches = Path.Combine(dir.Path, "matches");
        Directory.CreateDirectory(matches);
        File.WriteAllText(Path.Combine(matches, "k.json"), """{"version":1,"matchKey":"k","nextSeq":1,"base":null,"confirmed":null,"forceSnapshot":false,"queue":[{"order":0,"request":{"protocol":1,"matchKey":"k","seq":0,"kind":"snapshot","fromIndex":0,"lines":[],"contentHash":"x"}}]}""");
        var store = new MatchStore(dir.Path);
        Assert.Single(store.Load());
    }
}
