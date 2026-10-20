using System.Text.Json.Nodes;

namespace ArenaLive.Agent.Core;

public enum GuiPhase
{
    Idle,
    Starting,
    Running,
    Stopping,
}

/// <summary>Fields of the window from `config.json`: the token only as presence and last 4 characters.</summary>
public sealed record InitView(string WatchPath, string ServerUrl, bool TokenPresent, string? TokenLast4, string? ConfigError, WindowBranding? Branding);

/// <summary>State of the self-registration shown in the window (`none`, `pending`, `approved`, `rejected`, `expired`, `consumed`, `error`).</summary>
public sealed record RegistrationView(string State, string? Name = null, string? PairingCode = null, string? ExpiresAt = null, string? Message = null);

/// <summary>What the controller shows; called from any thread (the window marshals to its own).</summary>
public interface IAgentWindow
{
    void ShowInit(InitView view);
    void ShowState(GuiPhase phase, AgentStatus? status);
    void ShowLog(LogEntry entry);
    void ShowError(string message);
    void ShowRegistration(RegistrationView view);
}

/// <summary>What the controller needs of an `Agent` (a fake one in the tests).</summary>
public interface IRunnableAgent
{
    Task RunAsync(CancellationToken cancel);
    AgentStatus Status();
}

/// <summary>
/// State machine of the window (`GuiController` of the Node agent): idle → starting → running → stopping → idle.
/// START saves `config.json`, validates it, takes the lock and runs the agent until STOP. The self-registration
/// («Registra») asks a pairing code and polls until an admin approves it in the portal.
/// </summary>
public sealed class GuiController : IDisposable
{
    private readonly string _configPath;
    private readonly string _baseDir;
    private readonly AgentLogger _logger;
    private readonly IAgentWindow _window;
    private readonly Func<AgentConfig, IRunnableAgent> _createAgent;
    private readonly Func<string, IDisposable> _acquireLock;
    private readonly Func<string, IRegistrationApi> _createRegistrationApi;
    private readonly TimeSpan _statusInterval;
    private readonly TimeSpan _registrationPoll;
    private readonly string? _startupError;
    private readonly WindowBranding? _branding;
    private readonly SemaphoreSlim _configWrites = new(1, 1);
    private readonly Lock _gate = new();

    private GuiPhase _phase = GuiPhase.Idle;
    private CancellationTokenSource? _abort;
    private Task? _session;
    private IRunnableAgent? _agent;
    private bool _finished;

    private PendingRegistration? _registration;
    private IRegistrationApi? _registrationApi;
    private string? _registrationDataDir;
    private bool _registering;
    private int _registrationGen;
    private CancellationTokenSource _registrationAbort = new();
    private readonly HashSet<Task> _registrationTasks = [];
    private string _lastRegistration = "";

    public GuiController(
        string configPath,
        string baseDir,
        AgentLogger logger,
        IAgentWindow window,
        Func<AgentConfig, IRunnableAgent> createAgent,
        Func<string, IDisposable>? acquireLock = null,
        Func<string, IRegistrationApi>? createRegistrationApi = null,
        TimeSpan? statusInterval = null,
        TimeSpan? registrationPoll = null,
        string? startupError = null,
        WindowBranding? branding = null)
    {
        _configPath = configPath;
        _baseDir = baseDir;
        _logger = logger;
        _window = window;
        _createAgent = createAgent;
        _acquireLock = acquireLock ?? (dir => AgentLock.Acquire(dir));
        _createRegistrationApi = createRegistrationApi ?? (_ => throw new InvalidOperationException("registrazione non configurata"));
        _statusInterval = statusInterval ?? TimeSpan.FromSeconds(1);
        _registrationPoll = registrationPoll ?? TimeSpan.FromSeconds(5);
        _startupError = startupError;
        _branding = branding;
    }

    public GuiPhase Phase
    {
        get
        {
            lock (_gate) return _phase;
        }
    }

    /// <summary>Current session (tests wait on it).</summary>
    public Task? Session => _session;

    /// <summary>Registration requests in flight (tests wait on them).</summary>
    public Task[] RegistrationTasks()
    {
        lock (_gate) return [.. _registrationTasks];
    }

