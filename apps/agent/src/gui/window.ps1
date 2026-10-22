# Finestra di arenalive-agent.exe (WinForms). La avvia l'agente con:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File <dataDir>\gui\window.ps1
# L'agente riscrive questo file a ogni avvio (dal testo incluso nell'eseguibile): le modifiche fatte qui si perdono.
#
# Protocollo: una riga JSON per messaggio.
#   da stdin  (agente -> finestra): init (con branding: colori del cliente già validati e logo), state, log, error,
#             registration
#   su stdout (finestra -> agente): start {watchPath, token?}, stop, quit, register {name}, cancelRegistration
# Su stdout non deve finire nient'altro: ogni valore non usato va scartato con [void].

# --- testi e dimensioni ---
$Titolo        = 'ArenaLive – Agente'
$MaxMessaggi   = 200          # righe tenute nella lista degli ultimi messaggi
$IntervalloMs  = 100          # ogni quanto la finestra legge i messaggi arrivati dall'agente
$Margine       = 12
$ColonnaCampi  = 170
$LarghezzaForm = 640
$AltezzaRiga   = 32
$FineInput     = '::fine-input::'
$AltezzaTestata = 64          # testata: colorata con branding.json del cliente accanto all'exe, altrimenti logo di ArenaLive
$LarghezzaLogo = 140          # spazio del logo nella testata (l'immagine è ridotta per starci)
$LogoMaxByte   = 2MB          # logo più grande: ignorato (lo controlla anche l'agente)
$LogoMaxLato   = 1024         # pixel per lato del logo, oltre: ignorato
$TestoAvanzateChiuso = 'Avanzate ▸'   # il token agente (alternativa alla registrazione) sta sotto «Avanzate», chiuso all'avvio
$TestoAvanzateAperto = 'Avanzate ▾'
$TestoRegistra = 'Scrivi il nome e premi «Registra», oppure usa un token in «Avanzate»'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# --- console nera nascosta ---
# È la console di arenalive-agent.exe, condivisa con questo processo. Si nasconde solo se l'hanno aperta per noi (doppio
# clic: nella console ci sono solo arenalive-agent.exe e powershell.exe), non se l'agente è stato lanciato da un prompt.
Add-Type -Namespace ArenaLiveAgent -Name NativeConsole -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] processList, uint processCount);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@
$consoleWindow = [ArenaLiveAgent.NativeConsole]::GetConsoleWindow()
$consoleProcesses = New-Object 'uint32[]' 16
$consoleCount = [ArenaLiveAgent.NativeConsole]::GetConsoleProcessList($consoleProcesses, 16)
if ($consoleWindow -ne [IntPtr]::Zero -and $consoleCount -le 2) {
    [void][ArenaLiveAgent.NativeConsole]::ShowWindow($consoleWindow, 0)
}

# --- canali con l'agente (UTF-8 senza BOM) ---
$utf8 = New-Object System.Text.UTF8Encoding($false)
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"

# stdin si legge in un runspace a parte (ReadLine blocca); il Timer della finestra svuota la coda.
$inbox = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$reader = [PowerShell]::Create()
[void]$reader.AddScript({
    param($source, $queue, $endMarker)
    try {
        while ($true) {
            $line = $source.ReadLine()
            if ($null -eq $line) { break }
            $queue.Enqueue($line)
        }
    } catch { }
    $queue.Enqueue($endMarker)
})
[void]$reader.AddArgument($stdin)
[void]$reader.AddArgument($inbox)
[void]$reader.AddArgument($FineInput)
[void]$reader.BeginInvoke()

function Send-AgentMessage($message) {
    try {
        $stdout.WriteLine(($message | ConvertTo-Json -Compress))
    } catch {
        $script:agentGone = $true
    }
}

# --- stato ---
$script:phase = 'waiting'      # prima di init: tutto disattivato
$script:tokenPresent = $false
$script:agentGone = $false
$script:quitSent = $false
$script:regState = 'none'      # stato della registrazione: none, pending, approved, rejected, expired, consumed, error
$script:regBusy = $false       # «Registra» premuto, risposta dell'agente non ancora arrivata
$script:brandingApplied = $false

# --- finestra ---
$form = New-Object System.Windows.Forms.Form
$form.Text = $Titolo
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Font = New-Object System.Drawing.Font('Segoe UI', 9)

$y = $Margine
$larghezzaCampo = $LarghezzaForm - $ColonnaCampi - $Margine

