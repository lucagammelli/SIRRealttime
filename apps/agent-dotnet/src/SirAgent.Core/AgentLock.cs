using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SirAgent.Core;

/// <summary>Another agent (service, console or window, Node or C#) is reading with the same `dataDir`.</summary>
public sealed class LockHeldException(int pid, string message) : Exception(message)
{
    public int Pid { get; } = pid;
}

/// <summary>
/// `&lt;dataDir&gt;/agent.lock` with `pid` and `startedAt`, created exclusively: the same file of the Node agent, so the
/// two agents also exclude each other. A lock whose process is gone, written before the boot of the PC, with our own
/// pid or unreadable is stale and replaced.
/// </summary>
public sealed class AgentLock : IDisposable
{
    private sealed record LockInfo
    {
        [JsonPropertyName("pid")] public int Pid { get; init; }
        [JsonPropertyName("startedAt")] public string StartedAt { get; init; } = "";
    }

    /// <summary>A lock written up to this long before the computed boot time still counts (clock adjustments).</summary>
    private static readonly TimeSpan BootSlack = TimeSpan.FromSeconds(60);

    private readonly int _pid;
    private bool _released;

    private AgentLock(string file, int pid)
    {
        File = file;
        _pid = pid;
    }

    public string File { get; }

    public static string PathOf(string dataDir) => Path.Combine(dataDir, "agent.lock");

    public static bool IsProcessAlive(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return !p.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            // Exists but cannot be inspected (another user, e.g. the service): alive.
            return true;
        }
    }

    private static LockInfo? Read(string file)
    {
        try
        {
            var info = JsonSerializer.Deserialize<LockInfo>(System.IO.File.ReadAllText(file), Json.Compact);
            return info is { Pid: >= 1 } ? info : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    /// <summary>Takes the lock; throws `LockHeldException` when another live agent holds it.</summary>
    public static AgentLock Acquire(string dataDir, int? pid = null, TimeProvider? time = null, Func<int, bool>? isAlive = null, Func<DateTimeOffset>? bootTime = null)
    {
        var self = pid ?? Environment.ProcessId;
        var clock = time ?? TimeProvider.System;
        var alive = isAlive ?? IsProcessAlive;
        var boot = bootTime ?? (() => clock.GetUtcNow() - TimeSpan.FromMilliseconds(Environment.TickCount64));
        bool IsHeld(LockInfo holder)
        {
            if (holder.Pid == self) return false;
            var started = Json.ParseIsoTime(holder.StartedAt);
            if (started is null || started.Value < boot() - BootSlack) return false;
            return alive(holder.Pid);
        }

        var file = PathOf(dataDir);
        Directory.CreateDirectory(dataDir);
        var content = JsonSerializer.Serialize(new LockInfo { Pid = self, StartedAt = Json.IsoTime(clock.GetUtcNow()) }, Json.Compact);
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                using (var stream = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    stream.Write(System.Text.Encoding.UTF8.GetBytes(content));
                }
                return new AgentLock(file, self);
            }
            catch (IOException) when (System.IO.File.Exists(file))
            {
                // exists: check who holds it
            }
            var holder = Read(file);
            if (holder is not null && IsHeld(holder))
            {
                throw new LockHeldException(holder.Pid,
                    $"Un'altra istanza dell'agente è già in lettura (pid {holder.Pid}, per esempio il servizio SIRAgent): fermala prima di avviare questa");
            }
            if (attempt >= 2) throw new LockHeldException(holder?.Pid ?? 0, $"Impossibile prendere il lucchetto {file}: riprova");
            // Stale (or unreadable): replaced. Two processes replacing the same stale lock at the same moment can race
            // (known limit, as in the Node agent).
            AtomicFile.Delete(file);
        }
    }

    /// <summary>Console and service: waits for the lock (retry every `retry`); null if cancelled.</summary>
    public static async Task<AgentLock?> WaitAsync(string dataDir, Action<int> onWait, CancellationToken cancel, TimeSpan? retry = null)
    {
        var warned = false;
        while (!cancel.IsCancellationRequested)
        {
            try
            {
                return Acquire(dataDir);
            }
            catch (LockHeldException e)
            {
                if (!warned) onWait(e.Pid);
                warned = true;
            }
            try
            {
                await Task.Delay(retry ?? TimeSpan.FromSeconds(30), cancel).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                return null;
            }
        }
        return null;
    }

    /// <summary>Removes the lock file, only if it is still ours.</summary>
    public void Release()
    {
        if (_released) return;
        _released = true;
        if (Read(File)?.Pid == _pid) AtomicFile.Delete(File);
    }

    public void Dispose() => Release();
}
