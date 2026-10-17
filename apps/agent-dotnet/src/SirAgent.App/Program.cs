using System.Runtime.InteropServices;
using System.ServiceProcess;
using SirAgent.Core;

namespace SirAgent.App;

internal static partial class Program
{
    private const int AttachParentProcess = -1;

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AttachConsole(int processId);

    /// <summary>Folder of the executable (also for the single-file exe and for the service, whose current folder is System32).</summary>
    internal static string BaseDir => Path.GetDirectoryName(Environment.ProcessPath) ?? AppContext.BaseDirectory;

    [STAThread]
    private static int Main(string[] args)
    {
        CliOptions options;
        try
        {
            options = Cli.Parse(args);
        }
        catch (CliException e)
        {
            AttachConsole(AttachParentProcess);
            Console.Error.WriteLine($"{e.Message}\n\n{Cli.Help}");
            return 1;
        }
        switch (options.Mode)
        {
            case RunMode.Window:
                ApplicationConfiguration.Initialize();
                return WindowHost.Run(options, BaseDir);
            case RunMode.Service:
                ServiceBase.Run(new AgentService(options, BaseDir));
                return 0;
            case RunMode.Help:
                AttachConsole(AttachParentProcess);
                Console.Out.WriteLine(Cli.Help);
                return 0;
            default:
                AttachConsole(AttachParentProcess);
                return RunConsole(options);
        }
    }

    /// <summary>`--config`, `--console`, `--once`: until Ctrl+C (exit code of `HeadlessRunner`).</summary>
    private static int RunConsole(CliOptions options)
    {
        using var stop = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            stop.Cancel();
        };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => stop.Cancel();
        return HeadlessRunner.RunAsync(options, BaseDir, Console.Error, Console.Out, stop.Token).GetAwaiter().GetResult();
    }
}

/// <summary>
/// Windows service (`sir-agent.exe --service`, installed with `scripts/installa-servizio.ps1`): reads continuously
/// with `config.json` next to the executable, waits for the lock if another agent is reading.
/// </summary>
internal sealed class AgentService : ServiceBase
{
    private readonly CliOptions _options;
    private readonly string _baseDir;
    private CancellationTokenSource? _stop;
    private Task<int>? _run;

    public AgentService(CliOptions options, string baseDir)
    {
        _options = options with { Mode = RunMode.Continuous, Console = false };
        _baseDir = baseDir;
        ServiceName = "SIRAgent";
        CanStop = true;
        CanShutdown = true;
        AutoLog = true;
    }

    protected override void OnStart(string[] args)
    {
        _stop = new CancellationTokenSource();
        var token = _stop.Token;
        _run = Task.Run(async () =>
        {
            // Configuration errors (before the log exists) go to logs\servizio-errori.log next to the executable.
            var errors = Path.Combine(_baseDir, "logs");
            Directory.CreateDirectory(errors);
            await using var stderr = new StreamWriter(Path.Combine(errors, "servizio-errori.log"), append: true) { AutoFlush = true };
            var code = await HeadlessRunner.RunAsync(_options, _baseDir, stderr, null, token).ConfigureAwait(false);
            if (code != 0 && !token.IsCancellationRequested)
            {
                ExitCode = code;
                Stop();
            }
            return code;
        }, token);
    }

    protected override void OnStop() => Finish();

    protected override void OnShutdown() => Finish();

    private void Finish()
    {
        _stop?.Cancel();
        try
        {
            _run?.Wait(TimeSpan.FromSeconds(20));
        }
        catch (AggregateException)
        {
            // already logged by the agent
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _stop?.Dispose();
        base.Dispose(disposing);
    }
}
