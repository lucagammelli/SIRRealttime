namespace ArenaLive.Agent.Core;

public sealed record AgentTiming
{
    /// <summary>First retry delay after a network error or a 5xx; doubles at each failure (with jitter).</summary>
    public int RetryBaseMs { get; init; } = 1000;
    public int RetryMaxMs { get; init; } = 30_000;
    /// <summary>Pause after a 401/403 (token not valid or revoked).</summary>
    public int AuthPauseMs { get; init; } = 60_000;
    public int StatusIntervalMs { get; init; } = 60_000;
    /// <summary>Read the file again after this long even if size and mtime did not change.</summary>
    public int RereadMs { get; init; } = 10_000;
    public int RequestTimeoutMs { get; init; } = 15_000;
    /// <summary>More queued messages than this for one match: the queue is replaced by a single snapshot.</summary>
    public int CompactThreshold { get; init; } = 20;
}

public sealed record AgentStatus(
    string? File,
    string? MatchKey,
    int Lines,
    int Queue,
    string? LastSuccessAt,
    bool ServerReachable,
    bool RegistrationExpired);

/// <summary>
/// Reads the `.dvw`, queues the differences and delivers them in order (`Agent` of the Node agent, same behaviour
/// and same log messages). One instance per process; `StepAsync` never throws.
/// </summary>
public sealed class Agent
{
    private const string AuthMessage = "token agente non valido o revocato";

    private readonly AgentConfig _config;
    private readonly MatchStore _store;
    private readonly ILog _log;
    private readonly AgentTiming _timing;
    private readonly TimeProvider _time;
    private readonly Func<double> _random;
    private readonly Sender _sender;

    private string? _currentFile;
    private string? _currentKey;
    private bool _missing;
    private int _busyPolls;
    private string? _pendingHash;
    private string _lastNotice = "";
    private int _failures;
    private long _nextAttemptAt;
    private bool _authBlocked;
    private bool _registrationExpired;
    private bool _serverReachable = true;
    private long? _lastSuccessAt;
    private long _lastStatusAt;
    private bool _settled;

    private Agent(AgentConfig config, MatchStore store, ILog log, HttpClient http, AgentTiming timing, TimeProvider time, Func<double> random)
    {
        _config = config;
        _store = store;
        _log = log;
        _timing = timing;
        _time = time;
        _random = random;
        Watcher = new FileWatcher(config.WatchPath, config.StableMs, timing.RereadMs);
        _sender = new Sender(http, config.ServerUrl, config.AgentToken, TimeSpan.FromMilliseconds(timing.RequestTimeoutMs));
    }

    internal FileWatcher Watcher { get; }

    private long Now => _time.GetUtcNow().ToUnixTimeMilliseconds();

    /// <summary>Loads queue and state from `dataDir`.</summary>
    public static Agent Create(AgentConfig config, ILog log, HttpClient http, AgentTiming? timing = null, TimeProvider? time = null, Func<double>? random = null)
    {
        var clock = time ?? TimeProvider.System;
        var store = new MatchStore(config.DataDir, config.RetentionDays, clock);
        foreach (var w in store.Load()) log.Warn(w.Reason, new Dictionary<string, object?> { ["file"] = w.File });
        var agent = new Agent(config, store, log, http, timing ?? new AgentTiming(), clock, random ?? Random.Shared.NextDouble);
        agent.ResyncUnconfirmed();
        var queued = store.QueueSize();
        if (queued > 0) log.Info("coda ripresa dal disco", new Dictionary<string, object?> { ["queue"] = queued });
        return agent;
    }

    public AgentStatus Status()
    {
        var record = _currentKey is null ? null : _store.Get(_currentKey);
        return new AgentStatus(
            _currentFile,
            _currentKey,
            record?.Base?.Lines.Count ?? 0,
            _store.QueueSize(),
            _lastSuccessAt is null ? null : Json.IsoTime(DateTimeOffset.FromUnixTimeMilliseconds(_lastSuccessAt.Value)),
            _serverReachable,
            _registrationExpired);
    }

