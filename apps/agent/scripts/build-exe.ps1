# Costruisce arenalive-agent.exe (Node SEA, un solo eseguibile senza Node installato) per il PC di DataVolley.
# Da lanciare su Windows in PowerShell, con Node 24 per Windows, pnpm (corepack enable) e `pnpm install` già fatto.
# Uso: powershell -ExecutionPolicy Bypass -File apps\agent\scripts\build-exe.ps1

# --- variabili ---
$Radice      = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path   # radice del repository (ricavata dalla posizione dello script)
$Pacchetto   = "@arenalive/agent"                                               # nome del pacchetto in apps\agent\package.json
$Agente      = Join-Path $Radice "apps\agent"                             # cartella del pacchetto
$NodeExe     = (Get-Command node.exe).Source                              # node.exe di Windows usato come base dell'eseguibile (deve essere Node 24: node --version)
$Uscita      = Join-Path $Agente "build"                                  # cartella di bundle, blob ed eseguibile (esclusa da git)
$Bundle      = Join-Path $Uscita "arenalive-agent.cjs"                          # bundle CJS prodotto dallo script "bundle" di package.json
$SeaConfig   = Join-Path $Uscita "sea-config.json"                        # configurazione SEA scritta da questo script
$SeaBlob     = Join-Path $Uscita "arenalive-agent.blob"                         # blob SEA prodotto da node --experimental-sea-config
$Exe         = Join-Path $Uscita "arenalive-agent.exe"                          # eseguibile finale
$Postject    = "postject@1.0.0-alpha.6"                                   # strumento che inietta il blob nell'exe (npmjs.com/package/postject)
$Risorsa     = "NODE_SEA_BLOB"                                            # nome fisso della risorsa SEA (docs Node, «Single executable applications»)
$Sentinella  = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"           # valore fisso di Node SEA (stessa pagina della documentazione)
$CodeCache   = $false                                                     # cache del codice V8 nel blob: false = exe più piccolo, avvio di poco più lento
$SenzaAvviso = $true                                                      # true = niente avviso «experimental» di Node all'avvio dell'exe
$Snapshot    = $false                                                     # snapshot V8 di avvio: non usato (il bundle non è preparato per useSnapshot)

# --- passi ---
$ErrorActionPreference = "Stop"
Set-Location $Radice

Write-Host "1/4 Bundle con esbuild"
pnpm --filter $Pacchetto bundle
if ($LASTEXITCODE -ne 0) { throw "bundle fallito" }

Write-Host "2/4 Blob SEA"
$Json = @{ main = $Bundle; output = $SeaBlob; disableExperimentalSEAWarning = $SenzaAvviso; useCodeCache = $CodeCache; useSnapshot = $Snapshot } | ConvertTo-Json
[System.IO.File]::WriteAllText($SeaConfig, $Json)   # UTF-8 senza BOM: Node non accetta il BOM nel JSON
& $NodeExe --experimental-sea-config $SeaConfig
if ($LASTEXITCODE -ne 0) { throw "generazione del blob SEA fallita" }

Write-Host "3/4 Copia di node.exe e iniezione del blob"
Copy-Item $NodeExe $Exe -Force
npx --yes $Postject $Exe $Risorsa $SeaBlob --sentinel-fuse $Sentinella
if ($LASTEXITCODE -ne 0) { throw "postject fallito" }

Write-Host "4/4 Verifica"
& $Exe --help
if ($LASTEXITCODE -ne 0) { throw "arenalive-agent.exe non parte" } else { Write-Host "Creato $Exe" }
