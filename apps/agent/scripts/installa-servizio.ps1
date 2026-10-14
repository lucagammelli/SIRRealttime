# Installa e avvia sir-agent.exe come servizio Windows con NSSM (avvio automatico, riavvio se termina).
# Da lanciare in PowerShell come amministratore sul PC di DataVolley. Rilanciarlo reinstalla il servizio.
# Uso: powershell -ExecutionPolicy Bypass -File installa-servizio.ps1

# --- variabili ---
$Nssm           = "<percorso di nssm.exe, es. C:\nssm\win64\nssm.exe>"   # nssm.exe dallo zip di nssm.cc/download, cartella win64
$CartellaAgente = "C:\SIRAgent"                                          # cartella con sir-agent.exe e config.json (mai la pennina)
$Exe            = Join-Path $CartellaAgente "sir-agent.exe"              # eseguibile creato da build-exe.ps1 (apps\agent\build)
$Config         = Join-Path $CartellaAgente "config.json"                # copia di config.example.json compilata (token dall'area admin)
$LogServizio    = Join-Path $CartellaAgente "logs\servizio.log"          # stdout/stderr catturati da NSSM (i log dell'agente sono in logDir)
$NomeServizio   = "SIRAgent"                                             # nome del servizio (services.msc)
$NomeVisibile   = "SIRRealtime - agente DataVolley"                      # nome mostrato in services.msc
$Descrizione    = "Legge il file .dvw di DataVolley e invia le azioni al server SIRRealtime."   # descrizione mostrata in services.msc
$TipoAvvio      = "SERVICE_AUTO_START"                                   # avvio automatico all'accensione del PC (valori: documentazione di nssm)
$AzioneUscita   = "Restart"                                              # cosa fa NSSM se sir-agent.exe termina: lo riavvia
$RitardoRiavvio = 5000                                                   # millisecondi di attesa prima del riavvio automatico
$RuotaFile      = 1                                                      # 1 = NSSM ruota servizio.log
$RuotaByte      = 10485760                                               # dimensione oltre la quale servizio.log viene ruotato (10 MB)

# --- passi ---
$ErrorActionPreference = "Stop"
$Admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $Admin) { throw "Lancia PowerShell come amministratore" }
if (-not (Test-Path $Nssm)) { throw "nssm.exe non trovato: $Nssm" }
if (-not (Test-Path $Exe)) { throw "sir-agent.exe non trovato: $Exe" }
if (-not (Test-Path $Config)) { throw "config.json non trovato: copia config.example.json in $Config e compilalo" }
New-Item -ItemType Directory -Force -Path (Split-Path $LogServizio) | Out-Null

Write-Host "Prova della configurazione (--once)"
& $Exe --config $Config --once --console
if ($LASTEXITCODE -eq 1) { throw "configurazione non valida: vedi i messaggi sopra" } else { Write-Host "Configurazione valida (codice $LASTEXITCODE: 0 inviato, 2 dati in coda, 3 nessun .dvw trovato)" }

if (Get-Service -Name $NomeServizio -ErrorAction SilentlyContinue) {
    Write-Host "Servizio $NomeServizio già presente: lo reinstallo"
    & $Nssm stop $NomeServizio | Out-Null
    & $Nssm remove $NomeServizio confirm
} else {
    Write-Host "Installo il servizio $NomeServizio"
}

& $Nssm install $NomeServizio $Exe
& $Nssm set $NomeServizio AppParameters "--config `"$Config`""
& $Nssm set $NomeServizio AppDirectory $CartellaAgente
& $Nssm set $NomeServizio DisplayName $NomeVisibile
& $Nssm set $NomeServizio Description $Descrizione
& $Nssm set $NomeServizio Start $TipoAvvio
& $Nssm set $NomeServizio AppExit Default $AzioneUscita
& $Nssm set $NomeServizio AppRestartDelay $RitardoRiavvio
& $Nssm set $NomeServizio AppStdout $LogServizio
& $Nssm set $NomeServizio AppStderr $LogServizio
& $Nssm set $NomeServizio AppRotateFiles $RuotaFile
& $Nssm set $NomeServizio AppRotateBytes $RuotaByte
& $Nssm start $NomeServizio
Get-Service -Name $NomeServizio