    private static Dictionary<string, object?> StatusFields(AgentStatus s) => new()
    {
        ["file"] = s.File,
        ["matchKey"] = s.MatchKey,
        ["lines"] = s.Lines,
        ["queue"] = s.Queue,
        ["lastSuccessAt"] = s.LastSuccessAt,
        ["serverReachable"] = s.ServerReachable,
        ["registrationExpired"] = s.RegistrationExpired,
    };

    /// <summary>Main loop until `cancel`. Never throws.</summary>
    public async Task RunAsync(CancellationToken cancel)
    {
        _log.Info("agente avviato", new Dictionary<string, object?>
        {
            ["watchPath"] = _config.WatchPath,
            ["serverUrl"] = _config.ServerUrl,
            ["dataDir"] = _config.DataDir,
            ["agent"] = "dotnet",
        });
        if (ConfigFile.UsesPlainHttpOnPrivateNetwork(_config.ServerUrl, _config.AllowHttpPrivateNetwork))
        {
            _log.Warn($"connessione senza cifratura verso {new Uri(_config.ServerUrl).Authority}: usare https in produzione");
        }
        while (!cancel.IsCancellationRequested)
        {
            await StepAsync(cancel).ConfigureAwait(false);
            try
            {
                await Task.Delay(_config.PollIntervalMs, cancel).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
        _log.Info("agente fermato", StatusFields(Status()));
    }

    /// <summary>`--once`: waits for a stable read (at most `timeoutMs`), sends the queue once: 0, 2 or 3.</summary>
    public async Task<int> RunOnceAsync(int timeoutMs, CancellationToken cancel)
    {
        _log.Info("esecuzione singola", new Dictionary<string, object?> { ["watchPath"] = _config.WatchPath, ["serverUrl"] = _config.ServerUrl });
        var deadline = Now + timeoutMs;
        while (!_settled && Now < deadline && !cancel.IsCancellationRequested)
        {
            Poll();
            if (_settled) break;
            try
            {
                await Task.Delay(_config.PollIntervalMs, cancel).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
        _nextAttemptAt = 0;
        _authBlocked = false;
        await FlushAsync(true, cancel).ConfigureAwait(false);
        var status = Status();
        _log.Info("esecuzione singola terminata", StatusFields(status));
        if (!_settled) return 3;
        return status.Queue == 0 ? 0 : 2;
    }

    /// <summary>One poll of the file and one delivery attempt. Never throws.</summary>
    public async Task StepAsync(CancellationToken cancel = default)
    {
        Poll();
        RetryRefusedSnapshots();
        await FlushAsync(false, cancel).ConfigureAwait(false);
        var now = Now;
        if (now - _lastStatusAt >= _timing.StatusIntervalMs)
        {
            _lastStatusAt = now;
            _log.Info("stato", StatusFields(Status()));
        }
    }

    private void Poll()
    {
        try
        {
            var e = Watcher.Poll(Now);
            if (e is WatchEvent.Missing missing)
            {
                if (!_missing) _log.Warn("file .dvw non disponibile (pennina tolta?): in attesa", new Dictionary<string, object?> { ["reason"] = missing.Reason });
                _missing = true;
                return;
            }
            if (_missing)
            {
                _missing = false;
                _log.Info("file .dvw di nuovo disponibile", new Dictionary<string, object?> { ["watchPath"] = _config.WatchPath });
            }
            if (e is WatchEvent.Busy busy)
            {
                _busyPolls++;
                if (_busyPolls == 10) _log.Warn("file bloccato da DataVolley, nuovo tentativo", new Dictionary<string, object?> { ["file"] = busy.Path, ["code"] = busy.Code });
                return;
            }
            _busyPolls = 0;
            if (e is WatchEvent.Read read) HandleRead(read.Path, read.Bytes);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            _log.Error("errore nella lettura del file", new Dictionary<string, object?> { ["err"] = ex.Message });
        }
    }

    /// <summary>Logs `message` only if different from the previous notice (no spam at every poll).</summary>
    private void Notice(LogLevel level, Dictionary<string, object?> data, string message)
    {
        var key = $"{message}|{string.Join(",", data.Select(kv => $"{kv.Key}={kv.Value}"))}";
        if (key == _lastNotice) return;
        _lastNotice = key;
        _log.Write(level, message, data);
    }

    private void HandleRead(string path, byte[] bytes)
    {
        var read = Dvw.Read(bytes);
        if (read is DvwRead.Incomplete incomplete)
        {
            Notice(LogLevel.Warn, new() { ["file"] = path, ["reason"] = incomplete.Reason }, "lettura incompleta, attendo la prossima scrittura");
            Watcher.RequestReread();
            return;
        }
        var content = (DvwRead.Content)read;
        var matchKey = Dvw.DeriveMatchKey(content.Value.Header, path);
        var record = _store.Get(matchKey) ?? MatchRecord.New(matchKey);
        var doubt = Dvw.Suspicion(content, record.Base?.ToContent());
        if (doubt is not null)
        {
            var hash = Dvw.BytesHash(bytes);
            if (hash != _pendingHash)
            {
                _pendingHash = hash;
                Notice(LogLevel.Info, new() { ["file"] = path, ["reason"] = doubt }, "contenuto da confermare con una seconda lettura");
                Watcher.RequestReread();
                return;
            }
            _log.Info("contenuto confermato da due letture uguali", new Dictionary<string, object?> { ["file"] = path, ["reason"] = doubt });
        }
        _pendingHash = null;
        if (matchKey != _currentKey) _log.Info("partita in lettura", new Dictionary<string, object?> { ["file"] = path, ["matchKey"] = matchKey });
        _currentFile = path;
        _currentKey = matchKey;
        Enqueue(record, content.Value, path);
        _settled = true;
    }

    /// <summary>Queues the requests that bring the server to `content`; false if the content cannot be sent.</summary>
    private bool Enqueue(MatchRecord record, DvwContent content, string sourceFile)
    {
        var planned = ScoutSync.PlanRequests(record.Base?.ToContent(), content, record.ForceSnapshot);
        if (planned.Count == 0) return true;
        var queue = record.Queue;
        if (queue.Count + planned.Count > _timing.CompactThreshold)
        {
            // Long queue (server unreachable): one snapshot of the current content replaces everything.
            planned = ScoutSync.PlanRequests(null, content);
            queue = [];
            _log.Info("coda compattata in uno snapshot", new Dictionary<string, object?> { ["matchKey"] = record.MatchKey });
        }
        var seq = record.NextSeq;
        var requests = new List<IngestRequest>();
        foreach (var p in planned)
        {
            var candidate = ScoutSync.ToRequest(record.MatchKey, seq++, p);
            var problems = IngestValidator.Problems(candidate);
            if (problems.Count > 0)
            {
                Notice(LogLevel.Warn, new() { ["matchKey"] = record.MatchKey, ["where"] = string.Join(", ", problems) }, "contenuto non inviabile (righe non valide), ignorato");
                return false;
            }
            requests.Add(candidate);
        }
        _store.Save(record with
        {
            NextSeq = seq,
            Base = StoredContent.From(content),
            ForceSnapshot = false,
            SourceFile = sourceFile,
            RetrySnapshotAt = null,
            Queue = [.. queue, .. requests.Select(r => new Queued { Request = r, Order = _store.NextOrder() })],
        });
        _log.Debug("accodato", new Dictionary<string, object?>
        {
            ["matchKey"] = record.MatchKey,
            ["requests"] = requests.Select(r => $"{r.Kind}:{r.Seq}:{r.Lines.Count}").ToList(),
        });
        return true;
    }

    /// <summary>Replaces the queue of a match with a snapshot of its current content (if known).</summary>
    private MatchRecord Resnapshot(MatchRecord record, long minSeq)
    {
        var cleared = record with { NextSeq = Math.Max(record.NextSeq, minSeq), Queue = [], Base = null };
        if (record.Base is null)
        {
            var updated = cleared with { ForceSnapshot = true };
            _store.Save(updated);
            return updated;
        }
        if (!Enqueue(cleared, record.Base.ToContent(), record.SourceFile ?? ""))
        {
            // Never leave the refused message at the head of the queue (it would be sent again at once).
            _store.Save(cleared with { ForceSnapshot = true });
        }
        return _store.Get(record.MatchKey) ?? cleared;
    }

    /// <summary>A snapshot refused by the server (4xx/413) is queued again after `snapshotRetryMs`.</summary>
    private void RetryRefusedSnapshots()
    {
        var now = Now;
        foreach (var record in _store.All())
        {
            if (!record.ForceSnapshot || record.Base is null || record.Queue.Count > 0) continue;
            if (record.RetrySnapshotAt is null || now < record.RetrySnapshotAt) continue;
            _log.Info("nuovo tentativo dello snapshot rifiutato", new Dictionary<string, object?> { ["matchKey"] = record.MatchKey });
            try
            {
                Resnapshot(record, record.NextSeq);
            }
            catch (Exception e)
            {
                // Never stops the loop (as the Node agent): logged, tried again at the next step.
                _log.Error("errore nel nuovo tentativo dello snapshot", new Dictionary<string, object?> { ["err"] = e.Message });
            }
        }
    }

    /// <summary>At start-up: a match whose last content was never confirmed and has nothing queued is sent again.</summary>
    private void ResyncUnconfirmed()
    {
        foreach (var record in _store.All())
        {
            if (record.Queue.Count > 0 || record.Base is null) continue;
            if (record.Confirmed?.ContentHash == ScoutSync.HashScoutLines(record.Base.Lines)) continue;
            _log.Info("stato non confermato dal server: nuovo snapshot", new Dictionary<string, object?> { ["matchKey"] = record.MatchKey });
            Resnapshot(record, record.NextSeq);
        }
    }

    private void Backoff(double retryAfterMs = 0)
    {
        _failures++;
        var delay = Math.Min(_timing.RetryMaxMs, _timing.RetryBaseMs * Math.Pow(2, Math.Min(_failures - 1, 20)));
        var jittered = (delay / 2) + (_random() * delay / 2);
        _nextAttemptAt = Now + (long)Math.Max(jittered, Math.Min(retryAfterMs, 60_000));
    }

    private void Delivered()
    {
        _failures = 0;
        _nextAttemptAt = 0;
        _lastSuccessAt = Now;
        if (!_serverReachable || _authBlocked) _log.Info("server di nuovo raggiungibile");
        _serverReachable = true;
        _authBlocked = false;
    }

    /// <summary>Delivers the queue in order until it is empty or a request fails. `force`: ignore the backoff.</summary>
    private async Task FlushAsync(bool force, CancellationToken cancel)
    {
        try
        {
            while (force || Now >= _nextAttemptAt)
            {
                if (cancel.IsCancellationRequested) return;
                var record = _store.NextToSend();
                if (record is null || record.Queue.Count == 0) return;
                if (!await DeliverAsync(record, record.Queue[0].Request, cancel).ConfigureAwait(false)) return;
            }
        }
        catch (Exception e)
        {
            // Never stops the loop (as the Node agent): logged, then backoff.
            _log.Error("errore nella gestione della coda", new Dictionary<string, object?> { ["err"] = e.Message });
            Backoff();
        }
    }

    private async Task<bool> DeliverAsync(MatchRecord record, IngestRequest request, CancellationToken cancel)
    {
        var result = await _sender.SendAsync(request, cancel).ConfigureAwait(false);
        var ctx = new Dictionary<string, object?> { ["matchKey"] = request.MatchKey, ["seq"] = request.Seq, ["kind"] = request.Kind, ["lines"] = request.Lines.Count };
        switch (result)
        {
            case SendResult.Network network:
                if (_serverReachable)
                {
                    _log.Warn("server non raggiungibile: i dati restano in coda", new Dictionary<string, object?>(ctx) { ["err"] = network.Message, ["queue"] = _store.QueueSize() });
                }
                _serverReachable = false;
                Backoff();
                return false;
            case SendResult.Http http:
                _registrationExpired = http.Expired;
                return HandleHttpError(record, request, http.Status, http.RetryAfterMs, ctx);
            case SendResult.Ok ok:
                _registrationExpired = false;
                Delivered();
                HandleResponse(record, request, ok.Response, ctx);
                return true;
            default:
                return false;
        }
    }

    private void HandleResponse(MatchRecord record, IngestRequest request, IngestResponse response, Dictionary<string, object?> ctx)
    {
        var confirmed = new Confirmed { Seq = response.Seq, LineCount = response.LineCount, ContentHash = response.ContentHash, At = Json.IsoTime(_time.GetUtcNow()) };
        var inSync = response.Status == "ok" ||
                     (response.Status == "duplicate" && response.Seq == request.Seq && response.ContentHash == request.ContentHash);
        if (inSync)
        {
            _log.Debug("inviato", new Dictionary<string, object?>(ctx) { ["status"] = response.Status });
            _store.Save(record with { NextSeq = Math.Max(record.NextSeq, response.Seq + 1), Confirmed = confirmed, Queue = [.. record.Queue.Skip(1)] });
            return;
        }
        var updated = record with { Confirmed = confirmed };
        if (response.Status == "needSnapshot" && request.Kind == IngestKind.Snapshot)
        {
            // Should not happen (a snapshot carries the header): do not loop, wait for the next change.
            _log.Error("snapshot rifiutato dal server: riprovo alla prossima modifica o più tardi", new Dictionary<string, object?>(ctx) { ["status"] = response.Status });
            _store.Save(updated with
            {
                NextSeq = Math.Max(record.NextSeq, response.Seq + 1),
                Queue = [],
                ForceSnapshot = true,
                RetrySnapshotAt = Now + _config.SnapshotRetryMs,
            });
            return;
        }
        _log.Warn("server non allineato: invio uno snapshot", new Dictionary<string, object?>(ctx) { ["status"] = response.Status, ["serverSeq"] = response.Seq });
        Resnapshot(updated, response.Seq + 1);
    }

    private bool HandleHttpError(MatchRecord record, IngestRequest request, int status, double? retryAfterMs, Dictionary<string, object?> ctx)
    {
        if (status is 401 or 403)
        {
            if (!_authBlocked)
            {
                var what = _registrationExpired ? Contract.AgentExpiredError : AuthMessage;
                _log.Error($"{what}: nuovo tentativo tra {Math.Round(_timing.AuthPauseMs / 1000.0)} s, la coda è conservata",
                    new Dictionary<string, object?> { ["status"] = status, ["queue"] = _store.QueueSize() });
            }
            _authBlocked = true;
            _nextAttemptAt = Now + _timing.AuthPauseMs;
            return false;
        }
        if (status is 408 or 429 or >= 500)
        {
            if (_serverReachable) _log.Warn("errore temporaneo del server: nuovo tentativo", new Dictionary<string, object?>(ctx) { ["status"] = status });
            _serverReachable = false;
            Backoff(retryAfterMs ?? 0);
            return false;
        }
        // Other 4xx: the request will never be accepted. Drop it; the match is realigned with a snapshot.
        _failures = 0;
        _serverReachable = true;
        if (status == 413)
        {
            _log.Error("richiesta troppo grande per il server (413): scartata, riprovo con uno snapshot alla prossima modifica o più tardi", new Dictionary<string, object?>(ctx) { ["status"] = status });
        }
        else
        {
            _log.Error("richiesta rifiutata dal server: scartata", new Dictionary<string, object?>(ctx) { ["status"] = status });
        }
        if (status == 413 || request.Kind == IngestKind.Snapshot)
        {
            _store.Save(record with { Queue = [], ForceSnapshot = true, RetrySnapshotAt = Now + _config.SnapshotRetryMs });
        }
        else
        {
            Resnapshot(record with { Queue = [] }, record.NextSeq);
        }
        return true;
    }
}
