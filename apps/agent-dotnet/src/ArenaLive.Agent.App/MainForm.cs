using System.Globalization;
using ArenaLive.Agent.Core;

namespace ArenaLive.Agent.App;

/// <summary>
/// Window of the agent, same layout and texts of the PowerShell window of the Node agent (`window.ps1`): folder of
/// the `.dvw`, server, self-registration with pairing code, token as alternative, START/STOP, state, last messages,
/// graphics of the client. The token field stays as an alternative, hidden under «Avanzate» (closed by default).
/// Every call from the controller is marshalled to the UI thread.
/// </summary>
internal sealed class MainForm : Form, IAgentWindow
{
    private static readonly string DefaultTitle = $"ArenaLive – Agente {AppVersion.Current}";
    private const int MaxMessages = 200;
    private const int Margin_ = 12;
    private const int FieldColumn = 170;
    private const int FormWidth = 640;
    private const int RowHeight = 32;
    private const int HeaderHeight = 64;
    private const int LogoWidth = 140;
    private const string AdvancedClosedText = "Avanzate ▸";
    private const string AdvancedOpenText = "Avanzate ▾";
    private const string RegHintText = "Scrivi il nome e premi «Registra», oppure usa un token in «Avanzate»";

    private readonly TextBox _txtFolder = new();
    private readonly Button _btnBrowse = new() { Text = "Sfoglia…" };
    private readonly TextBox _txtServer = new() { ReadOnly = true };
    private readonly TextBox _txtName = new() { MaxLength = 100, Text = Environment.MachineName };
    private readonly Button _btnRegister = new() { Text = "Registra" };
    private readonly Button _btnCancelReg = new() { Text = "Annulla", Visible = false };
    private readonly Label _lblPairing = new() { TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label _lblRegState = new() { TextAlign = ContentAlignment.MiddleLeft, ForeColor = Color.DimGray };
    private readonly LinkLabel _lnkAdvanced = new() { Text = AdvancedClosedText };
    private readonly Label _lblToken = new() { Text = "Token agente (alternativa)", Visible = false };
    private readonly TextBox _txtToken = new() { UseSystemPasswordChar = true, Visible = false };
    private readonly Label _lblTokenInfo = new() { Text = "mancante", Visible = false };
    private readonly Button _btnStart = new() { Text = "START" };
    private readonly Button _btnStop = new() { Text = "STOP" };
    private readonly Label _lblState = new() { Text = "In attesa dell'agente…" };
    private readonly Label _lblDetails = new();
    private readonly Label _lblError = new() { ForeColor = Color.Firebrick };
    private readonly ListBox _lstLog = new() { Dock = DockStyle.Fill, HorizontalScrollbar = true };
    private readonly ContextMenuStrip _menuBrowse = new();

    private GuiController? _controller;
    private LogSink? _sink;
    private GuiPhase? _phase;
    private bool _tokenPresent;
    private string _regState = "none";
    private bool _regBusy;
    private bool _brandingApplied;
    private bool _closingConfirmed;
    private string _title = DefaultTitle;
    private bool _advancedOpen;
    private Control[] _belowAdvanced = [];

    public MainForm()
    {
        Text = DefaultTitle;
        Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? Application.ExecutablePath);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9);
        AutoScaleMode = AutoScaleMode.Font;
        BuildLayout();
        WireEvents();
        UpdateControls();
    }

    public void Attach(GuiController controller, LogSink sink)
    {
        _controller = controller;
        _sink = sink;
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        var controller = _controller;
        var sink = _sink;
        Task.Run(() => controller?.Init(sink));
    }

    private Label NewLabel(string text, int x, int top, int width)
    {
        var label = new Label { Text = text, Location = new Point(x, top + 3), Size = new Size(width, 20) };
        Controls.Add(label);
        return label;
    }

    private void BuildLayout()
    {
        var y = Margin_;
        var fieldWidth = FormWidth - FieldColumn - Margin_;

        NewLabel("Cartella del .dvw", Margin_, y, FieldColumn - Margin_);
        _txtFolder.Location = new Point(FieldColumn, y);
        _txtFolder.Size = new Size(fieldWidth - 100, 23);
        _btnBrowse.Location = new Point(FormWidth - Margin_ - 92, y - 1);
        _btnBrowse.Size = new Size(92, 26);
        Controls.AddRange([_txtFolder, _btnBrowse]);
        y += RowHeight;

        NewLabel("Server", Margin_, y, FieldColumn - Margin_);
        _txtServer.Location = new Point(FieldColumn, y);
        _txtServer.Size = new Size(fieldWidth, 23);
        Controls.Add(_txtServer);
        y += RowHeight;

        NewLabel("Nome agente", Margin_, y, FieldColumn - Margin_);
        _txtName.Location = new Point(FieldColumn, y);
        _txtName.Size = new Size(fieldWidth - 100, 23);
        _btnRegister.Location = new Point(FormWidth - Margin_ - 92, y - 1);
        _btnRegister.Size = new Size(92, 26);
        _btnCancelReg.Location = _btnRegister.Location;
        _btnCancelReg.Size = _btnRegister.Size;
        Controls.AddRange([_txtName, _btnRegister, _btnCancelReg]);
        y += RowHeight;

        _lblPairing.Location = new Point(FieldColumn, y);
        _lblPairing.Size = new Size(130, 48);
        _lblPairing.Font = new Font("Consolas", 20, FontStyle.Bold);
        _lblRegState.Location = new Point(FieldColumn + 136, y);
        _lblRegState.Size = new Size(fieldWidth - 136, 48);
        _lblRegState.Text = RegHintText;
        Controls.AddRange([_lblPairing, _lblRegState]);
        y += 54;

        // «Avanzate» closed by default: the token row is hidden and the controls below sit right under the link;
        // opening it shows the row and moves them down by RowHeight (SetAdvanced).
        _lnkAdvanced.Location = new Point(Margin_, y + 3);
        _lnkAdvanced.Size = new Size(FieldColumn - Margin_, 20);
        Controls.Add(_lnkAdvanced);
        y += 26;

        _lblToken.Location = new Point(Margin_, y + 3);
        _lblToken.Size = new Size(FieldColumn - Margin_, 20);
        _txtToken.Location = new Point(FieldColumn, y);
        _txtToken.Size = new Size(fieldWidth - 160, 23);
        _lblTokenInfo.Location = new Point(FormWidth - Margin_ - 152, y + 3);
        _lblTokenInfo.Size = new Size(152, 20);
        Controls.AddRange([_lblToken, _txtToken, _lblTokenInfo]);
        y += 6;

        var bold = new Font("Segoe UI", 10, FontStyle.Bold);
        _btnStart.Location = new Point(FieldColumn, y);
        _btnStart.Size = new Size(140, 34);
        _btnStart.Font = bold;
        _btnStop.Location = new Point(FieldColumn + 160, y);
        _btnStop.Size = new Size(140, 34);
        _btnStop.Font = bold;
        Controls.AddRange([_btnStart, _btnStop]);
        y += 46;

        _lblState.Location = new Point(Margin_, y + 3);
        _lblState.Size = new Size(FormWidth - (2 * Margin_), 20);
        _lblState.Font = bold;
        y += 24;
        _lblDetails.Location = new Point(Margin_, y + 3);
        _lblDetails.Size = new Size(FormWidth - (2 * Margin_), 20);
        y += 24;
        _lblError.Location = new Point(Margin_, y + 3);
        _lblError.Size = new Size(FormWidth - (2 * Margin_), 36);
        Controls.AddRange([_lblState, _lblDetails, _lblError]);
        y += 40;

        var grpLog = new GroupBox { Text = "Ultimi messaggi", Location = new Point(Margin_, y), Size = new Size(FormWidth - (2 * Margin_), 190) };
        _lstLog.Font = new Font("Consolas", 9);
        grpLog.Controls.Add(_lstLog);
        Controls.Add(grpLog);
        y += 190 + Margin_;
        _belowAdvanced = [_btnStart, _btnStop, _lblState, _lblDetails, _lblError, grpLog];

        ClientSize = new Size(FormWidth, y);

        _menuBrowse.Items.Add("Scegli una cartella (il .dvw più recente)…", null, (_, _) => ChooseFolder());
        _menuBrowse.Items.Add("Scegli un file .dvw…", null, (_, _) => ChooseFile());
    }

    /// <summary>Opens or closes «Avanzate»: shows the token row and moves the controls below (and the window) by one row.</summary>
    private void SetAdvanced(bool open)
    {
        if (open == _advancedOpen) return;
        _advancedOpen = open;
        SuspendLayout();
        var delta = open ? RowHeight : -RowHeight;
        foreach (var control in _belowAdvanced) control.Top += delta;
        _lblToken.Visible = open;
        _txtToken.Visible = open;
        _lblTokenInfo.Visible = open;
        _lnkAdvanced.Text = open ? AdvancedOpenText : AdvancedClosedText;
        ClientSize = new Size(FormWidth, ClientSize.Height + delta);
        ResumeLayout();
        if (open) _txtToken.Focus();
    }

    private void WireEvents()
    {
        _lnkAdvanced.LinkClicked += (_, _) => SetAdvanced(!_advancedOpen);
        _btnBrowse.Click += (_, _) => _menuBrowse.Show(_btnBrowse, new Point(0, _btnBrowse.Height));
        _txtToken.TextChanged += (_, _) => UpdateControls();
        _txtName.TextChanged += (_, _) => UpdateControls();
        _btnRegister.Click += (_, _) => OnRegister();
        _btnCancelReg.Click += (_, _) =>
        {
            _btnCancelReg.Enabled = false;
            Task.Run(() => _controller?.CancelRegistration());
        };
        _btnStart.Click += (_, _) => OnStart();
        _btnStop.Click += (_, _) =>
        {
            _btnStop.Enabled = false;
            var controller = _controller;
            if (controller is not null) Task.Run(controller.StopAsync);
        };
        FormClosing += OnClosing;
    }

    private static string WithoutControlChars(string text) =>
        new([.. text.Select(c => c <= '\u001F' || c == '\u007F' ? ' ' : c)]);

    private void OnRegister()
    {
        // As the server: one line, no control characters (a pasted tab becomes a space).
        var name = WithoutControlChars(_txtName.Text).Trim();
        if (name.Length == 0)
        {
            ShowErrorNow("Scrivi il nome dell'agente (es. il nome del PC o del campo)");
            return;
        }
        ShowErrorNow("");
        _regBusy = true;
        _lblPairing.Text = "";
        _lblRegState.Text = "Richiesta al server…";
        _lblRegState.ForeColor = Color.DimGray;
        UpdateControls();
        Task.Run(() => _controller?.Register(name));
    }

    private void OnStart()
    {
        var folder = _txtFolder.Text.Trim();
        if (folder.Length == 0)
        {
            ShowErrorNow("Scegli la cartella (o il file) del .dvw con «Sfoglia…»");
            return;
        }
        ShowErrorNow("");
        var token = _txtToken.Text.Trim();
        _phase = GuiPhase.Starting;
        UpdateControls();
        _controller?.Start(folder, token.Length > 0 ? token : null);
    }

    private void OnClosing(object? sender, FormClosingEventArgs e)
    {
        if (_closingConfirmed || _controller is null) return;
        if (_phase is GuiPhase.Starting or GuiPhase.Running or GuiPhase.Stopping)
        {
            var answer = MessageBox.Show(this, "La lettura del .dvw è in corso: fermarla e chiudere?", _title, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (answer != DialogResult.Yes)
            {
                e.Cancel = true;
                return;
            }
        }
        // Stop the agent (the queue stays on disk), then close for real.
        e.Cancel = true;
        _closingConfirmed = true;
        Enabled = false;
        var controller = _controller;
        Task.Run(async () =>
        {
            await controller.ShutdownAsync().ConfigureAwait(false);
            BeginInvoke(Close);
        });
    }

    private static string? FirstRemovableDrive()
    {
        try
        {
            return DriveInfo.GetDrives().FirstOrDefault(d => d.DriveType == DriveType.Removable && d.IsReady)?.RootDirectory.FullName;
        }
        catch (IOException)
        {
            return null;
        }
    }

    private string? StartFolder()
    {
        var current = _txtFolder.Text.Trim();
        if (current.Length > 0)
        {
            if (Directory.Exists(current)) return current;
            var parent = Path.GetDirectoryName(current);
            if (!string.IsNullOrEmpty(parent) && Directory.Exists(parent)) return parent;
        }
        return FirstRemovableDrive();
    }

    private void ChooseFolder()
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "Cartella in cui DataVolley salva il file .dvw (di solito la pennina)",
            ShowNewFolderButton = false,
            UseDescriptionForTitle = true,
        };
        if (StartFolder() is { } start) dialog.SelectedPath = start;
        if (dialog.ShowDialog(this) == DialogResult.OK) _txtFolder.Text = dialog.SelectedPath;
    }

    private void ChooseFile()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "File .dvw di DataVolley",
            Filter = "File DataVolley (*.dvw)|*.dvw|Tutti i file (*.*)|*.*",
            CheckFileExists = true,
        };
        if (StartFolder() is { } start) dialog.InitialDirectory = start;
        if (dialog.ShowDialog(this) == DialogResult.OK) _txtFolder.Text = dialog.FileName;
    }

    private void UpdateControls()
    {
        var idle = _phase == GuiPhase.Idle;
        _txtFolder.Enabled = idle;
        _btnBrowse.Enabled = idle;
        _txtToken.Enabled = idle;
        var waiting = _regState == "pending";
        _txtName.Enabled = idle && !waiting && !_regBusy;
        _btnRegister.Visible = !waiting;
        _btnRegister.Enabled = idle && !_regBusy && _txtName.Text.Trim().Length > 0;
        _btnCancelReg.Visible = waiting;
        _btnStart.Enabled = idle && (_tokenPresent || _txtToken.Text.Trim().Length > 0);
        _btnStop.Enabled = _phase is GuiPhase.Starting or GuiPhase.Running;
    }

    private void ShowErrorNow(string text) => _lblError.Text = text;

    private void OnUi(Action action)
    {
        if (IsDisposed || Disposing) return;
        if (!IsHandleCreated)
        {
            HandleCreated += (_, _) => BeginInvoke(action);
            return;
        }
        try
        {
            BeginInvoke(action);
        }
        catch (InvalidOperationException)
        {
            // closing
        }
    }

    private static string LocalTime(string? iso, string format)
    {
        if (string.IsNullOrEmpty(iso)) return "–";
        return DateTimeOffset.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t)
            ? t.ToLocalTime().ToString(format, CultureInfo.InvariantCulture)
            : iso;
    }

    public void ShowInit(InitView view) => OnUi(() =>
    {
        _txtFolder.Text = view.WatchPath;
        _txtServer.Text = view.ServerUrl;
        _tokenPresent = view.TokenPresent;
        _lblTokenInfo.Text = view.TokenPresent ? $"salvato (…{view.TokenLast4})" : "mancante: incollalo";
        _txtToken.Text = "";
        if (view.ConfigError is not null) ShowErrorNow(view.ConfigError);
        if (view.Branding is not null) ApplyBranding(view.Branding);
        else ApplyProductHeader();
        UpdateControls();
    });

    public void ShowState(GuiPhase phase, AgentStatus? status) => OnUi(() =>
    {
        _phase = phase;
        var color = Color.DimGray;
        string text;
        switch (phase)
        {
            case GuiPhase.Idle:
                text = "● Fermo: premi START per leggere il .dvw";
                break;
            case GuiPhase.Starting:
                text = "● Avvio…";
                color = Color.DarkGoldenrod;
                break;
            case GuiPhase.Stopping:
                text = "● Arresto…";
                color = Color.DarkGoldenrod;
                break;
            default:
                color = Color.ForestGreen;
                text = status?.File is { } file ? $"● In lettura: {Path.GetFileName(file)}" : "● In attesa del file .dvw";
                if (status is { ServerReachable: false })
                {
                    text += " · server non raggiungibile";
                    color = Color.DarkOrange;
                }
                if (status is { RegistrationExpired: true })
                {
                    text = "● Registrazione scaduta: registrati di nuovo (STOP, poi «Registra»)";
                    color = Color.Firebrick;
                }
                break;
        }
        _lblState.Text = text;
        _lblState.ForeColor = color;
        _lblDetails.Text = status is null ? "" : $"righe {status.Lines} · coda {status.Queue} · ultimo invio {LocalTime(status.LastSuccessAt, "HH:mm:ss")}";
        UpdateControls();
    });

    public void ShowLog(LogEntry entry) => OnUi(() =>
    {
        var prefix = entry.Level switch
        {
            "warn" => "attenzione: ",
            "error" or "fatal" => "errore: ",
            _ => "",
        };
        _lstLog.Items.Add($"{LocalTime(entry.Time, "HH:mm:ss")} {prefix}{entry.Message}");
        while (_lstLog.Items.Count > MaxMessages) _lstLog.Items.RemoveAt(0);
        _lstLog.TopIndex = Math.Max(0, _lstLog.Items.Count - 1);
    });

    public void ShowError(string message) => OnUi(() =>
    {
        _regBusy = false;
        ShowErrorNow(message);
        UpdateControls();
    });

    public void ShowRegistration(RegistrationView view) => OnUi(() =>
    {
        _regState = view.State;
        _regBusy = false;
        _btnCancelReg.Enabled = true;
        if (!string.IsNullOrEmpty(view.Name)) _txtName.Text = view.Name;
        var code = "";
        var color = Color.DimGray;
        string text;
        switch (view.State)
        {
            case "none":
                text = RegHintText;
                break;
            case "pending":
                code = view.PairingCode ?? "";
                text = $"In attesa di abilitazione nel portale: Agenti → Richieste in attesa (scade {LocalTime(view.ExpiresAt, "dd/MM HH:mm")})";
                color = Color.DarkGoldenrod;
                if (view.Message is not null)
                {
                    text += "\n" + view.Message;
                    color = Color.DarkOrange;
                }
                break;
            case "approved":
                color = Color.ForestGreen;
                text = view.Message is not null ? $"Abilitato. {view.Message}" : "Abilitato: token salvato. Premi START";
                break;
            case "rejected":
                text = "Rifiutata nel portale: registra di nuovo o incolla un token in «Avanzate»";
                color = Color.Firebrick;
                SetAdvanced(true);
                break;
            case "expired":
                text = "Scaduta senza abilitazione: registra di nuovo";
                color = Color.Firebrick;
                break;
            case "consumed":
                text = "Token già consegnato in precedenza: registra di nuovo";
                color = Color.Firebrick;
                break;
            default:
                text = $"Errore: {view.Message}";
                color = Color.Firebrick;
                break;
        }
        _lblPairing.Text = code;
        _lblRegState.Text = text;
        _lblRegState.ForeColor = color;
        UpdateControls();
    });

    /// <summary>Logo read from a stream closed at once (the file is never locked) and copied into a bitmap.</summary>
    private static Bitmap? ReadLogo(string? path)
    {
        if (string.IsNullOrEmpty(path)) return null;
        try
        {
            var info = new FileInfo(path);
            if (!info.Exists || info.Length > Contract.AgentLogoMaxBytes) return null;
            using var stream = new MemoryStream(File.ReadAllBytes(path));
            using var image = Image.FromStream(stream, useEmbeddedColorManagement: false, validateImageData: true);
            if (image.Width > Contract.AgentLogoMaxSide || image.Height > Contract.AgentLogoMaxSide) return null;
            return new Bitmap(image);
        }
        catch (Exception e) when (e is IOException or ArgumentException or UnauthorizedAccessException or OutOfMemoryException)
        {
            return null;
        }
    }

    /// <summary>Logo of ArenaLive embedded in the executable (resource name of Branding), null if missing.</summary>
    private static Bitmap? ReadProductLogo(string resource)
    {
        try
        {
            using var stream = typeof(MainForm).Assembly.GetManifestResourceStream(resource);
            if (stream is null) return null;
            using var image = Image.FromStream(stream, useEmbeddedColorManagement: false, validateImageData: true);
            return new Bitmap(image);
        }
        catch (Exception e) when (e is ArgumentException or OutOfMemoryException)
        {
            return null;
        }
    }

    /// <summary>
    /// Header without the graphics of a client: the logo of ArenaLive at the top left, on the background of the window,
    /// in the variant meant for it (positive on a light system background, negative on a dark one); once.
    /// </summary>
    private void ApplyProductHeader()
    {
        if (_brandingApplied) return;
        var background = BackColor;
        var logo = ReadProductLogo(Branding.ProductLogoFor(background.R, background.G, background.B));
        if (logo is null) return;
        _brandingApplied = true;
        AddHeader(background, logo, null, ForeColor);
    }

    /// <summary>Header with the primary colour, logo and name, title and START coloured (once).</summary>
    private void ApplyBranding(WindowBranding branding)
    {
        if (_brandingApplied) return;
        _brandingApplied = true;
        var primary = ColorTranslator.FromHtml(branding.Primary);
        var onPrimary = ColorTranslator.FromHtml(branding.OnPrimary);
        var name = WithoutControlChars(branding.Name).Trim();
        if (name.Length > 100) name = name[..100];
        if (name.Length > 0)
        {
            _title = $"{name} – Agente ArenaLive {AppVersion.Current}";
            Text = _title;
        }
        AddHeader(primary, ReadLogo(branding.LogoPath), name.Length > 0 ? name : "Agente ArenaLive", onPrimary);
        _btnStart.FlatStyle = FlatStyle.Flat;
        _btnStart.FlatAppearance.BorderColor = primary;
        _btnStart.BackColor = primary;
        _btnStart.ForeColor = onPrimary;
    }

    /// <summary>Header band at the top (the other controls move down): logo at the left, then the text if any.</summary>
    private void AddHeader(Color back, Image? logo, string? text, Color fore)
    {
        SuspendLayout();
        foreach (Control control in Controls) control.Top += HeaderHeight;
        var header = new Panel { Location = new Point(0, 0), Size = new Size(FormWidth, HeaderHeight), BackColor = back };
        var x = Margin_;
        if (logo is not null)
        {
            header.Controls.Add(new PictureBox
            {
                SizeMode = PictureBoxSizeMode.Zoom,
                Location = new Point(Margin_, 8),
                Size = new Size(LogoWidth, HeaderHeight - 16),
                Image = logo,
            });
            x = Margin_ + LogoWidth + Margin_;
        }
        if (text is not null)
            header.Controls.Add(new Label
            {
                Text = text,
                ForeColor = fore,
                BackColor = back,
                Font = new Font("Segoe UI", 13, FontStyle.Bold),
                TextAlign = ContentAlignment.MiddleLeft,
                AutoEllipsis = true,
                Location = new Point(x, 0),
                Size = new Size(FormWidth - x - Margin_, HeaderHeight),
            });
        Controls.Add(header);
        ClientSize = new Size(FormWidth, ClientSize.Height + HeaderHeight);
        ResumeLayout();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _menuBrowse.Dispose();
        base.Dispose(disposing);
    }
}