    /// <summary>First messages to the window; a pending registration (`registration.json`) is resumed.</summary>
    public void Init(LogSink? sink)
    {
        SendInit();
        if (sink is not null)
        {
            foreach (var e in sink.Recent()) _window.ShowLog(e);
            sink.Message += e => _window.ShowLog(e);
        }
        SendState();
        if (_startupError is not null) _window.ShowError(_startupError);
        ResumeRegistration();
    }

    public void Start(string watchPath, string? token)
    {
        lock (_gate)
        {
            if (_finished) return;
            if (_phase != GuiPhase.Idle)
            {
                _window.ShowError("La lettura è già avviata: premi STOP prima di un nuovo START");
                return;
            }
            _phase = GuiPhase.Starting;
        }
        var pasted = token is null ? null : JsText.Trim(token);
        if (!string.IsNullOrEmpty(pasted)) _logger.AddSecret(pasted);
        var abort = new CancellationTokenSource();
        _abort = abort;
        SendState();
        _session = Task.Run(() => RunSessionAsync(watchPath, string.IsNullOrEmpty(pasted) ? null : pasted, abort.Token));
    }

    /// <summary>STOP: aborts the start-up or the loop and waits for the agent to end.</summary>
    public async Task StopAsync()
    {
        Task? session;
        lock (_gate)
        {
            if (_phase == GuiPhase.Idle) return;
            if (_phase != GuiPhase.Stopping)
            {
                _phase = GuiPhase.Stopping;
                _abort?.Cancel();
            }
            session = _session;
        }
        SendState();
        if (session is not null) await session.ConfigureAwait(false);
    }

    /// <summary>The window is closing: stops the agent; registration.json stays (the wait resumes at the next start).</summary>
    public async Task ShutdownAsync()
    {
        lock (_gate) _finished = true;
        await _registrationAbort.CancelAsync().ConfigureAwait(false);
        await StopAsync().ConfigureAwait(false);
        await Task.WhenAll(RegistrationTasks()).ConfigureAwait(false);
    }

    /// <summary>Saves the token in `config.json` and tells the window (present, last 4 characters).</summary>
    public async Task SaveTokenAsync(string token)
    {
        _logger.AddSecret(JsText.Trim(token));
        await _configWrites.WaitAsync().ConfigureAwait(false);
        try
        {
            var saved = ConfigFile.SaveToken(_configPath, token);
            _logger.AddSecret(saved);
        }
        finally
        {
            _configWrites.Release();
        }
        _logger.Info("token agente salvato in config.json");
        SendInit();
    }

    private async Task RunSessionAsync(string watchPath, string? token, CancellationToken cancel)
    {
        IDisposable? held = null;
        Timer? timer = null;
        try
        {
            if (token is not null) await SaveTokenAsync(token).ConfigureAwait(false);
            AgentConfig config;
            await _configWrites.WaitAsync(CancellationToken.None).ConfigureAwait(false);
            try
            {
                config = ConfigFile.SaveWatchPath(_configPath, _baseDir, watchPath);
            }
            finally
            {
                _configWrites.Release();
            }
            _logger.AddSecret(config.AgentToken);
            SendInit();
            if (cancel.IsCancellationRequested) return;
            Directory.CreateDirectory(config.DataDir);
            held = _acquireLock(config.DataDir);
            if (cancel.IsCancellationRequested) return;
            var agent = _createAgent(config);
            if (cancel.IsCancellationRequested) return;
            lock (_gate)
            {
                _agent = agent;
                if (_phase == GuiPhase.Starting) _phase = GuiPhase.Running;
            }
            SendState();
            timer = new Timer(_ => SendState(), null, _statusInterval, _statusInterval);
            await agent.RunAsync(cancel).ConfigureAwait(false);
        }
        catch (Exception e) when (e is ConfigException or LockHeldException or IOException or UnauthorizedAccessException or InvalidOperationException or ArgumentException)
        {
            var message = e is ConfigException or LockHeldException ? e.Message : $"Avvio non riuscito: {e.Message}";
            _logger.Error("START non riuscito", new Dictionary<string, object?> { ["err"] = message });
            _window.ShowError(_logger.Redact(message));
        }
        finally
        {
            if (timer is not null) await timer.DisposeAsync().ConfigureAwait(false);
            try
            {
                held?.Dispose();
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                _logger.Warn("lucchetto non rimosso", new Dictionary<string, object?> { ["err"] = e.Message });
            }
            lock (_gate)
            {
                _abort = null;
                _agent = null;
                _phase = GuiPhase.Idle;
            }
            SendState();
        }
    }

