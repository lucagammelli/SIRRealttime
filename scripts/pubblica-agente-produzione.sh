#!/usr/bin/env bash
# Costruisce l'agente C# per Windows con scripts/costruisci-agente-dotnet.sh (solo Docker: container SDK .NET temporaneo,
# immagine rimossa a fine build) e lo pubblica dove lo serve il portale (AGENT_DOWNLOAD_HOST_DIR del .env):
# arenalive-agent.exe e arenalive-agent.json. Ricostruisce solo se la versione dell'agente è cambiata o i file mancano.
# Lo chiama aggiorna-produzione.sh; a mano (root): scripts/pubblica-agente-produzione.sh [--forza]

# --- variabili ---
CONFIG_SISTEMA="${CONFIG_SISTEMA:-/etc/arenalive/produzione.conf}"  # scritta da installa-produzione.sh
CARTELLA_INSTALLAZIONE="${CARTELLA_INSTALLAZIONE:-/opt/arenalive}"  # dove sta il codice (di norma da CONFIG_SISTEMA)
FILE_VERSIONE="package.json"                                           # unica fonte della versione (anche dell'agente): campo "version" alla radice
FORZA="${1:-}"                                                         # --forza: ricostruisce anche con versione invariata

# --- codice ---
set -Eeuo pipefail
trap 'echo "ERRORE: pubblicazione dell'"'"'agente interrotta alla riga $LINENO ($BASH_COMMAND)" >&2' ERR

lavoro=""   # cartella temporanea della build (rimossa all'uscita)
principale() {
    [[ $EUID -eq 0 ]] || { echo "ERRORE: va eseguito come root" >&2; exit 1; }
    if [[ -r "$CONFIG_SISTEMA" ]]; then
        # shellcheck disable=SC1090
        . "$CONFIG_SISTEMA"
    fi
    cd "$CARTELLA_INSTALLAZIONE"
    local uscita versione attuale
    uscita="$(grep -E '^AGENT_DOWNLOAD_HOST_DIR=' .env | tail -n 1 | cut -d= -f2-)"
    [[ "$uscita" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "ERRORE: AGENT_DOWNLOAD_HOST_DIR mancante o non valido nel .env" >&2; exit 1; }
    versione="$(jq -r '.version // empty' "$FILE_VERSIONE" 2>/dev/null || true)"   # jq c'è in produzione (installa-produzione.sh), node no
    [[ "$versione" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERRORE: versione non trovata in $FILE_VERSIONE" >&2; exit 1; }
    attuale="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$uscita/arenalive-agent.json" 2>/dev/null | head -n 1 || true)"
    if [[ "$FORZA" != "--forza" && "$attuale" == "$versione" && -f "$uscita/arenalive-agent.exe" ]]; then
        echo "Agente $versione già pubblicato in $uscita: niente da ricostruire."
        return 0
    fi
    echo "Costruzione dell'agente $versione (versione pubblicata: ${attuale:-nessuna})"
    install -d -m 0755 "$uscita"
    lavoro="$(mktemp -d "$uscita/.build-XXXXXX")"
    trap 'rm -rf "${lavoro:-}"' EXIT   # anche su errore o interruzione
    # Il repository è dell'utente di servizio: senza questo git (come root) non legge il commit e scrive «locale».
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$CARTELLA_INSTALLAZIONE" \
        VERSIONE="$versione" USCITA="$lavoro" RIMUOVI_IMMAGINE=1 \
        bash scripts/costruisci-agente-dotnet.sh
    [[ -f "$lavoro/arenalive-agent-$versione.exe" ]] || { echo "ERRORE: exe non prodotto" >&2; exit 1; }
    local sha
    sha="$(sha256sum "$lavoro/arenalive-agent-$versione.exe" | awk '{print $1}')"
    printf '{\n  "version": "%s",\n  "builtAt": "%s",\n  "sha256": "%s"\n}\n' \
        "$versione" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$sha" >"$lavoro/arenalive-agent.json"
    chmod 0644 "$lavoro/arenalive-agent-$versione.exe" "$lavoro/arenalive-agent.json"
    # Prima exe poi json, come costruisci-agente.sh: il server non offre mai un exe che non corrisponde al json.
    mv -f "$lavoro/arenalive-agent-$versione.exe" "$uscita/arenalive-agent.exe"
    mv -f "$lavoro/arenalive-agent.json" "$uscita/arenalive-agent.json"
    echo "Agente $versione pubblicato in $uscita (sha256 $sha)."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    principale "$@"
    exit 0
fi
