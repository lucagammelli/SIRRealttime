using System.Text.Json.Nodes;
using SirAgent.Core;

namespace SirAgent.App;

/// <summary>Window mode (double click): logger, graphics of the client, controller and form.</summary>
internal static class WindowHost
{
    private sealed class RunnableAgent(Agent agent) : IRunnableAgent
    {
        public Task RunAsync(CancellationToken cancel) => agent.RunAsync(cancel);
        public AgentStatus Status() => agent.Status();
    }

    public static int Run(CliOptions options, string baseDir)
    {
        var configPath = options.ConfigPath is null ? ConfigFile.DefaultPath(baseDir) : Path.GetFullPath(options.ConfigPath, baseDir);
        JsonObject? raw = null;
        try
        {
            raw = ConfigFile.ReadRaw(configPath);
        }
        catch (ConfigException)
        {
            // shown by the controller in the window
        }
        // dataDir or logDir on the USB stick: the logs of the window go to %TEMP%\SIRAgent (nothing written on the stick).
        var paths = ConfigFile.GuiWritablePaths(raw, baseDir, Path.Combine(Path.GetTempPath(), "SIRAgent"));
        var sink = new LogSink();
        using var logger = new AgentLogger(paths.Level, new RotatingFileLog(paths.LogDir));
        logger.Entry += sink.Add;
        var branding = Branding.Read(baseDir);
        foreach (var problem in branding.Problems) logger.Warn(problem);
        using var http = AgentHttp.CreateClient();
        using var form = new MainForm();
        using var controller = new GuiController(
            configPath,
            baseDir,
            logger,
            form,
            config => new RunnableAgent(Agent.Create(config, logger, http)),
            createRegistrationApi: serverUrl => new RegistrationClient(http, serverUrl),
            startupError: paths.Problem,
            branding: branding.Branding);
        form.Attach(controller, sink);
        Application.Run(form);
        return 0;
    }
}
