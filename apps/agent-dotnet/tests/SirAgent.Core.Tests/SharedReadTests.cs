using System.Diagnostics;
using System.Text;

namespace SirAgent.Core.Tests;

/// <summary>
/// The `.dvw` is never locked by the agent: it is read while another writer and another reader have it open, the
/// writer can rewrite, replace and delete it, and once the read is over no handle is left (an exclusive open works).
/// </summary>
public sealed class SharedReadTests
{
    private static readonly byte[] Original = File.ReadAllBytes(Path.Combine(Repo.Root, "packages", "dvw-parser", "test", "fixtures", "partita.dvw"));

    [Fact]
    public void Legge_con_un_altro_scrittore_e_un_altro_lettore_aperti()
    {
        using var dir = new TempDir();
        var file = dir.File("partita.dvw");
        File.WriteAllBytes(file, Original);
        // DataVolley with the file open for writing (sharing reads) and another program reading it.
        using var writer = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete);
        using var otherReader = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var outcome = Assert.IsType<ReadOutcome.Ok>(SharedFileReader.ReadAll(file));
        Assert.Equal(Original, outcome.Bytes);
        // The writer keeps working while the agent reads: rewrite from the start and truncate.
        writer.SetLength(0);
        writer.Write(Encoding.ASCII.GetBytes("[3SCOUT]\n*p01:00;\n"));
        writer.Flush();
        var again = Assert.IsType<ReadOutcome.Ok>(SharedFileReader.ReadAll(file));
        Assert.Equal("[3SCOUT]\n*p01:00;\n", Encoding.ASCII.GetString(again.Bytes));
    }

    [Fact]
    public void Dopo_la_lettura_non_resta_nessun_handle()
    {
        using var dir = new TempDir();
        var file = dir.File("partita.dvw");
        File.WriteAllBytes(file, Original);
        for (var i = 0; i < 20; i++) Assert.IsType<ReadOutcome.Ok>(SharedFileReader.ReadAll(file));
        // An exclusive open fails if any handle (ours included) were still open.
        using (var exclusive = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Assert.True(exclusive.CanWrite);
        }
        File.Delete(file);
        Assert.False(File.Exists(file));
    }

    [Fact]
    public void Con_il_file_aperto_in_lettura_lo_scrittore_puo_sostituirlo_e_cancellarlo()
    {
        using var dir = new TempDir();
        var file = dir.File("partita.dvw");
        File.WriteAllBytes(file, Original);
        // Same flags of SharedFileReader: a read in progress never stops a «tmp + rename» save or a delete.
        using (var reading = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            var tmp = dir.File("partita.tmp");
            File.WriteAllBytes(tmp, Encoding.ASCII.GetBytes("[3SCOUT]\n"));
            File.Move(tmp, file, overwrite: true);
            Assert.Equal(Original.Length, reading.Length);
        }
        Assert.Equal("[3SCOUT]\n", File.ReadAllText(file));
        using (new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        {
            File.Delete(file);
        }
        Assert.False(File.Exists(file));
    }

    [Fact]
    public void File_tenuto_in_esclusiva_da_chi_scrive_e_occupato_non_errore()
    {
        using var dir = new TempDir();
        var file = dir.File("partita.dvw");
        File.WriteAllBytes(file, Original);
        using var exclusive = new FileStream(file, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var outcome = SharedFileReader.ReadAll(file);
        // Windows: sharing violation → Busy. Elsewhere the sharing modes are advisory and the read can succeed.
        if (OperatingSystem.IsWindows()) Assert.IsType<ReadOutcome.Busy>(outcome);
        else Assert.True(outcome is ReadOutcome.Busy or ReadOutcome.Ok);
    }

    [Fact]
    public void File_che_manca_e_missing()
    {
        using var dir = new TempDir();
        Assert.IsType<ReadOutcome.Missing>(SharedFileReader.ReadAll(dir.File("nessuno.dvw")));
        Assert.IsType<ReadOutcome.Missing>(SharedFileReader.ReadAll(Path.Combine(dir.Path, "manca", "x.dvw")));
    }

    [Fact]
    public async Task Letture_continue_mentre_un_thread_riscrive_il_file()
    {
        using var dir = new TempDir();
        var file = dir.File("partita.dvw");
        File.WriteAllBytes(file, Original);
        using var stop = new CancellationTokenSource();
        var writes = 0;
        var writerErrors = new List<Exception>();
        // DataVolley-like writer: rewrites the whole file, in place and with «tmp + rename», as fast as it can.
        var writer = Task.Run(() =>
        {
            var tmp = dir.File("partita.tmp");
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    if (writes % 2 == 0)
                    {
                        using var w = new FileStream(file, FileMode.Create, FileAccess.Write, FileShare.Read);
                        w.Write(Original);
                    }
                    else
                    {
                        File.WriteAllBytes(tmp, Original);
                        File.Move(tmp, file, overwrite: true);
                    }
                    writes++;
                }
                catch (IOException e)
                {
                    writerErrors.Add(e);
                }
            }
        }, TestContext.Current.CancellationToken);
        var reads = 0;
        var complete = 0;
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 1500)
        {
            var outcome = SharedFileReader.ReadAll(file);
            Assert.IsNotType<ReadOutcome.Missing>(outcome);
            if (outcome is ReadOutcome.Ok ok)
            {
                reads++;
                if (ok.Bytes.AsSpan().SequenceEqual(Original)) complete++;
                // A partial read is possible (the writer truncated it): it is never longer than the file.
                Assert.True(ok.Bytes.Length <= Original.Length);
            }
        }
        await stop.CancelAsync();
        await writer;
        Assert.True(writes > 10, $"scritture {writes}");
        Assert.True(reads > 10, $"letture {reads}");
        Assert.True(complete > 0);
        // The writer was never blocked by the reads.
        Assert.Empty(writerErrors);
    }

    [Fact]
    public void Letture_mentre_un_secondo_processo_riscrive_il_file()
    {
        if (!OperatingSystem.IsLinux() && !OperatingSystem.IsMacOS()) return; // on Windows the thread test above covers it
        using var dir = new TempDir();
        var file = dir.File("partita.dvw");
        var source = dir.File("sorgente.dvw");
        File.WriteAllBytes(source, Original);
        File.WriteAllBytes(file, Original);
        var script = $"i=0; while [ $i -lt 400 ]; do cat '{source}' > '{file}'; cp '{source}' '{file}.tmp'; mv -f '{file}.tmp' '{file}'; i=$((i+1)); done";
        using var writer = Process.Start(new ProcessStartInfo("/bin/sh", ["-c", script]) { RedirectStandardError = true, UseShellExecute = false })!;
        var reads = 0;
        while (!writer.HasExited)
        {
            var outcome = SharedFileReader.ReadAll(file);
            if (outcome is ReadOutcome.Ok) reads++;
        }
        writer.WaitForExit();
        Assert.Equal(0, writer.ExitCode);
        Assert.Equal("", writer.StandardError.ReadToEnd());
        Assert.True(reads > 0);
        Assert.Equal(Original, File.ReadAllBytes(file));
    }
}
