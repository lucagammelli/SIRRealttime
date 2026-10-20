#!/usr/bin/env bash
# Costruisce l'agente C# (apps/agent-dotnet) da Linux: test xUnit della libreria core e arenalive-agent.exe per Windows x64
# (exe unico autosufficiente: runtime .NET incluso, compresso). Tutto avviene in un container temporaneo dell'SDK .NET:
# sul server non si installa niente. Alla fine container, cache NuGet e (se RIMUOVI_IMMAGINE=1) l'immagine SDK sono
# rimossi, per non riempire il disco.
#
# Uso: scripts/costruisci-agente-dotnet.sh            (variabili qui sotto; VERSIONE, USCITA e RIMUOVI_IMMAGINE si
#      VERSIONE=1.2.3 scripts/costruisci-agente-dotnet.sh   possono passare anche dall'ambiente)
# Senza VERSIONE usa la versione del package.json alla radice (unica fonte della versione, docs/regole/test-job-rilasci.md).
# Serve: Docker (utente nel gruppo docker), circa 5 GB liberi su / durante la build (immagine SDK ~1 GB, pacchetti
# NuGet e runtime Windows ~1 GB, compilazione). Scarica circa 1,5 GB alla prima esecuzione.

# --- variabili ---
RADICE="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"            # radice del repository (percorso reale)
VERSIONE="${VERSIONE:-$(node "$RADICE/scripts/versione.mjs")}"           # versione dell'agente: a.b.c, di norma quella del package.json alla radice (finisce nelle proprietà dell'exe e nel nome del file)
USCITA="${USCITA:-$RADICE/dist}"                                      # cartella dell'exe prodotto (dist/ è esclusa da git)
IMMAGINE="mcr.microsoft.com/dotnet/sdk:10.0"                          # SDK .NET 10 LTS ufficiale Microsoft (mcr.microsoft.com)
RIMUOVI_IMMAGINE="${RIMUOVI_IMMAGINE:-1}"                             # 1 = alla fine rimuove l'immagine SDK se l'ha scaricata questa build (spazio disco); 0 = la tiene sempre
SPAZIO_MINIMO_GB=5                                                    # spazio libero minimo su / per partire
PROGETTO_APP="apps/agent-dotnet/src/ArenaLive.Agent.App/ArenaLive.Agent.App.csproj" # progetto dell'exe (WinForms, net10.0-windows)
PROGETTO_TEST="apps/agent-dotnet/tests/ArenaLive.Agent.Core.Tests/ArenaLive.Agent.Core.Tests.csproj" # test xUnit della libreria core
NOME_CONTAINER="arenalive-agent-dotnet-build-$$"                            # nome del container temporaneo (rimosso alla fine)

# --- passi ---
set -euo pipefail
inizio=$(date +%s)
cd "$RADICE"
if ! [[ "$VERSIONE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "VERSIONE ($VERSIONE) deve essere nella forma a.b.c (solo numeri)" >&2
    exit 1
fi
command -v docker >/dev/null || { echo "Docker non disponibile: serve per la build dell'agente C#" >&2; exit 1; }
libero_kb="$(df --output=avail -k / | tail -1 | tr -d ' ')"
if (( libero_kb < SPAZIO_MINIMO_GB * 1024 * 1024 )); then
    echo "Spazio libero su / insufficiente: $((libero_kb / 1024 / 1024)) GB, ne servono almeno $SPAZIO_MINIMO_GB (df -h /)" >&2
    exit 1
fi
commit="${ARENALIVE_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo locale)}"
# L'immagine si rimuove alla fine solo se non c'era già prima della build (non si tolgono immagini di altri).
immagine_presente=0
docker image inspect "$IMMAGINE" >/dev/null 2>&1 && immagine_presente=1
TEMP="$(mktemp -d "$HOME/.arenalive-agent-dotnet-XXXXXX")"                  # sorgenti copiati, cache NuGet e uscita del container (rimossa alla fine; non in /tmp, che è in RAM)
pulisci() {
    docker rm -f "$NOME_CONTAINER" >/dev/null 2>&1 || true
    rm -rf "$TEMP"
    if [[ "$RIMUOVI_IMMAGINE" == "1" && "$immagine_presente" == "0" ]]; then
        docker rmi "$IMMAGINE" >/dev/null 2>&1 && echo "Immagine $IMMAGINE rimossa" || true
    fi
}
trap pulisci EXIT

echo "1/4 Copia dei sorgenti (senza bin/ e obj/)"
mkdir -p "$TEMP/src" "$TEMP/nuget" "$TEMP/home" "$TEMP/out"
# Solo ciò che serve: l'agente C# e i file del repository letti dai test (marcatore della radice, .dvw di esempio,
# config.json di esempio dell'agente Node).
tar -C "$RADICE" --exclude='bin' --exclude='obj' --exclude='TestResults' -cf - \
    pnpm-workspace.yaml apps/agent-dotnet apps/agent/config.example.json packages/dvw-parser/test/fixtures \
    | tar -C "$TEMP/src" -xf -

echo "2/4 Test xUnit della libreria core (Linux, $IMMAGINE)"
eseguire() {   # comando dentro il container, come l'utente corrente (i file prodotti restano suoi)
    docker run --rm --name "$NOME_CONTAINER" --user "$(id -u):$(id -g)" \
        -e HOME=/home/dev -e DOTNET_CLI_HOME=/home/dev -e NUGET_PACKAGES=/nuget \
        -e DOTNET_NOLOGO=1 -e DOTNET_CLI_TELEMETRY_OPTOUT=1 -e DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
        -v "$TEMP/src:/work" -v "$TEMP/nuget:/nuget" -v "$TEMP/home:/home/dev" -v "$TEMP/out:/out" \
        -w /work/apps/agent-dotnet "$IMMAGINE" "$@"
}
eseguire dotnet test --project "/work/$PROGETTO_TEST" -c Release

echo "3/4 Pubblicazione di arenalive-agent.exe (win-x64, exe unico autosufficiente)"
eseguire dotnet publish "/work/$PROGETTO_APP" -c Release -r win-x64 --self-contained true \
    -p:EnableWindowsTargeting=true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true \
    -p:IncludeNativeLibrariesForSelfExtract=true -p:Version="$VERSIONE" -p:FileVersion="$VERSIONE.0" \
    -p:InformationalVersion="$VERSIONE+$commit" -o /out

echo "4/4 Copia in $USCITA"
[[ -f "$TEMP/out/arenalive-agent.exe" ]] || { echo "arenalive-agent.exe non prodotto" >&2; exit 1; }
mkdir -p "$USCITA"
destinazione="$USCITA/arenalive-agent-$VERSIONE.exe"
cp "$TEMP/out/arenalive-agent.exe" "$destinazione.tmp"
mv -f "$destinazione.tmp" "$destinazione"
sha="$(sha256sum "$destinazione" | awk '{ print $1 }')"
fine=$(date +%s)
echo "Creato $destinazione (versione $VERSIONE+$commit, $(du -h "$destinazione" | cut -f1), sha256 $sha) in $((fine - inizio)) s"