    /// <summary>«Registra»: not while reading, nor with another registration in progress.</summary>
    public void Register(string name)
    {
        int gen;
        lock (_gate)
        {
            if (_finished) return;
            if (_phase != GuiPhase.Idle)
            {
                _window.ShowError("Ferma la lettura (STOP) prima di registrare l’agente");
                return;
            }
            if (_registering || _registration is not null)
            {
                _window.ShowError("Registrazione già in corso: premi «Annulla» per ricominciare");
                return;
            }
            _registering = true;
            gen = ++_registrationGen;
        }
        Track(Task.Run(() => CreateRegistrationAsync(name, gen)));
    }

    /// <summary>«Annulla»: stops polling and forgets the pending registration (on the server it expires by itself).</summary>
    public void CancelRegistration()
    {
        string? dataDir;
        bool active;
        lock (_gate)
        {
            dataDir = _registrationDataDir;
            active = _registering || _registration is not null;
            ResetRegistration();
        }
        if (dataDir is not null) RemoveRegistrationFile(dataDir);
        if (active) _logger.Info("registrazione annullata");
        SendRegistration(new RegistrationView("none"));
    }

    private async Task CreateRegistrationAsync(string name, int gen)
    {
        try
        {
            var (serverUrl, dataDir) = RegistrationContext();
            var api = _createRegistrationApi(serverUrl);
            var created = await api.CreateAsync(name, _registrationAbort.Token).ConfigureAwait(false);
            _logger.AddSecret(created.Secret);
            if (gen != _registrationGen) return;
            var pending = new PendingRegistration
            {
                RegistrationId = created.RegistrationId,
                Secret = created.Secret,
                PairingCode = created.PairingCode,
                ExpiresAt = created.ExpiresAt,
                Name = RegistrationFormats.PlainText(name) ?? name,
            };
            PendingRegistrationFile.Save(dataDir, pending);
            lock (_gate)
            {
                if (gen != _registrationGen)
                {
                    if (!_finished) RemoveRegistrationFile(dataDir);
                    return;
                }
                _registration = pending;
                _registrationApi = api;
                _registrationDataDir = dataDir;
            }
            _logger.Info("richiesta di registrazione inviata: in attesa di abilitazione nel portale",
                new Dictionary<string, object?> { ["registrationId"] = pending.RegistrationId, ["pairingCode"] = pending.PairingCode });
            SendPendingRegistration();
            SchedulePoll(gen, _registrationPoll);
        }
        catch (Exception e) when (e is RegistrationException or ConfigException or IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            if (gen != _registrationGen || _finished) return;
            var message = e is RegistrationException or ConfigException ? e.Message : $"Registrazione non riuscita: {e.Message}";
            _logger.Warn("registrazione non riuscita", new Dictionary<string, object?> { ["err"] = message });
            SendRegistration(new RegistrationView("error", Name: name, Message: message));
        }
        finally
        {
            lock (_gate)
            {
                if (gen == _registrationGen) _registering = false;
            }
        }
    }

