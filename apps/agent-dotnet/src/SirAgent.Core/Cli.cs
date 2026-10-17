namespace SirAgent.Core;

public enum RunMode
{
    Window,
    Continuous,
    Once,
    Service,
    Help,
}

public sealed record CliOptions(RunMode Mode, string? ConfigPath, bool Console);

public sealed class CliException(string message) : Exception(message);

/// <summary>Command line of `sir-agent.exe`: same options as the Node agent, plus `--service` (Windows service).</summary>
public static class Cli
{
    public const string Help = """
        sir-agent: legge il file .dvw di DataVolley e invia le azioni al server SIRRealtime

        Uso: sir-agent                      finestra (anche con doppio clic sull'eseguibile)
             sir-agent --gui [--config <file>]
             sir-agent [--config <file>] [--console] [--once]
             sir-agent --service [--config <file>]

          --gui            finestra con cartella del .dvw, registrazione, START e STOP (è il modo senza argomenti)
          --config <file>  configurazione (default: config.json accanto all'eseguibile)
          --console        log anche sulla console, oltre che su file
          --once           legge il file una volta, invia la coda e termina
                           (codice di uscita 0 tutto inviato, 2 dati rimasti in coda, 3 nessun file .dvw letto;
                           1 configurazione non valida o errore)
          --service        servizio di Windows (lo avvia Gestione servizi: vedi installa-servizio.ps1)
          --help           questo aiuto

        Con --config o --service l'agente legge di continuo; se un'altra istanza usa la stessa cartella dati
        (lucchetto agent.lock) attende che finisca e riprova ogni 30 secondi.
        """;

    public static CliOptions Parse(IReadOnlyList<string> args)
    {
        string? config = null;
        bool console = false, once = false, gui = false, service = false, help = false;
        for (var i = 0; i < args.Count; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--config":
                    if (i + 1 >= args.Count || args[i + 1].StartsWith("--", StringComparison.Ordinal)) throw new CliException("Opzione --config senza file");
                    config = args[++i];
                    break;
                case "--console": console = true; break;
                case "--once": once = true; break;
                case "--gui": gui = true; break;
                case "--service": service = true; break;
                case "--help" or "-h": help = true; break;
                default:
                    if (a.StartsWith("--config=", StringComparison.Ordinal) && a.Length > 9)
                    {
                        config = a[9..];
                        break;
                    }
                    throw new CliException($"Opzione sconosciuta: {a}");
            }
        }
        if (help) return new CliOptions(RunMode.Help, config, console);
        if (gui && (once || console)) throw new CliException("--gui non si usa con --once o --console");
        if (service && (once || gui)) throw new CliException("--service non si usa con --once o --gui");
        if (service) return new CliOptions(RunMode.Service, config, false);
        if (gui || args.Count == 0) return new CliOptions(RunMode.Window, config, false);
        return new CliOptions(once ? RunMode.Once : RunMode.Continuous, config, console);
    }
}

/// <summary>Console, `--once` and service: the agent without the window.</summary>
public static class HeadlessRunner
{
    /// <summary>Runs the agent; returns the exit code. `stderr` receives the configuration errors.</summary>
    public static async Task<int> RunAsync(CliOptions options, string baseDir, TextWriter stderr, TextWriter? console, CancellationToken cancel, HttpClient? http = null, TimeSpan? lockRetry = null)
    {
        var configPath = options.ConfigPath is null ? ConfigFile.DefaultPath(baseDir) : Path.GetFullPath(options.ConfigPath, baseDir);
        AgentConfig config;
        try
        {
            config = ConfigFile.Load(configPath, baseDir);
        }
        catch (ConfigException e)
        {
            await stderr.WriteLineAsync(e.Message).ConfigureAwait(false);
            return 1;
        }
        try
        {
            Directory.CreateDirectory(config.DataDir);
            Directory.CreateDirectory(config.LogDir);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or NotSupportedException or ArgumentException)
        {
            await stderr.WriteLineAsync($"Cartella dati o log non creata ({config.DataDir}, {config.LogDir}): {e.Message}").ConfigureAwait(false);
            return 1;
        }
        using var logger = new AgentLogger(config.LogLevel, new RotatingFileLog(config.LogDir), options.Console ? console : null);
        logger.AddSecret(config.AgentToken);
        using var client = http ?? AgentHttp.CreateClient();
        try
        {
            if (options.Mode == RunMode.Once)
            {
                var once = Agent.Create(config, logger, client);
                return await once.RunOnceAsync(Math.Max(30_000, config.StableMs * 10), cancel).ConfigureAwait(false);
            }
            // Continuous reading: one agent per data folder, taken before the queue is loaded; it waits instead of
            // exiting so that the service manager does not restart it in a loop.
            using var held = await AgentLock.WaitAsync(
                config.DataDir,
                pid => logger.Warn($"un'altra istanza dell'agente è attiva (pid {pid}): attendo", new Dictionary<string, object?> { ["pid"] = pid }),
                cancel,
                lockRetry).ConfigureAwait(false);
            if (held is null) return 0;
            var agent = Agent.Create(config, logger, client);
            await agent.RunAsync(cancel).ConfigureAwait(false);
            return 0;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException or LockHeldException)
        {
            logger.Fatal("errore fatale", new Dictionary<string, object?> { ["err"] = e.Message });
            return 1;
        }
    }
}
