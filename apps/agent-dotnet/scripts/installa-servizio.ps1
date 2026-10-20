# Installa l'agente C# (arenalive-agent.exe) come servizio di Windows, senza NSSM: è lo stesso exe con --service.
# Da lanciare in PowerShell come amministratore. Rilanciarlo reinstalla il servizio (lo ferma e lo ricrea).
#
#   powershell -ExecutionPolicy Bypass -File C:\ArenaLiveAgent\installa-servizio.ps1

# --- variabili ---
$CartellaAgente = "C:\ArenaLiveAgent"                                   # cartella con arenalive-agent.exe e config.json (mai la pennina)
$Eseguibile     = Join-Path $CartellaAgente "arenalive-agent.exe"        # exe dell'agente C# (dist/arenalive-agent-<versione>.exe rinominato)
$Config         = Join-Path $CartellaAgente "config.json"          # configurazione (con agentToken: la registrazione si fa prima dalla finestra)
$NomeServizio   = "ArenaLiveAgent"                                       # nome del servizio (lo stesso del servizio NSSM dell'agente Node: si sostituiscono)
$NomeVisibile   = "ArenaLive Agent"                              # nome mostrato in Gestione servizi
$Descrizione    = "Legge il file .dvw di DataVolley e invia le azioni al server ArenaLive"
$TipoAvvio      = "Automatic"                                      # Automatic, Manual o Disabled
$RitardoRiavvioMs = 5000                                           # riavvio automatico dopo un'uscita inattesa (millisecondi)
$CartellaDati   = Join-Path $CartellaAgente "data"                 # dataDir di config.json (coda, lucchetto, registration.json): scrivibile anche dalla finestra
$CartellaLog    = Join-Path $CartellaAgente "logs"                 # logDir di config.json: scrivibile anche dalla finestra
$SidAdmin       = "*S-1-5-32-544"                                  # gruppo Administrators (SID: vale con Windows in qualsiasi lingua)
$SidSystem      = "*S-1-5-18"                                      # LocalSystem, l'account del servizio
$SidUtenti      = "*S-1-5-32-545"                                  # gruppo Users (utenti del PC che aprono la finestra)

# --- comandi ---
$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Lancia PowerShell come amministratore"
}
if (-not (Test-Path -LiteralPath $Eseguibile)) { throw "Non trovo $Eseguibile" }
if (-not (Test-Path -LiteralPath $Config)) { throw "Non trovo $Config (scaricalo dall'area admin, pagina «Agenti»)" }

Write-Host "Prova della configurazione con --once"
# arenalive-agent.exe è un'applicazione a finestra: senza -Wait PowerShell non aspetta la fine né il codice di uscita.
$prova = Start-Process -FilePath $Eseguibile -ArgumentList @('--config', ('"' + $Config + '"'), '--once', '--console') -Wait -PassThru -NoNewWindow
$codice = $prova.ExitCode
if ($codice -eq 1) {
    throw "Configurazione non valida (codice 1): correggi $Config"
} else {
    Write-Host "Prova terminata con codice $codice (0 inviato, 2 dati in coda, 3 nessun .dvw letto)"
}

$esistente = Get-Service -Name $NomeServizio -ErrorAction SilentlyContinue
if ($null -ne $esistente) {
    Write-Host "Servizio $NomeServizio già presente: lo fermo e lo rimuovo"
    if ($esistente.Status -ne "Stopped") { Stop-Service -Name $NomeServizio -Force }
    & sc.exe delete $NomeServizio | Out-Null
    Start-Sleep -Seconds 2
} else {
    Write-Host "Servizio $NomeServizio non presente: lo creo"
}

# Il servizio gira come LocalSystem: exe e config.json non devono essere modificabili dagli utenti (chi sostituisce
# l'exe eseguirebbe codice come SYSTEM). Cartella: controllo completo solo ad Administrators e SYSTEM, lettura ed
# esecuzione agli utenti. Solo dati e log restano modificabili dagli utenti, perché li scrive anche la finestra.
# Dopo questo passo config.json (token e cartella del .dvw) si cambia solo da amministratore.
foreach ($cartella in @($CartellaDati, $CartellaLog)) {
    if (-not (Test-Path -LiteralPath $cartella)) { New-Item -ItemType Directory -Path $cartella | Out-Null }
}
& icacls.exe $CartellaAgente /inheritance:r /grant:r "$($SidAdmin):(OI)(CI)F" "$($SidSystem):(OI)(CI)F" "$($SidUtenti):(OI)(CI)RX" /T /C /Q
if ($LASTEXITCODE -ne 0) {
    throw "icacls non riuscito su $CartellaAgente (codice $LASTEXITCODE)"
} else {
    Write-Host "Permessi di $CartellaAgente ristretti: scrittura solo ad Administrators e SYSTEM"
}
foreach ($cartella in @($CartellaDati, $CartellaLog)) {
    & icacls.exe $cartella /grant "$($SidUtenti):(OI)(CI)M" /T /C /Q
    if ($LASTEXITCODE -ne 0) {
        throw "icacls non riuscito su $cartella (codice $LASTEXITCODE)"
    } else {
        Write-Host "$cartella resta modificabile dagli utenti (coda e log della finestra)"
    }
}

$binario = '"' + $Eseguibile + '" --service --config "' + $Config + '"'
New-Service -Name $NomeServizio -BinaryPathName $binario -DisplayName $NomeVisibile -Description $Descrizione -StartupType $TipoAvvio | Out-Null
& sc.exe failure $NomeServizio reset= 86400 actions= restart/$RitardoRiavvioMs/restart/$RitardoRiavvioMs/restart/$RitardoRiavvioMs | Out-Null
Start-Service -Name $NomeServizio
Get-Service -Name $NomeServizio | Format-Table -AutoSize Name, Status, StartType
Write-Host "Log in $(Join-Path $CartellaAgente 'logs') (o in logDir di config.json)"