    private void ResumeRegistration()
    {
        lock (_gate)
        {
            if (_registering || _registration is not null) return;
        }
        JsonObject? raw = null;
        string? readError = null;
        try
        {
            raw = ConfigFile.ReadRaw(_configPath);
        }
        catch (ConfigException e)
        {
            readError = e.Message;
        }
        string dataDir;
        try
        {
            dataDir = raw is not null ? ConfigFile.RegistrationDataDir(raw, _baseDir) : ConfigFile.GuiPaths(null, _baseDir).DataDir;
        }
        catch (ConfigException e)
        {
            _logger.Warn("registrazione in attesa non ripresa", new Dictionary<string, object?> { ["err"] = e.Message });
            SendRegistration(new RegistrationView("error", Message: e.Message));
            return;
        }
        PendingRegistration? pending;
        try
        {
            pending = PendingRegistrationFile.Load(dataDir);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            _logger.Warn("registration.json illeggibile", new Dictionary<string, object?> { ["err"] = e.Message });
            pending = null;
        }
        if (pending is null)
        {
            SendRegistration(new RegistrationView("none"));
            return;
        }
        _logger.AddSecret(pending.Secret);
        string serverUrl;
        try
        {
            if (raw is null) throw new ConfigException(ConfigErrorCode.Invalid, readError ?? "config.json non valido");
            serverUrl = ConfigFile.RegistrationServerUrl(raw);
        }
        catch (ConfigException e)
        {
            // registration.json is kept: the wait resumes once config.json is fixed.
            SendRegistration(new RegistrationView("error", Name: pending.Name, Message: e.Message));
            return;
        }
        int gen;
        lock (_gate)
        {
            gen = ++_registrationGen;
            _registration = pending;
            _registrationApi = _createRegistrationApi(serverUrl);
            _registrationDataDir = dataDir;
        }
        _logger.Info("registrazione in attesa ripresa", new Dictionary<string, object?> { ["registrationId"] = pending.RegistrationId });
        SendPendingRegistration();
        SchedulePoll(gen, TimeSpan.Zero);
    }

