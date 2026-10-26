#!/usr/bin/env bash
# Pubblica il software del Player dove lo serve il portale (AGENT_DOWNLOAD_HOST_DIR del .env, letta dal server come
# PLAYER_DOWNLOAD_DIR): il .deb (arenalive-player.deb + arenalive-player.json) e l'immagine della scheda SD nel formato 2
# (arenalive-player-image-{1,2,3}.gz + arenalive-player-image.json). La versione è quella fissata nel campo
# "arenalivePlayer" del package.json alla radice; i file sono gli allegati della release vX.Y.Z del repository privato
# del Player su GitHub, letti con un token in sola lettura (PLAYER_GITHUB_TOKEN_FILE). Se i file pubblicati sono già di
# quella versione e corrispondono ai manifest non scarica nulla. Senza token avvisa e non fa nulla.
# Lo chiama aggiorna-produzione.sh; a mano (root): scripts/pubblica-player-produzione.sh [--forza]

# --- variabili ---
CONFIG_SISTEMA="${CONFIG_SISTEMA:-/etc/arenalive/produzione.conf}"        # scritta da installa-produzione.sh
CARTELLA_INSTALLAZIONE="${CARTELLA_INSTALLAZIONE:-/opt/arenalive}"        # dove sta il codice (di norma da CONFIG_SISTEMA)
PLAYER_GITHUB_TOKEN_FILE="${PLAYER_GITHUB_TOKEN_FILE:-/etc/arenalive/player-github-token}"  # file 0600 di root con il token GitHub in sola lettura (di norma da CONFIG_SISTEMA)
FILE_VERSIONE="package.json"                                                 # campo "arenalivePlayer": versione del Player da pubblicare
REPO_PLAYER="lucagammelli/ArenaLive-Player"                                  # repository GitHub del Player (privato)
URL_API_GITHUB="${ARENALIVE_PROVA_URL_API:-https://api.github.com}"          # API di GitHub; ARENALIVE_PROVA_URL_API solo per le prove locali (http solo verso 127.0.0.1)
MARGINE_SPAZIO_MB="200"                                                      # spazio libero da lasciare oltre ai file scaricati
FORZA="${1:-}"                                                               # --forza: scarica e pubblica anche se è già tutto a posto

# --- codice ---
set -Eeuo pipefail
trap 'echo "ERRORE: pubblicazione del Player interrotta alla riga $LINENO ($BASH_COMMAND)" >&2' ERR

PEZZI=(arenalive-player-image-1.gz arenalive-player-image-2.gz arenalive-player-image-3.gz)
MANIFEST_IMMAGINE="arenalive-player-image.json"
MANIFEST_DEB="arenalive-player.json"
DEB_PUBBLICATO="arenalive-player.deb"
lavoro=""   # cartella temporanea dei download (rimossa all'uscita)

sha_di() { sha256sum "$1" | awk '{print $1}'; }

# 0 se in $1 il .deb è della versione $2 e corrisponde al suo manifest.
deb_valido() {
    local dir=$1 versione=$2 deb=$3
    [[ -f "$dir/$MANIFEST_DEB" && -f "$dir/$deb" ]] || return 1
    [[ "$(jq -r '.version // empty' "$dir/$MANIFEST_DEB" 2>/dev/null)" == "$versione" ]] || return 1
    [[ "$(jq -r '.sha256 // empty' "$dir/$MANIFEST_DEB" 2>/dev/null)" == "$(sha_di "$dir/$deb")" ]]
}

# 0 se in $1 il manifest dell'immagine è del formato 2, della versione $2, con i tre pezzi fissi di dimensione e sha256 giusti.
immagine_valida() {
    local dir=$1 versione=$2 m="$1/$MANIFEST_IMMAGINE" i nome
    [[ -f "$m" ]] || return 1
    [[ "$(jq -r '.format // empty' "$m" 2>/dev/null)" == "2" && "$(jq -r '.version // empty' "$m")" == "$versione" ]] || return 1
    [[ "$(jq -r '[.parts[]?.file] | join(" ")' "$m")" == "${PEZZI[*]}" ]] || return 1
    for i in 0 1 2; do
        nome="${PEZZI[$i]}"
        [[ -f "$dir/$nome" ]] || return 1
        [[ "$(stat -c %s "$dir/$nome")" == "$(jq -r ".parts[$i].size" "$m")" ]] || return 1
        [[ "$(sha_di "$dir/$nome")" == "$(jq -r ".parts[$i].sha256" "$m")" ]] || return 1
    done
}