function New-Label($text, $x, $top, $width) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object System.Drawing.Point($x, ($top + 3))
    $label.Size = New-Object System.Drawing.Size($width, 20)
    $form.Controls.Add($label)
    return $label
}

# Riga: cartella del .dvw
[void](New-Label 'Cartella del .dvw' $Margine $y ($ColonnaCampi - $Margine))
$txtFolder = New-Object System.Windows.Forms.TextBox
$txtFolder.Location = New-Object System.Drawing.Point($ColonnaCampi, $y)
$txtFolder.Size = New-Object System.Drawing.Size(($larghezzaCampo - 100), 23)
$form.Controls.Add($txtFolder)
$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = 'Sfoglia…'
$btnBrowse.Location = New-Object System.Drawing.Point(($LarghezzaForm - $Margine - 92), ($y - 1))
$btnBrowse.Size = New-Object System.Drawing.Size(92, 26)
$form.Controls.Add($btnBrowse)
$y += $AltezzaRiga

# Riga: server (sola lettura)
[void](New-Label 'Server' $Margine $y ($ColonnaCampi - $Margine))
$txtServer = New-Object System.Windows.Forms.TextBox
$txtServer.Location = New-Object System.Drawing.Point($ColonnaCampi, $y)
$txtServer.Size = New-Object System.Drawing.Size($larghezzaCampo, 23)
$txtServer.ReadOnly = $true
$form.Controls.Add($txtServer)
$y += $AltezzaRiga

# Riga: nome agente con «Registra» (durante l'attesa al suo posto c'è «Annulla»)
[void](New-Label 'Nome agente' $Margine $y ($ColonnaCampi - $Margine))
$txtName = New-Object System.Windows.Forms.TextBox
$txtName.Location = New-Object System.Drawing.Point($ColonnaCampi, $y)
$txtName.Size = New-Object System.Drawing.Size(($larghezzaCampo - 100), 23)
$txtName.MaxLength = 100
$txtName.Text = [string]$env:COMPUTERNAME
$form.Controls.Add($txtName)
$btnRegister = New-Object System.Windows.Forms.Button
$btnRegister.Text = 'Registra'
$btnRegister.Location = New-Object System.Drawing.Point(($LarghezzaForm - $Margine - 92), ($y - 1))
$btnRegister.Size = New-Object System.Drawing.Size(92, 26)
$form.Controls.Add($btnRegister)
$btnCancelReg = New-Object System.Windows.Forms.Button
$btnCancelReg.Text = 'Annulla'
$btnCancelReg.Location = $btnRegister.Location
$btnCancelReg.Size = $btnRegister.Size
$btnCancelReg.Visible = $false
$form.Controls.Add($btnCancelReg)
$y += $AltezzaRiga

# Riga: codice di abbinamento (grande, monospace) e stato della registrazione
$lblPairing = New-Object System.Windows.Forms.Label
$lblPairing.Location = New-Object System.Drawing.Point($ColonnaCampi, $y)
$lblPairing.Size = New-Object System.Drawing.Size(130, 48)
$lblPairing.Font = New-Object System.Drawing.Font('Consolas', 20, [System.Drawing.FontStyle]::Bold)
$lblPairing.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$form.Controls.Add($lblPairing)
$lblRegState = New-Object System.Windows.Forms.Label
$lblRegState.Location = New-Object System.Drawing.Point(($ColonnaCampi + 136), $y)
$lblRegState.Size = New-Object System.Drawing.Size(($larghezzaCampo - 136), 48)
$lblRegState.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
$lblRegState.Text = $TestoRegistra
$lblRegState.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($lblRegState)
$y += 54

# Riga: «Avanzate», chiuso all'avvio: la riga del token è nascosta e i controlli sotto stanno subito sotto il link;
# aperto, mostra la riga e sposta in giù i controlli sotto (e la finestra) di una riga (Set-Advanced).
$script:advancedOpen = $false
$lnkAdvanced = New-Object System.Windows.Forms.LinkLabel
$lnkAdvanced.Text = $TestoAvanzateChiuso
$lnkAdvanced.Location = New-Object System.Drawing.Point($Margine, ($y + 3))
$lnkAdvanced.Size = New-Object System.Drawing.Size(($ColonnaCampi - $Margine), 20)
$form.Controls.Add($lnkAdvanced)
$y += 26

