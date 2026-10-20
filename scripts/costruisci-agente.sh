#!/usr/bin/env bash
# Costruisce arenalive-agent.exe (Node SEA per Windows x64) da Linux e lo pubblica nella cartella che il server offre in
# download dal portale (AGENT_DOWNLOAD_DIR). Stessi passi di apps/agent/scripts/build-exe.ps1, ma con il node.exe
# scaricato da nodejs.org e verificato con lo sha256 di SHASUMS256.txt.
#
# Uso: scripts/costruisci-agente.sh            (variabili qui sotto; USCITA e NODE_VERSIONE si possono passare
#      USCITA=/srv/arenalive/downloads scripts/costruisci-agente.sh            anche dall'ambiente)
# Serve: Node della stessa versione di NODE_VERSIONE (node --version), pnpm (corepack enable), curl, sha256sum,
# `pnpm install` già fatto. Scarica circa 30 MB e crea circa 95 MB in USCITA.

# --- variabili ---
RADICE="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"                # radice del repository (percorso reale, senza link simbolici)
NODE_VERSIONE="${NODE_VERSIONE:-$(node --version | sed 's/^v//')}"      # versione di node.exe: deve essere quella del node locale (il blob SEA dipende dalla versione)
NODE_URL="https://nodejs.org/dist/v${NODE_VERSIONE}"                    # cartella di nodejs.org con node.exe e SHASUMS256.txt
NODE_FILE="win-x64/node.exe"                                            # percorso di node.exe dentro NODE_URL (come in SHASUMS256.txt)
USCITA="${USCITA:-$HOME/arenalive-agent-download}"                            # cartella d'uscita (arenalive-agent.exe e arenalive-agent.json): quella di AGENT_DOWNLOAD_DIR, mai dentro il repository
PACCHETTO="@arenalive/agent"                                                  # nome del pacchetto in apps/agent/package.json
BUNDLE="$RADICE/apps/agent/build/arenalive-agent.cjs"                         # bundle CJS prodotto dallo script "bundle" di package.json
POSTJECT="postject@1.0.0-alpha.6"                                       # strumento che inietta il blob nell'exe (npmjs.com/package/postject)
RISORSA="NODE_SEA_BLOB"                                                 # nome fisso della risorsa SEA (docs Node, «Single executable applications»)
SENTINELLA="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"             # valore fisso di Node SEA (stessa pagina della documentazione)

# --- passi ---
set -euo pipefail
inizio=$(date +%s)
cd "$RADICE"
# Confronto tra percorsi reali: un link simbolico non porta l'uscita dentro il repository.
case "$(realpath -m "$USCITA")/" in
    "$RADICE"/*) echo "USCITA ($USCITA) è dentro il repository: scegli una cartella fuori" >&2; exit 1 ;;
esac
locale="$(node --version | sed 's/^v//')"
if [[ "$locale" != "$NODE_VERSIONE" ]]; then
    echo "Il node locale è $locale ma NODE_VERSIONE è $NODE_VERSIONE: il blob SEA va creato con la stessa versione" >&2
    exit 1
fi
TEMP="$(mktemp -d)"                                                     # download, blob e exe in costruzione (rimossa alla fine)
trap 'rm -rf "$TEMP"' EXIT

echo "1/6 Bundle con esbuild"
pnpm --filter "$PACCHETTO" bundle

echo "2/6 Download di node.exe v$NODE_VERSIONE e SHASUMS256.txt"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$TEMP/SHASUMS256.txt" "$NODE_URL/SHASUMS256.txt"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$TEMP/node.exe" "$NODE_URL/$NODE_FILE"

echo "3/6 Verifica dello sha256 di node.exe"
atteso="$(awk -v f="$NODE_FILE" '$2 == f { print $1 }' "$TEMP/SHASUMS256.txt")"
reale="$(sha256sum "$TEMP/node.exe" | awk '{ print $1 }')"
if [[ -z "$atteso" || "$atteso" != "$reale" ]]; then
    echo "sha256 di node.exe non coincide (atteso '${atteso:-assente}', scaricato '$reale'): interrotto" >&2
    exit 1
fi

echo "4/6 Blob SEA"
cat > "$TEMP/sea-config.json" <<EOF
{ "main": "$BUNDLE", "output": "$TEMP/arenalive-agent.blob", "disableExperimentalSEAWarning": true, "useCodeCache": false, "useSnapshot": false }
EOF
node --experimental-sea-config "$TEMP/sea-config.json"

echo "5/6 Iniezione del blob in una copia di node.exe"
cp "$TEMP/node.exe" "$TEMP/arenalive-agent.exe"
npx --yes "$POSTJECT" "$TEMP/arenalive-agent.exe" "$RISORSA" "$TEMP/arenalive-agent.blob" --sentinel-fuse "$SENTINELLA"

echo "6/6 Pubblicazione in $USCITA"
base="$(node scripts/versione.mjs)"   # versione del package.json alla radice (unica fonte)
commit="$(git rev-parse --short HEAD 2>/dev/null || echo locale)"
versione="$base-$commit"
sha="$(sha256sum "$TEMP/arenalive-agent.exe" | awk '{ print $1 }')"
data="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
mkdir -p "$USCITA"
# Prima le due copie temporanee, poi i rename exe → json: il server non vede mai un file a metà e, nell'istante tra
# i due, trova il nuovo exe con il vecchio json (sha256 diverso: «non disponibile» per un attimo, mai un exe sbagliato).
cp "$TEMP/arenalive-agent.exe" "$USCITA/.arenalive-agent.exe.tmp"
printf '{\n  "version": "%s",\n  "builtAt": "%s",\n  "sha256": "%s",\n  "nodeVersion": "%s"\n}\n' \
    "$versione" "$data" "$sha" "$NODE_VERSIONE" > "$USCITA/.arenalive-agent.json.tmp"
mv -f "$USCITA/.arenalive-agent.exe.tmp" "$USCITA/arenalive-agent.exe"
mv -f "$USCITA/.arenalive-agent.json.tmp" "$USCITA/arenalive-agent.json"

fine=$(date +%s)
echo "Creato $USCITA/arenalive-agent.exe (versione $versione, $(du -h "$USCITA/arenalive-agent.exe" | cut -f1), sha256 $sha) in $((fine - inizio)) s"