# Il token, mai come argomento di un comando (ps) né nei log: curl legge l'header da stdin (--config -).
curl_github() {
    local token=$1 protocollo=https
    shift
    [[ "$URL_API_GITHUB" == https://* ]] || protocollo=http   # solo le prove locali (indirizzo controllato in principale)
    # Sui redirect verso un altro host (gli allegati stanno su objects.githubusercontent.com) curl non manda l'header.
    printf 'header = "Authorization: Bearer %s"\n' "$token" |
        curl --config - --fail --silent --show-error --location --proto "=$protocollo" --proto-redir "=$protocollo" \
            --retry 3 --retry-delay 5 \
            --connect-timeout 20 -H 'X-GitHub-Api-Version: 2022-11-28' "$@"
}

# Scarica gli allegati della release v$2 in una cartella temporanea dentro $1, li verifica e li pubblica in $1.
pubblica_player() {
    local uscita=$1 versione=$2 token=$3
    local deb="arenalive-player_${versione}_arm64.deb" release
    install -d -m 0755 "$uscita"
    # Cartelle lasciate da un'esecuzione uccisa (SIGKILL: la trap non gira), fino a 1,5 GB ciascuna. Un'altra
    # pubblicazione in corso non c'è: aggiorna-produzione.sh ne lancia una sola alla volta (lock).
    find "$uscita" -mindepth 1 -maxdepth 1 -type d -name '.player-*' -exec rm -rf {} +
    lavoro="$(mktemp -d "$uscita/.player-XXXXXX")"
    trap 'rm -rf "${lavoro:-}"' EXIT   # anche su errore o interruzione

    release="$lavoro/release.json"
    if ! curl_github "$token" -H 'Accept: application/vnd.github+json' -o "$release" \
        "$URL_API_GITHUB/repos/$REPO_PLAYER/releases/tags/v$versione"; then
        echo "ERRORE: release v$versione di $REPO_PLAYER non trovata o token non valido (serve «Contents: read» su quel repository)" >&2
        return 1
    fi
    # Solo gli allegati attesi, con i loro nomi fissi: nessun nome di file viene dalla risposta.
    local nomi=("$deb" "$MANIFEST_DEB" "${PEZZI[@]}" "$MANIFEST_IMMAGINE") nome id dimensione totale=0
    declare -A ids=() dimensioni=()
    for nome in "${nomi[@]}"; do
        id="$(jq -r --arg n "$nome" '[.assets[]? | select(.name == $n)][0].id // empty' "$release")"
        dimensione="$(jq -r --arg n "$nome" '[.assets[]? | select(.name == $n)][0].size // empty' "$release")"
        [[ "$id" =~ ^[0-9]+$ && "$dimensione" =~ ^[0-9]+$ ]] || { echo "ERRORE: la release v$versione non ha l'allegato $nome" >&2; return 1; }
        ids[$nome]=$id
        dimensioni[$nome]=$dimensione
        totale=$((totale + dimensione))
    done
    local libero
    libero="$(df -P -B1 "$uscita" | awk 'NR==2 {print $4}')"
    (( libero > totale + MARGINE_SPAZIO_MB * 1024 * 1024 )) \
        || { echo "ERRORE: spazio insufficiente in $uscita ($totale byte da scaricare, $libero liberi)" >&2; return 1; }

    for nome in "${nomi[@]}"; do
        echo "    scarico $nome"
        # Mai più byte di quelli dichiarati dall'API (lo spazio è stato controllato su quelli).
        curl_github "$token" -H 'Accept: application/octet-stream' --max-filesize "${dimensioni[$nome]}" -o "$lavoro/$nome" \
            "$URL_API_GITHUB/repos/$REPO_PLAYER/releases/assets/${ids[$nome]}"
    done
    deb_valido "$lavoro" "$versione" "$deb" || { echo "ERRORE: il .deb scaricato non corrisponde a $MANIFEST_DEB della versione $versione" >&2; return 1; }
    immagine_valida "$lavoro" "$versione" || { echo "ERRORE: i pezzi dell'immagine scaricati non corrispondono a $MANIFEST_IMMAGINE della versione $versione" >&2; return 1; }

    chmod 0644 "$lavoro/$deb" "$lavoro/$MANIFEST_DEB" "$lavoro/$MANIFEST_IMMAGINE" "${PEZZI[@]/#/$lavoro/}"
    # Prima i pezzi poi il manifest, prima il .deb poi il suo manifest: il server offre un file solo quando
    # corrisponde al manifest, e ogni mv nello stesso filesystem è atomico.
    for nome in "${PEZZI[@]}"; do mv -f "$lavoro/$nome" "$uscita/$nome"; done
    mv -f "$lavoro/$MANIFEST_IMMAGINE" "$uscita/$MANIFEST_IMMAGINE"
    mv -f "$lavoro/$deb" "$uscita/$DEB_PUBBLICATO"
    mv -f "$lavoro/$MANIFEST_DEB" "$uscita/$MANIFEST_DEB"
    # Il formato 1 (immagine .img.xz) solo dopo: il nuovo manifest l'ha già sostituito.
    rm -f "$uscita/arenalive-player.img.xz"
    echo "Player $versione pubblicato in $uscita: .deb, tre pezzi dell'immagine e manifest."
}

principale() {
    [[ $EUID -eq 0 ]] || { echo "ERRORE: va eseguito come root" >&2; exit 1; }
    if [[ -r "$CONFIG_SISTEMA" ]]; then
        # shellcheck disable=SC1090
        . "$CONFIG_SISTEMA"
    fi
    pubblica_installazione
}

# Tutto quello che segue i controlli di root e la configurazione (le prove locali lo chiamano da qui).
pubblica_installazione() {
    cd "$CARTELLA_INSTALLAZIONE"
    local uscita versione token=""
    uscita="$(grep -E '^AGENT_DOWNLOAD_HOST_DIR=' .env | tail -n 1 | cut -d= -f2-)"
    [[ "$uscita" =~ ^/[A-Za-z0-9._/-]+$ ]] || { echo "ERRORE: AGENT_DOWNLOAD_HOST_DIR mancante o non valido nel .env" >&2; exit 1; }
    versione="$(jq -r '.arenalivePlayer // empty' "$FILE_VERSIONE" 2>/dev/null || true)"   # jq c'è in produzione, node no
    if [[ -z "$versione" ]]; then
        echo "Nessuna versione del Player fissata in $FILE_VERSIONE (campo arenalivePlayer): niente da pubblicare."
        return 0
    fi
    [[ "$versione" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "ERRORE: arenalivePlayer non è X.Y.Z in $FILE_VERSIONE" >&2; exit 1; }
    if [[ "$FORZA" != "--forza" ]] && deb_valido "$uscita" "$versione" "$DEB_PUBBLICATO" && immagine_valida "$uscita" "$versione"; then
        echo "Player $versione già pubblicato in $uscita: niente da scaricare."
        return 0
    fi
    if [[ -r "$PLAYER_GITHUB_TOKEN_FILE" ]]; then
        token="$(tr -d '[:space:]' <"$PLAYER_GITHUB_TOKEN_FILE")"
    fi
    if [[ -z "$token" ]]; then
        echo "ATTENZIONE: Player $versione non pubblicato: manca il token GitHub in $PLAYER_GITHUB_TOKEN_FILE" >&2
        echo "            (token fine-grained con «Contents: read» solo su $REPO_PLAYER; docs/infrastruttura.md)." >&2
        return 0
    fi
    [[ "$token" =~ ^[A-Za-z0-9_]{20,255}$ ]] || { echo "ERRORE: il token in $PLAYER_GITHUB_TOKEN_FILE non ha un formato valido" >&2; exit 1; }
    [[ "$URL_API_GITHUB" =~ ^https://[A-Za-z0-9.-]+$ || "$URL_API_GITHUB" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] \
        || { echo "ERRORE: indirizzo dell'API non valido" >&2; exit 1; }
    echo "Pubblicazione del Player $versione dalla release v$versione di $REPO_PLAYER"
    pubblica_player "$uscita" "$versione" "$token"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    principale "$@"
    exit 0
fi