# Riga (in «Avanzate»): token agente (mascherato; vuoto = resta quello salvato in config.json)
$lblToken = New-Label 'Token agente (alternativa)' $Margine $y ($ColonnaCampi - $Margine)
$lblToken.Visible = $false
$txtToken = New-Object System.Windows.Forms.TextBox
$txtToken.Location = New-Object System.Drawing.Point($ColonnaCampi, $y)
$txtToken.Size = New-Object System.Drawing.Size(($larghezzaCampo - 160), 23)
$txtToken.UseSystemPasswordChar = $true
$txtToken.Visible = $false
$form.Controls.Add($txtToken)
$lblTokenInfo = New-Label 'mancante' ($LarghezzaForm - $Margine - 152) $y 152
$lblTokenInfo.Visible = $false
$y += 6

# Riga: START / STOP
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = 'START'
$btnStart.Location = New-Object System.Drawing.Point($ColonnaCampi, $y)
$btnStart.Size = New-Object System.Drawing.Size(140, 34)
$btnStart.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnStart)
$btnStop = New-Object System.Windows.Forms.Button
$btnStop.Text = 'STOP'
$btnStop.Location = New-Object System.Drawing.Point(($ColonnaCampi + 160), $y)
$btnStop.Size = New-Object System.Drawing.Size(140, 34)
$btnStop.Font = $btnStart.Font
$form.Controls.Add($btnStop)
$y += 46

# Righe: stato, dettagli, errore
$lblState = New-Label 'In attesa dell''agente…' $Margine $y ($LarghezzaForm - 2 * $Margine)
$lblState.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$y += 24
$lblDetails = New-Label '' $Margine $y ($LarghezzaForm - 2 * $Margine)
$y += 24
$lblError = New-Label '' $Margine $y ($LarghezzaForm - 2 * $Margine)
$lblError.ForeColor = [System.Drawing.Color]::Firebrick
$lblError.Size = New-Object System.Drawing.Size(($LarghezzaForm - 2 * $Margine), 36)
$y += 40

# Riquadro: ultimi messaggi
$grpLog = New-Object System.Windows.Forms.GroupBox
$grpLog.Text = 'Ultimi messaggi'
$grpLog.Location = New-Object System.Drawing.Point($Margine, $y)
$grpLog.Size = New-Object System.Drawing.Size(($LarghezzaForm - 2 * $Margine), 190)
$lstLog = New-Object System.Windows.Forms.ListBox
$lstLog.Dock = [System.Windows.Forms.DockStyle]::Fill
$lstLog.HorizontalScrollbar = $true
$lstLog.Font = New-Object System.Drawing.Font('Consolas', 9)
$grpLog.Controls.Add($lstLog)
$form.Controls.Add($grpLog)
$y += 190 + $Margine
$sottoAvanzate = @($btnStart, $btnStop, $lblState, $lblDetails, $lblError, $grpLog)

$form.ClientSize = New-Object System.Drawing.Size($LarghezzaForm, $y)

