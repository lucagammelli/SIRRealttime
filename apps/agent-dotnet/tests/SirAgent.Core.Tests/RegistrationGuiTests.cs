using System.Net;
using System.Text.Json.Nodes;

namespace SirAgent.Core.Tests;

public sealed class RegistrationClientTests
{
    private const string Secret = "segretoRegistrazione_0123456789";

    [Fact]
    public async Task Crea_e_interroga_con_il_segreto_solo_nell_intestazione()
    {
        var handler = new FakeHandler(r => r.Url.AbsolutePath.EndsWith("/status", StringComparison.Ordinal)
            ? FakeHandler.Json(HttpStatusCode.OK, """{"status":"pending","expiresAt":"2026-10-17T12:00:00.000Z"}""")
            : FakeHandler.Json(HttpStatusCode.Created, $$"""{"registrationId":"5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e","secret":"{{Secret}}","pairingCode":"ABC234","expiresAt":"2026-10-17T12:00:00.000Z"}"""));
        var client = new RegistrationClient(new HttpClient(handler), "https://sir.example.it/sir");
        var created = await client.CreateAsync("  PC Palazzetto ", CancellationToken.None);
        Assert.Equal("ABC234", created.PairingCode);
        var status = await client.StatusAsync(created.Secret, CancellationToken.None);
        Assert.Equal("pending", status.Status);
        Assert.Equal("https://sir.example.it/sir/api/agents/registrations", handler.Seen[0].Url.ToString());
        Assert.Equal("""{"name":"PC Palazzetto"}""", handler.Seen[0].Body);
        Assert.True(Repo.IsValid("create-registration-request.schema.json", handler.Seen[0].Body));
        Assert.Null(handler.Seen[0].Authorization);
        Assert.False(handler.Seen[0].Headers.ContainsKey("origin"));
        Assert.Equal($"Bearer {Secret}", handler.Seen[1].Authorization);
        Assert.DoesNotContain(Secret, handler.Seen[1].Body, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, RegistrationErrorCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests, RegistrationErrorCode.RateLimited)]
    [InlineData(HttpStatusCode.NotFound, RegistrationErrorCode.Http)]
    [InlineData(HttpStatusCode.OK, RegistrationErrorCode.InvalidResponse)]
    public async Task Errori_del_server_con_messaggio_per_la_finestra(HttpStatusCode status, RegistrationErrorCode code)
    {
        var client = new RegistrationClient(new HttpClient(new FakeHandler(_ => FakeHandler.Json(status, """{"status":"boh"}"""))), "https://sir.example.it");
        var e = await Assert.ThrowsAsync<RegistrationException>(() => client.StatusAsync(Secret, CancellationToken.None));
        Assert.Equal(code, e.Code);
        Assert.DoesNotContain(Secret, e.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Nome_non_valido_rifiutato_senza_chiamare_il_server()
    {
        var handler = new FakeHandler(_ => throw new InvalidOperationException());
        var client = new RegistrationClient(new HttpClient(handler), "https://sir.example.it");
        var e = await Assert.ThrowsAsync<RegistrationException>(() => client.CreateAsync(" \t ", CancellationToken.None));
        Assert.Equal(RegistrationErrorCode.InvalidRequest, e.Code);
        Assert.Empty(handler.Seen);
    }

    [Fact]
    public void Registrazione_in_attesa_salvata_e_ripresa()
    {
        using var dir = new TempDir();
        var pending = new PendingRegistration { RegistrationId = "5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e", Secret = Secret, PairingCode = "ABC234", ExpiresAt = "2026-10-17T12:00:00.000Z", Name = "PC" };
        PendingRegistrationFile.Save(dir.Path, pending);
        Assert.Equal(pending, PendingRegistrationFile.Load(dir.Path));
        File.WriteAllText(PendingRegistrationFile.PathOf(dir.Path), "{rotto");
        Assert.Null(PendingRegistrationFile.Load(dir.Path));
        Assert.False(File.Exists(PendingRegistrationFile.PathOf(dir.Path)));
    }
}

/// <summary>Window controller with a fake window, a fake server and a fake agent.</summary>
public sealed class GuiControllerTests : IDisposable
{
    private const string Token = "tokenRicevuto_0123456789abcdef";
    private const string Secret = "segretoRegistrazione_0123456789";
    private readonly TempDir _dir = new();
    private readonly FakeWindow _window = new();
    private readonly AgentLogger _logger;

    public GuiControllerTests()
    {
        _logger = new AgentLogger("info", null);
        File.WriteAllText(_dir.File("config.json"), $$"""{"watchPath":"","serverUrl":"https://sir.example.it/","dataDir":"{{_dir.File("data")}}","logDir":"{{_dir.File("logs")}}"}""");
        Directory.CreateDirectory(_dir.File("pennina"));
    }

    public void Dispose()
    {
        _logger.Dispose();
        _dir.Dispose();
    }

    private sealed class FakeWindow : IAgentWindow
    {
        public List<object> Messages { get; } = [];

        public void ShowInit(InitView view) { lock (Messages) Messages.Add(view); }
        public void ShowState(GuiPhase phase, AgentStatus? status) { lock (Messages) Messages.Add(phase); }
        public void ShowLog(LogEntry entry) { lock (Messages) Messages.Add(entry); }
        public void ShowError(string message) { lock (Messages) Messages.Add("errore: " + message); }
        public void ShowRegistration(RegistrationView view) { lock (Messages) Messages.Add(view); }

        public T[] Of<T>()
        {
            lock (Messages) return [.. Messages.OfType<T>()];
        }
    }

    private sealed class FakeAgent : IRunnableAgent
    {
        public async Task RunAsync(CancellationToken cancel)
        {
            try
            {
                await Task.Delay(Timeout.Infinite, cancel);
            }
            catch (OperationCanceledException)
            {
                // stopped
            }
        }

        public AgentStatus Status() => new("f.dvw", "k", 1, 0, null, true, false);
    }

    private sealed class FakeApi(Queue<RegistrationStatus> answers) : IRegistrationApi
    {
        public Task<CreatedRegistration> CreateAsync(string name, CancellationToken cancel) =>
            Task.FromResult(new CreatedRegistration("5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e", Secret, "ABC234", "2026-10-17T12:00:00.000Z"));

        public Task<RegistrationStatus> StatusAsync(string secret, CancellationToken cancel)
        {
            Assert.Equal(Secret, secret);
            lock (answers) return Task.FromResult(answers.Count > 1 ? answers.Dequeue() : answers.Peek());
        }
    }

    private GuiController Controller(Queue<RegistrationStatus>? answers = null, Func<string, IDisposable>? acquireLock = null) => new(
        _dir.File("config.json"),
        _dir.Path,
        _logger,
        _window,
        _ => new FakeAgent(),
        acquireLock ?? (d => AgentLock.Acquire(d)),
        _ => new FakeApi(answers ?? new Queue<RegistrationStatus>([new RegistrationStatus("pending", ExpiresAt: "2026-10-17T12:00:00.000Z")])),
        TimeSpan.FromMilliseconds(20),
        TimeSpan.FromMilliseconds(20));

    private static async Task Until(Func<bool> condition)
    {
        for (var i = 0; i < 300 && !condition(); i++) await Task.Delay(10);
        Assert.True(condition());
    }

    [Fact]
    public async Task Registra_abilitazione_token_salvato_e_START_attivo()
    {
        using var c = Controller(new Queue<RegistrationStatus>([
            new RegistrationStatus("pending", ExpiresAt: "2026-10-17T12:00:00.000Z"),
            new RegistrationStatus("approved", Token: Token, AgentId: "5f8b7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e"),
        ]));
        c.Init(null);
        Assert.False(_window.Of<InitView>()[0].TokenPresent);
        c.Register("PC");
        await Until(() => _window.Of<RegistrationView>().Any(v => v.State == "approved"));
        Assert.Contains(_window.Of<RegistrationView>(), v => v is { State: "pending", PairingCode: "ABC234" });
        var config = JsonNode.Parse(File.ReadAllText(_dir.File("config.json")))!.AsObject();
        Assert.Equal(Token, config["agentToken"]!.GetValue<string>());
        Assert.Equal("https://sir.example.it/", config["serverUrl"]!.GetValue<string>());
        var init = _window.Of<InitView>()[^1];
        Assert.True(init.TokenPresent);
        Assert.Equal("cdef", init.TokenLast4);
        Assert.False(File.Exists(PendingRegistrationFile.PathOf(_dir.File("data"))));
        // The token never reaches the window.
        Assert.DoesNotContain(_window.Messages, m => (m.ToString() ?? "").Contains(Token, StringComparison.Ordinal) || (m.ToString() ?? "").Contains(Secret, StringComparison.Ordinal));
        // START then STOP.
        c.Start(_dir.File("pennina"), null);
        await Until(() => c.Phase == GuiPhase.Running);
        Assert.True(File.Exists(AgentLock.PathOf(_dir.File("data"))));
        await c.StopAsync();
        Assert.Equal(GuiPhase.Idle, c.Phase);
        Assert.False(File.Exists(AgentLock.PathOf(_dir.File("data"))));
        await c.ShutdownAsync();
    }

    [Fact]
    public async Task Chiusa_in_attesa_la_registrazione_riprende_alla_riapertura()
    {
        using (var first = Controller())
        {
            first.Init(null);
            first.Register("PC");
            await Until(() => File.Exists(PendingRegistrationFile.PathOf(_dir.File("data"))));
            await first.ShutdownAsync();
        }
        using var second = Controller();
        second.Init(null);
        await Until(() => _window.Of<RegistrationView>().Count(v => v.State == "pending") >= 2);
        second.CancelRegistration();
        Assert.False(File.Exists(PendingRegistrationFile.PathOf(_dir.File("data"))));
        Assert.Equal("none", _window.Of<RegistrationView>()[^1].State);
        await second.ShutdownAsync();
    }

    [Fact]
    public async Task START_rifiutato_con_un_altra_istanza_in_lettura()
    {
        File.WriteAllText(_dir.File("config.json"), $$"""{"watchPath":"","serverUrl":"https://sir.example.it/","agentToken":"{{Token}}","dataDir":"{{_dir.File("data")}}","logDir":"{{_dir.File("logs")}}"}""");
        using var c = Controller(acquireLock: _ => throw new LockHeldException(99, "Un'altra istanza dell'agente è già in lettura (pid 99, per esempio il servizio SIRAgent): fermala prima di avviare questa"));
        c.Init(null);
        c.Start(_dir.File("pennina"), null);
        await Until(() => _window.Of<string>().Any(m => m.Contains("pid 99", StringComparison.Ordinal)));
        await Until(() => c.Phase == GuiPhase.Idle);
        await c.ShutdownAsync();
    }

    [Fact]
    public async Task Registra_rifiutato_durante_la_lettura_e_config_mancante()
    {
        File.Delete(_dir.File("config.json"));
        using var c = Controller();
        c.Init(null);
        Assert.Contains("config.json non trovato", _window.Of<InitView>()[0].ConfigError, StringComparison.Ordinal);
        c.Register("PC");
        await Until(() => _window.Of<RegistrationView>().Any(v => v.State == "error"));
        await c.ShutdownAsync();
    }
}

public sealed class BrandingTests
{
    private static byte[] Png(int w, int h)
    {
        var data = new byte[33];
        byte[] sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        sig.CopyTo(data, 0);
        "IHDR"u8.ToArray().CopyTo(data, 12);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(16), (uint)w);
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(data.AsSpan(20), (uint)h);
        return data;
    }

    private const string Valid = """{"version":1,"name":"Sir Susa","colors":{"primary":"#1E4DB0","onPrimary":"#ffffff","accent":"#e30613","onAccent":"#ffffff","background":"#f5f5f5","onBackground":"#111111"}}""";

    [Fact]
    public void Colori_nome_e_logo_del_cliente()
    {
        using var dir = new TempDir();
        File.WriteAllText(dir.File("branding.json"), Valid);
        File.WriteAllBytes(dir.File("logo.png"), Png(200, 100));
        var read = Branding.Read(dir.Path);
        Assert.Equal(new WindowBranding("Sir Susa", "#1e4db0", "#ffffff", dir.File("logo.png")), read.Branding);
        Assert.Empty(read.Problems);
    }

    [Fact]
    public void Logo_troppo_grande_o_rotto_solo_colori()
    {
        using var dir = new TempDir();
        File.WriteAllText(dir.File("branding.json"), Valid);
        File.WriteAllBytes(dir.File("logo.png"), Png(2000, 100));
        var big = Branding.Read(dir.Path);
        Assert.Null(big.Branding!.LogoPath);
        Assert.Contains("1024×1024", big.Problems[0], StringComparison.Ordinal);
        File.Delete(dir.File("logo.png"));
        File.WriteAllBytes(dir.File("logo.jpg"), [0xFF, 0xD8, 0x00, 0x00, 0, 0, 0, 0, 0, 0]);
        Assert.Contains("non è un'immagine valida", Branding.Read(dir.Path).Problems[0], StringComparison.Ordinal);
    }

    [Fact]
    public void Jpeg_dimensioni_dal_marcatore_sof()
    {
        byte[] jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80, 0x03, 0, 0, 0];
        Assert.Equal((128, 64), Branding.ImageSize(jpeg, png: false));
    }

    [Fact]
    public void Branding_assente_o_rotto_grafica_predefinita()
    {
        using var dir = new TempDir();
        Assert.Equal(new BrandingRead(null, []).Problems, Branding.Read(dir.Path).Problems);
        Assert.Null(Branding.Read(dir.Path).Branding);
        File.WriteAllText(dir.File("branding.json"), "{rotto");
        Assert.Contains("non è un JSON valido", Branding.Read(dir.Path).Problems[0], StringComparison.Ordinal);
        File.WriteAllText(dir.File("branding.json"), Valid.Replace("#ffffff", "white", StringComparison.Ordinal));
        Assert.Contains("non valido", Branding.Read(dir.Path).Problems[0], StringComparison.Ordinal);
    }
}
