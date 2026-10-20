namespace ArenaLive.Agent.Core;

public abstract record WatchEvent
{
    private WatchEvent() { }

    /// <summary>Nothing to do (no change, or a change not yet stable).</summary>
    public sealed record Idle : WatchEvent;

    /// <summary>Path (or every `.dvw` in the folder) not found: USB stick removed?</summary>
    public sealed record Missing(string Reason) : WatchEvent;

    /// <summary>File locked by DataVolley: retried at the next poll.</summary>
    public sealed record Busy(string Path, string Code) : WatchEvent;

    /// <summary>Stable content read.</summary>
    public sealed record Read(string Path, byte[] Bytes) : WatchEvent;
}

/// <summary>Outcome of a single read of the `.dvw`.</summary>
public abstract record ReadOutcome
{
    private ReadOutcome() { }
    public sealed record Ok(byte[] Bytes) : ReadOutcome;
    public sealed record Busy(string Code) : ReadOutcome;
    public sealed record Missing(string Code) : ReadOutcome;
}

/// <summary>
/// Reads the `.dvw` without ever getting in the way of DataVolley: opened only for reading, sharing read, write and
/// delete (DataVolley can rewrite, truncate or replace the file while it is open here), read in one go and closed at
/// once. No handle is kept between two polls. A file that cannot be opened now is `Busy`: retried at the next poll.
/// </summary>
public static class SharedFileReader
{
    private const int SharingViolation = unchecked((int)0x80070020);
    private const int LockViolation = unchecked((int)0x80070021);

    public static ReadOutcome ReadAll(string path)
    {
        try
        {
            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete,
                bufferSize: 1,
                FileOptions.SequentialScan);
            // The length can change while reading (the file is not locked): read until the end, whatever it is.
            using var memory = new MemoryStream(stream.CanSeek ? (int)Math.Min(stream.Length, int.MaxValue) : 0);
            stream.CopyTo(memory, 81920);
            return new ReadOutcome.Ok(memory.ToArray());
        }
        catch (FileNotFoundException)
        {
            return new ReadOutcome.Missing("ENOENT");
        }
        catch (DirectoryNotFoundException)
        {
            return new ReadOutcome.Missing("ENOENT");
        }
        catch (DriveNotFoundException)
        {
            return new ReadOutcome.Missing("ENOENT");
        }
        catch (UnauthorizedAccessException)
        {
            return new ReadOutcome.Busy("EACCES");
        }
        catch (IOException e) when (e.HResult is SharingViolation or LockViolation)
        {
            return new ReadOutcome.Busy("EBUSY");
        }
        catch (IOException)
        {
            // Other I/O errors (stick being removed, file system busy): as Node, treat them as a busy file.
            return new ReadOutcome.Busy("EIO");
        }
    }
}

/// <summary>
/// Polling watcher (`FileWatcher` of the Node agent): finds the `.dvw` (the given file, or the most recently modified
/// one in the folder) and returns its bytes once size and mtime stayed the same for `stableMs`. Never throws for file
/// system errors.
/// </summary>
public sealed class FileWatcher(string watchPath, int stableMs, int rereadMs)
{
    private sealed record Observed(string Path, long Size, long MtimeTicks);

    private Observed? _observed;
    private long _observedSince;
    private Observed? _lastRead;
    private long _lastReadAt;
    private bool _rereadRequested;

    public string WatchPath { get; } = watchPath;

    /// <summary>Reads used in tests to simulate a locked file.</summary>
    internal Func<string, ReadOutcome> Reader { get; set; } = SharedFileReader.ReadAll;

    /// <summary>Asks for a new read at the next stable poll, even if the file did not change.</summary>
    public void RequestReread() => _rereadRequested = true;

    /// <summary>Forgets the last read: the next stable poll reads the file again.</summary>
    public void Reset() => _lastRead = null;

    private static bool Same(Observed? a, Observed b) => a is not null && a == b;

    /// <summary>One poll at time `now` (milliseconds of a monotonic clock).</summary>
    public WatchEvent Poll(long now)
    {
        var located = Locate(out var reason);
        if (located is null)
        {
            _observed = null;
            return new WatchEvent.Missing(reason);
        }
        if (!Same(_observed, located))
        {
            _observed = located;
            _observedSince = now;
            if (stableMs > 0) return new WatchEvent.Idle();
        }
        if (now - _observedSince < stableMs) return new WatchEvent.Idle();

        var due = _lastRead is null || !Same(_lastRead, located) ||
                  (_rereadRequested && now - _lastReadAt >= stableMs) || now - _lastReadAt >= rereadMs;
        if (!due) return new WatchEvent.Idle();

        byte[] bytes;
        switch (Reader(located.Path))
        {
            case ReadOutcome.Ok ok:
                bytes = ok.Bytes;
                break;
            case ReadOutcome.Busy busy:
                return new WatchEvent.Busy(located.Path, busy.Code);
            case ReadOutcome.Missing missing:
                _observed = null;
                return new WatchEvent.Missing($"{located.Path}: {missing.Code}");
            default:
                return new WatchEvent.Idle();
        }
        // The file changed while it was being read: wait for the next stable state.
        var after = StatOf(located.Path);
        if (after is null || !Same(located, after) || bytes.LongLength != located.Size)
        {
            _observed = after;
            _observedSince = now;
            return new WatchEvent.Idle();
        }
        _lastRead = located;
        _lastReadAt = now;
        _rereadRequested = false;
        return new WatchEvent.Read(located.Path, bytes);
    }

    private static Observed? StatOf(string path)
    {
        try
        {
            var info = new FileInfo(path);
            return info.Exists ? new Observed(path, info.Length, info.LastWriteTimeUtc.Ticks) : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return null;
        }
    }

    private static bool IgnoredName(string name) =>
        name.StartsWith('.') || name.StartsWith('~') || !name.EndsWith(".dvw", StringComparison.OrdinalIgnoreCase);

    private Observed? Locate(out string reason)
    {
        reason = "";
        try
        {
            if (File.Exists(WatchPath))
            {
                return StatOf(WatchPath) ?? Fail($"{WatchPath} non raggiungibile (ENOENT)", out reason);
            }
            if (!Directory.Exists(WatchPath))
            {
                return Fail($"{WatchPath} non raggiungibile (ENOENT)", out reason);
            }
            string[] names;
            try
            {
                names = Directory.GetFiles(WatchPath);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                return Fail($"{WatchPath} non leggibile ({(e is UnauthorizedAccessException ? "EACCES" : "EIO")})", out reason);
            }
            Observed? best = null;
            foreach (var file in names)
            {
                if (IgnoredName(Path.GetFileName(file))) continue;
                var s = StatOf(file);
                if (s is not null && (best is null || s.MtimeTicks > best.MtimeTicks)) best = s;
            }
            return best ?? Fail($"nessun file .dvw in {WatchPath}", out reason);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            return Fail($"{WatchPath} non raggiungibile (errore)", out reason);
        }
    }

    private static Observed? Fail(string message, out string reason)
    {
        reason = message;
        return null;
    }
}