# --- funzioni della finestra ---
function Format-LocalTime($value) {
    if ($null -eq $value -or [string]$value -eq '') { return '–' }
    try {
        if ($value -is [datetime]) {
            $date = $value
        } else {
            $date = [datetime]::Parse([string]$value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        }
        return $date.ToLocalTime().ToString('HH:mm:ss')
    } catch {
        return [string]$value
    }
}

function Show-Error($text) {
    $lblError.Text = [string]$text
}

function Add-Log($time, $level, $text) {
    $prefix = ''
    if ($level -eq 'warn') { $prefix = 'attenzione: ' }
    if ($level -eq 'error' -or $level -eq 'fatal') { $prefix = 'errore: ' }
    [void]$lstLog.Items.Add((Format-LocalTime $time) + ' ' + $prefix + [string]$text)
    while ($lstLog.Items.Count -gt $MaxMessaggi) { $lstLog.Items.RemoveAt(0) }
    $lstLog.TopIndex = [Math]::Max(0, $lstLog.Items.Count - 1)
}

# Apre o chiude «Avanzate»: mostra la riga del token e sposta i controlli sotto (e la finestra) di una riga.
function Set-Advanced($open) {
    if ([bool]$open -eq $script:advancedOpen) { return }
    $script:advancedOpen = [bool]$open
    $form.SuspendLayout()
    if ($script:advancedOpen) { $delta = $AltezzaRiga } else { $delta = -$AltezzaRiga }
    foreach ($control in $sottoAvanzate) { $control.Top += $delta }
    $lblToken.Visible = $script:advancedOpen
    $txtToken.Visible = $script:advancedOpen
    $lblTokenInfo.Visible = $script:advancedOpen
    if ($script:advancedOpen) { $lnkAdvanced.Text = $TestoAvanzateAperto } else { $lnkAdvanced.Text = $TestoAvanzateChiuso }
    $form.ClientSize = New-Object System.Drawing.Size($LarghezzaForm, ($form.ClientSize.Height + $delta))
    $form.ResumeLayout()
    if ($script:advancedOpen) { [void]$txtToken.Focus() }
}

function Update-Controls {
    $idle = ($script:phase -eq 'idle')
    $txtFolder.Enabled = $idle
    $btnBrowse.Enabled = $idle
    $txtToken.Enabled = $idle
    $waiting = ($script:regState -eq 'pending')
    $txtName.Enabled = $idle -and -not $waiting -and -not $script:regBusy
    $btnRegister.Visible = -not $waiting
    $btnRegister.Enabled = $idle -and -not $script:regBusy -and $txtName.Text.Trim() -ne ''
    $btnCancelReg.Visible = $waiting
    $btnStart.Enabled = $idle -and ($script:tokenPresent -or $txtToken.Text.Trim() -ne '')
    $btnStop.Enabled = ($script:phase -eq 'starting' -or $script:phase -eq 'running')
}

function Format-LocalDateTime($value) {
    if ($null -eq $value -or [string]$value -eq '') { return '–' }
    try {
        if ($value -is [datetime]) {
            $date = $value
        } else {
            $date = [datetime]::Parse([string]$value, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind)
        }
        return $date.ToLocalTime().ToString('dd/MM HH:mm')
    } catch {
        return [string]$value
    }
}

function Show-Registration($message) {
    $script:regState = [string]$message.state
    $script:regBusy = $false
    $btnCancelReg.Enabled = $true
    if ($message.name) { $txtName.Text = [string]$message.name }
    $code = ''
    $color = [System.Drawing.Color]::DimGray
    switch ($script:regState) {
        'none' { $text = $TestoRegistra }
        'pending' {
            $code = [string]$message.pairingCode
            $text = 'In attesa di abilitazione nel portale: Agenti → Richieste in attesa (scade ' + (Format-LocalDateTime $message.expiresAt) + ')'
            $color = [System.Drawing.Color]::DarkGoldenrod
            if ($message.message) {
                $text = $text + "`n" + [string]$message.message
                $color = [System.Drawing.Color]::DarkOrange
            }
        }
        'approved' {
            $color = [System.Drawing.Color]::ForestGreen
            if ($message.message) {
                $text = 'Abilitato. ' + [string]$message.message
            } else {
                $text = 'Abilitato: token salvato. Premi START'
            }
        }
        'rejected' {
            $text = 'Rifiutata nel portale: registra di nuovo o incolla un token in «Avanzate»'
            $color = [System.Drawing.Color]::Firebrick
            Set-Advanced $true
        }
        'expired' { $text = 'Scaduta senza abilitazione: registra di nuovo'; $color = [System.Drawing.Color]::Firebrick }
        'consumed' { $text = 'Token già consegnato in precedenza: registra di nuovo'; $color = [System.Drawing.Color]::Firebrick }
        default {
            $text = 'Errore: ' + [string]$message.message
            $color = [System.Drawing.Color]::Firebrick
        }
    }
    $lblPairing.Text = $code
    $lblRegState.Text = $text
    $lblRegState.ForeColor = $color
    Update-Controls
}

function Show-State($phase, $status) {
    $script:phase = [string]$phase
    $color = [System.Drawing.Color]::DimGray
    switch ($script:phase) {
        'idle' { $text = '● Fermo: premi START per leggere il .dvw' }
        'starting' { $text = '● Avvio…'; $color = [System.Drawing.Color]::DarkGoldenrod }
        'stopping' { $text = '● Arresto…'; $color = [System.Drawing.Color]::DarkGoldenrod }
        'running' {
            $color = [System.Drawing.Color]::ForestGreen
            if ($status -and $status.file) {
                $text = '● In lettura: ' + [System.IO.Path]::GetFileName([string]$status.file)
            } else {
                $text = '● In attesa del file .dvw'
            }
            if ($status -and -not $status.serverReachable) {
                $text = $text + ' · server non raggiungibile'
                $color = [System.Drawing.Color]::DarkOrange
            }
            if ($status -and $status.registrationExpired) {
                $text = '● Registrazione scaduta: registrati di nuovo (STOP, poi «Registra»)'
                $color = [System.Drawing.Color]::Firebrick
            }
        }
        default { $text = '● ' + $script:phase }
    }
    $lblState.Text = $text
    $lblState.ForeColor = $color
    if ($status) {
        $lblDetails.Text = 'righe ' + $status.lines + ' · coda ' + $status.queue + ' · ultimo invio ' + (Format-LocalTime $status.lastSuccessAt)
    } else {
        $lblDetails.Text = ''
    }
    Update-Controls
}

function Test-HexColor($value) {
    return ([string]$value) -cmatch '^#[0-9a-f]{6}$'
}

# Logo del cliente: letto da un FileStream chiuso subito (il file non resta bloccato), copiato in una Bitmap.
function Read-Logo($path) {
    if ($null -eq $path -or [string]$path -eq '') { return $null }
    $stream = $null
    $image = $null
    try {
        $file = New-Object System.IO.FileInfo([string]$path)
        if (-not $file.Exists -or $file.Length -gt $LogoMaxByte) { return $null }
        $stream = New-Object System.IO.FileStream([string]$path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
        $image = [System.Drawing.Image]::FromStream($stream, $false, $true)
        if ($image.Width -gt $LogoMaxLato -or $image.Height -gt $LogoMaxLato) { return $null }
        return (New-Object System.Drawing.Bitmap($image))
    } catch {
        return $null
    } finally {
        if ($null -ne $image) { $image.Dispose() }
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

# Grafica del cliente (una volta sola): testata col colore primario, logo e nome, titolo e START colorati.
# Colori non validi: resta la grafica predefinita.
function Set-Branding($branding) {
    if ($script:brandingApplied -or $null -eq $branding) { return }
    if (-not (Test-HexColor $branding.primary) -or -not (Test-HexColor $branding.onPrimary)) { return }
    $script:brandingApplied = $true
    $primary = [System.Drawing.ColorTranslator]::FromHtml([string]$branding.primary)
    $onPrimary = [System.Drawing.ColorTranslator]::FromHtml([string]$branding.onPrimary)
    $name = ([string]$branding.name -replace '[\x00-\x1F\x7F]', ' ').Trim()
    if ($name.Length -gt 100) { $name = $name.Substring(0, 100) }
    if ($name -ne '') {
        $script:Titolo = $name + ' – Agente ArenaLive'
        $form.Text = $script:Titolo
    }
    $form.SuspendLayout()
    foreach ($control in @($form.Controls)) { $control.Top += $AltezzaTestata }
    $header = New-Object System.Windows.Forms.Panel
    $header.Location = New-Object System.Drawing.Point(0, 0)
    $header.Size = New-Object System.Drawing.Size($LarghezzaForm, $AltezzaTestata)
    $header.BackColor = $primary
    $x = $Margine
    $logo = Read-Logo $branding.logoPath
    if ($null -ne $logo) {
        $picture = New-Object System.Windows.Forms.PictureBox
        $picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
        $picture.Location = New-Object System.Drawing.Point($Margine, 8)
        $picture.Size = New-Object System.Drawing.Size($LarghezzaLogo, ($AltezzaTestata - 16))
        $picture.Image = $logo
        $header.Controls.Add($picture)
        $x = $Margine + $LarghezzaLogo + $Margine
    }
    $lblHeader = New-Object System.Windows.Forms.Label
    if ($name -ne '') { $lblHeader.Text = $name } else { $lblHeader.Text = 'Agente ArenaLive' }
    $lblHeader.ForeColor = $onPrimary
    $lblHeader.BackColor = $primary
    $lblHeader.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
    $lblHeader.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $lblHeader.AutoEllipsis = $true
    $lblHeader.Location = New-Object System.Drawing.Point($x, 0)
    $lblHeader.Size = New-Object System.Drawing.Size(($LarghezzaForm - $x - $Margine), $AltezzaTestata)
    $header.Controls.Add($lblHeader)
    $form.Controls.Add($header)
    $form.ClientSize = New-Object System.Drawing.Size($LarghezzaForm, ($form.ClientSize.Height + $AltezzaTestata))
    $btnStart.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $btnStart.FlatAppearance.BorderColor = $primary
    $btnStart.BackColor = $primary
    $btnStart.ForeColor = $onPrimary
    $form.ResumeLayout()
}

# Icona della finestra (arenalive-agent.ico scritto dall'agente accanto a questo script); senza file resta quella di sistema.
function Set-WindowIcon($path) {
    if ($null -eq $path -or [string]$path -eq '' -or -not (Test-Path -LiteralPath ([string]$path))) { return }
    try { $form.Icon = New-Object System.Drawing.Icon([string]$path) } catch { }
}

# Luminanza relativa WCAG di un colore (0 nero, 1 bianco), come relativeLuminance di @arenalive/shared.
function Get-Luminance($color) {
    $canali = foreach ($c in @($color.R, $color.G, $color.B)) {
        $s = $c / 255.0
        if ($s -le 0.04045) { $s / 12.92 } else { [Math]::Pow(($s + 0.055) / 1.055, 2.4) }
    }
    return 0.2126 * $canali[0] + 0.7152 * $canali[1] + 0.0722 * $canali[2]
}

# Senza grafica del cliente (una volta sola): testata con il logo di ArenaLive in alto a sinistra, sullo sfondo della
# finestra, nella versione adatta (positivo su sfondo chiaro, negativo su sfondo scuro; l'altra se manca).
function Set-ProductHeader($product) {
    if ($script:brandingApplied -or $null -eq $product) { return }
    $scuro = (Get-Luminance $form.BackColor) -lt 0.5
    if ($scuro) { $percorsi = @($product.logoNegative, $product.logoPositive) } else { $percorsi = @($product.logoPositive, $product.logoNegative) }
    $logo = $null
    foreach ($percorso in $percorsi) { if ($null -eq $logo) { $logo = Read-Logo $percorso } }
    if ($null -eq $logo) { return }
    $script:brandingApplied = $true
    $form.SuspendLayout()
    foreach ($control in @($form.Controls)) { $control.Top += $AltezzaTestata }
    $header = New-Object System.Windows.Forms.Panel
    $header.Location = New-Object System.Drawing.Point(0, 0)
    $header.Size = New-Object System.Drawing.Size($LarghezzaForm, $AltezzaTestata)
    $header.BackColor = $form.BackColor
    $picture = New-Object System.Windows.Forms.PictureBox
    $picture.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
    $picture.Location = New-Object System.Drawing.Point($Margine, 8)
    $picture.Size = New-Object System.Drawing.Size($LarghezzaLogo, ($AltezzaTestata - 16))
    $picture.Image = $logo
    $header.Controls.Add($picture)
    $form.Controls.Add($header)
    $form.ClientSize = New-Object System.Drawing.Size($LarghezzaForm, ($form.ClientSize.Height + $AltezzaTestata))
    $form.ResumeLayout()
}

function Receive-AgentMessage($message) {
    switch ([string]$message.type) {
        'init' {
            $txtFolder.Text = [string]$message.watchPath
            $txtServer.Text = [string]$message.serverUrl
            $script:tokenPresent = [bool]$message.token.present
            if ($script:tokenPresent) {
                $lblTokenInfo.Text = 'salvato (…' + [string]$message.token.last4 + ')'
            } else {
                $lblTokenInfo.Text = 'mancante: incollalo'
            }
            $txtToken.Text = ''
            if ($message.configError) { Show-Error $message.configError }
            if ($message.product) { Set-WindowIcon $message.product.icon }
            if ($message.branding) { Set-Branding $message.branding }
            if ($message.product) { Set-ProductHeader $message.product }
            Update-Controls
        }
        'state' { Show-State $message.phase $message.status }
        'log' { Add-Log $message.time $message.level $message.msg }
        'error' {
            $script:regBusy = $false
            Show-Error $message.message
            Update-Controls
        }
        'registration' { Show-Registration $message }
    }
}

function Get-FirstRemovableDrive {
    try {
        $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter 'DriveType = 2' -ErrorAction Stop | Select-Object -First 1
        if ($disk) { return ([string]$disk.DeviceID + '\') }
    } catch { }
    try {
        $drive = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Removable' -and $_.IsReady } | Select-Object -First 1
        if ($drive) { return [string]$drive.RootDirectory.FullName }
    } catch { }
    return $null
}

function Get-StartFolder {
    $current = $txtFolder.Text.Trim()
    if ($current -ne '') {
        if (Test-Path -LiteralPath $current -PathType Container) { return $current }
        $parent = Split-Path -Path $current -Parent
        if ($parent -and (Test-Path -LiteralPath $parent -PathType Container)) { return $parent }
    }
    return Get-FirstRemovableDrive
}

# --- Sfoglia…: una cartella (il .dvw più recente) oppure un singolo file .dvw ---
$menuBrowse = New-Object System.Windows.Forms.ContextMenuStrip
$itemFolder = $menuBrowse.Items.Add('Scegli una cartella (il .dvw più recente)…')
$itemFile = $menuBrowse.Items.Add('Scegli un file .dvw…')

$itemFolder.Add_Click({
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Cartella in cui DataVolley salva il file .dvw (di solito la pennina)'
    $dialog.ShowNewFolderButton = $false
    $start = Get-StartFolder
    if ($start) { $dialog.SelectedPath = $start }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { $txtFolder.Text = $dialog.SelectedPath }
    $dialog.Dispose()
})

$itemFile.Add_Click({
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'File .dvw di DataVolley'
    $dialog.Filter = 'File DataVolley (*.dvw)|*.dvw|Tutti i file (*.*)|*.*'
    $dialog.CheckFileExists = $true
    $start = Get-StartFolder
    if ($start) { $dialog.InitialDirectory = $start }
    if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { $txtFolder.Text = $dialog.FileName }
    $dialog.Dispose()
})

$btnBrowse.Add_Click({
    $menuBrowse.Show($btnBrowse, (New-Object System.Drawing.Point(0, $btnBrowse.Height)))
})

$lnkAdvanced.Add_LinkClicked({ Set-Advanced (-not $script:advancedOpen) })
$txtToken.Add_TextChanged({ Update-Controls })
$txtName.Add_TextChanged({ Update-Controls })

$btnRegister.Add_Click({
    # Come il server: una riga, senza caratteri di controllo (un tab incollato diventa uno spazio).
    $name = ($txtName.Text -replace '[\x00-\x1F\x7F]', ' ').Trim()
    if ($name -eq '') {
        Show-Error 'Scrivi il nome dell''agente (es. il nome del PC o del campo)'
        return
    }
    Show-Error ''
    $script:regBusy = $true
    $lblPairing.Text = ''
    $lblRegState.Text = 'Richiesta al server…'
    $lblRegState.ForeColor = [System.Drawing.Color]::DimGray
    Update-Controls
    Send-AgentMessage @{ type = 'register'; name = $name }
})

$btnCancelReg.Add_Click({
    $btnCancelReg.Enabled = $false
    Send-AgentMessage @{ type = 'cancelRegistration' }
})

$btnStart.Add_Click({
    $folder = $txtFolder.Text.Trim()
    if ($folder -eq '') {
        Show-Error 'Scegli la cartella (o il file) del .dvw con «Sfoglia…»'
        return
    }
    Show-Error ''
    $message = @{ type = 'start'; watchPath = $folder }
    $token = $txtToken.Text.Trim()
    if ($token -ne '') { $message.token = $token }
    $script:phase = 'starting'
    Update-Controls
    Send-AgentMessage $message
})

$btnStop.Add_Click({
    $btnStop.Enabled = $false
    Send-AgentMessage @{ type = 'stop' }
})

$form.Add_FormClosing({
    param($source, $closing)
    if ($script:agentGone -or $script:quitSent) { return }
    if ($script:phase -eq 'starting' -or $script:phase -eq 'running' -or $script:phase -eq 'stopping') {
        $answer = [System.Windows.Forms.MessageBox]::Show($form, 'La lettura del .dvw è in corso: fermarla e chiudere?', $Titolo, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
            $closing.Cancel = $true
            return
        }
    }
    $script:quitSent = $true
    Send-AgentMessage @{ type = 'quit' }
})

# --- messaggi dall'agente ---
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $IntervalloMs
$timer.Add_Tick({
    $line = $null
    while ($inbox.TryDequeue([ref]$line)) {
        if ($line -eq $FineInput) {
            # L'agente non c'è più: la finestra si chiude.
            $script:agentGone = $true
            $timer.Stop()
            $form.Close()
            return
        }
        try {
            $message = $line | ConvertFrom-Json
        } catch {
            continue
        }
        Receive-AgentMessage $message
    }
})

Update-Controls
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
$timer.Stop()
try { $stdout.Close() } catch { }
[Environment]::Exit(0)