    private void SchedulePoll(int gen, TimeSpan delay)
    {
        lock (_gate)
        {
            if (_finished || gen != _registrationGen || _registration is null) return;
        }
        var token = _registrationAbort.Token;
        Track(Task.Run(async () =>
        {
            try
            {
                await Task.Delay(delay, token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return;
            }
            await PollAsync(gen).ConfigureAwait(false);
        }));
    }

    /// <summary>One status query; the next one is scheduled only when this one is over (never two at the same time).</summary>
    private async Task PollAsync(int gen)
    {
        PendingRegistration? registration;
        IRegistrationApi? api;
        string? dataDir;
        lock (_gate)
        {
            registration = _registration;
            api = _registrationApi;
            dataDir = _registrationDataDir;
        }
        if (registration is null || api is null || dataDir is null || gen != _registrationGen) return;
        var name = registration.Name;
        RegistrationStatus status;
        try
        {
            status = await api.StatusAsync(registration.Secret, _registrationAbort.Token).ConfigureAwait(false);
        }
        catch (Exception e) when (e is RegistrationException or InvalidOperationException or IOException)
        {
            if (gen != _registrationGen || _finished) return;
            if (e is RegistrationException { Code: RegistrationErrorCode.Unauthorized })
            {
                _logger.Warn("registrazione non riconosciuta dal server");
                FinishRegistration(gen, dataDir, new RegistrationView("error", Name: name, Message: e.Message));
                return;
            }
            _logger.Warn("stato della registrazione non letto: nuovo tentativo", new Dictionary<string, object?> { ["err"] = e.Message });
            SendPendingRegistration($"{e.Message}: nuovo tentativo tra {Math.Round(_registrationPoll.TotalSeconds)} s");
            SchedulePoll(gen, _registrationPoll);
            return;
        }
        if (status.Status == "approved") _logger.AddSecret(status.Token);
        if (gen != _registrationGen)
        {
            if (status.Status == "approved")
            {
                _logger.Warn("token ricevuto dopo l’annullamento della registrazione: ignorato (revoca l’agente dal portale)",
                    new Dictionary<string, object?> { ["agentId"] = status.AgentId });
            }
            return;
        }
        switch (status.Status)
        {
            case "pending":
                lock (_gate)
                {
                    if (_registration is not null && status.ExpiresAt is not null) _registration = _registration with { ExpiresAt = status.ExpiresAt };
                }
                SendPendingRegistration();
                SchedulePoll(gen, _registrationPoll);
                return;
            case "approved":
                try
                {
                    await SaveTokenAsync(status.Token!).ConfigureAwait(false);
                }
                catch (Exception e) when (e is ConfigException or IOException or UnauthorizedAccessException)
                {
                    _logger.Error("token ricevuto ma non salvato in config.json", new Dictionary<string, object?> { ["err"] = e.Message });
                    FinishRegistration(gen, dataDir, new RegistrationView("error", Name: name, Message: $"Token ricevuto ma non salvato in config.json ({e.Message}): registra di nuovo"));
                    return;
                }
                _logger.Info("agente registrato: token salvato in config.json", new Dictionary<string, object?> { ["agentId"] = status.AgentId });
                FinishRegistration(gen, dataDir, new RegistrationView("approved", Name: name, Message: Phase == GuiPhase.Idle ? null : "Token salvato: vale dal prossimo START"));
                SendState();
                return;
            default:
                _logger.Info("registrazione conclusa senza token", new Dictionary<string, object?> { ["status"] = status.Status });
                FinishRegistration(gen, dataDir, new RegistrationView(status.Status, Name: name));
                return;
        }
    }

    private void FinishRegistration(int gen, string dataDir, RegistrationView view)
    {
        if (gen != _registrationGen) return;
        RemoveRegistrationFile(dataDir);
        lock (_gate)
        {
            if (gen != _registrationGen) return;
            _registration = null;
            _registrationApi = null;
            _registrationDataDir = null;
        }
        SendRegistration(view);
    }

    private void ResetRegistration()
    {
        _registrationGen++;
        _registrationAbort.Cancel();
        _registrationAbort = new CancellationTokenSource();
        _registration = null;
        _registrationApi = null;
        _registrationDataDir = null;
        _registering = false;
    }

    private void Track(Task task)
    {
        lock (_gate) _registrationTasks.Add(task);
        task.ContinueWith(t =>
        {
            lock (_gate) _registrationTasks.Remove(t);
        }, TaskScheduler.Default);
    }

    private void RemoveRegistrationFile(string dataDir)
    {
        try
        {
            PendingRegistrationFile.Clear(dataDir);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            _logger.Warn("registration.json non cancellato", new Dictionary<string, object?> { ["err"] = e.Message });
        }
    }

    private (string ServerUrl, string DataDir) RegistrationContext()
    {
        var raw = ConfigFile.ReadRaw(_configPath);
        return (ConfigFile.RegistrationServerUrl(raw), ConfigFile.RegistrationDataDir(raw, _baseDir));
    }

    private void SendPendingRegistration(string? message = null)
    {
        PendingRegistration? r;
        lock (_gate) r = _registration;
        if (r is null) return;
        SendRegistration(new RegistrationView("pending", r.Name, r.PairingCode, r.ExpiresAt, message));
    }

    /// <summary>A `pending` equal to the last one is skipped (the poll repeats it).</summary>
    private void SendRegistration(RegistrationView view)
    {
        var key = view.ToString();
        lock (_gate)
        {
            if (view.State == "pending" && key == _lastRegistration) return;
            _lastRegistration = key;
        }
        _window.ShowRegistration(view with { Message = view.Message is null ? null : _logger.Redact(view.Message) });
    }

    private void SendInit()
    {
        JsonObject? raw = null;
        string? error = null;
        try
        {
            raw = ConfigFile.ReadRaw(_configPath);
        }
        catch (ConfigException e)
        {
            error = e.Message;
        }
        var (present, last4) = ConfigFile.TokenInfo(raw);
        if (raw?["agentToken"] is JsonValue v && v.TryGetValue<string>(out var saved)) _logger.AddSecret(saved);
        var (watchPath, serverUrl) = ConfigFile.WindowFields(raw);
        _window.ShowInit(new InitView(watchPath, serverUrl, present, last4, error, _branding));
    }

    public void Dispose()
    {
        _configWrites.Dispose();
        _registrationAbort.Dispose();
    }

    private void SendState()
    {
        GuiPhase phase;
        IRunnableAgent? agent;
        lock (_gate)
        {
            phase = _phase;
            agent = _agent;
        }
        _window.ShowState(phase, agent?.Status());
    }
}
