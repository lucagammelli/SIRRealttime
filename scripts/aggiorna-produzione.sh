#!/usr/bin/env bash
# Aggiorna ArenaLive in produzione: backup, scarica il ramo o tag, build, avvio (le migrazioni del database
# girano all'avvio del server), verifica della salute. Se la verifica fallisce torna alla versione precedente.
# Lo usa anche installa-produzione.sh per la prima installazione.
# Uso (come root):  scripts/aggiorna-produzione.sh [ramo-o-tag]     (senza argomento: REPO_RIFERIMENTO di CONFIG_SISTEMA)
# Log: /var/log/arenalive-aggiornamento.log

# --- variabili ---
CONFIG_SISTEMA="${CONFIG_SISTEMA:-/etc/arenalive/produzione.conf}"  # scritta da installa-produzione.sh
CARTELLA_INSTALLAZIONE="${CARTELLA_INSTALLAZIONE:-/opt/arenalive}"  # dove sta il codice (di norma da CONFIG_SISTEMA)
UTENTE_SERVIZIO="${UTENTE_SERVIZIO:-arenalive}"                              # proprietario del codice (di norma da CONFIG_SISTEMA)
REPO_RIFERIMENTO="${REPO_RIFERIMENTO:-main}"                           # ramo o tag da installare (di norma da CONFIG_SISTEMA)
CHIAVE_DEPLOY_EFFETTIVA="${CHIAVE_DEPLOY_EFFETTIVA:-}"                 # chiave SSH di deploy dell'utente di servizio (di norma da CONFIG_SISTEMA)
ATTESA_SALUTE_SECONDI="${ATTESA_SALUTE_SECONDI:-300}"                  # tempo massimo di attesa per server e web «healthy»
LOG="/var/log/arenalive-aggiornamento.log"                          # registro degli aggiornamenti

# --- codice ---
set -Eeuo pipefail
trap 'echo "ERRORE: aggiornamento interrotto alla riga $LINENO ($BASH_COMMAND). Dettagli in $LOG" >&2' ERR

compose() { docker compose "$@"; }

git_utente() {
    if [[ -n "$CHIAVE_DEPLOY_EFFETTIVA" ]]; then
        local home="/var/lib/$UTENTE_SERVIZIO"
        runuser -u "$UTENTE_SERVIZIO" -- env "GIT_SSH_COMMAND=ssh -i $CHIAVE_DEPLOY_EFFETTIVA -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$home/.ssh/known_hosts -o BatchMode=yes" git "$@"
    else
        runuser -u "$UTENTE_SERVIZIO" -- git "$@"
    fi
}

# Commit di un ramo (origin/<nome>) o di un tag; fallisce se non esiste.
risolvi_riferimento() {
    local rif=$1
    git_utente rev-parse -q --verify "refs/remotes/origin/$rif^{commit}" 2>/dev/null \
        || git_utente rev-parse -q --verify "refs/tags/$rif^{commit}" 2>/dev/null \
        || { echo "ERRORE: ramo o tag '$rif' inesistente" >&2; return 1; }
}

stack_attivo() { [[ -n "$(compose ps -q --status running postgres 2>/dev/null)" ]]; }

# server e web «healthy» e /api/health raggiungibile dalla rete interna (come arriverà da Caddy).
attendi_salute() {
    local fine=$((SECONDS + ATTESA_SALUTE_SECONDI)) s id stato tutti
    while (( SECONDS < fine )); do
        tutti=si
        for s in postgres server web; do
            id="$(compose ps -q "$s")"
            stato="$([[ -n "$id" ]] && docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null || echo assente)"
            [[ "$stato" == "healthy" ]] || tutti=no
        done
        if [[ $tutti == si ]] && compose exec -T web wget -q -O /dev/null http://127.0.0.1:8080/api/health; then return 0; fi
        sleep 5
    done
    return 1
}

# docker/Caddyfile è montato come singolo file: dopo il checkout il container vede ancora quello vecchio e
# `compose up` non lo ricrea. Se il contenuto è cambiato, Caddy si riavvia (certificati nel volume: nessuna nuova richiesta).
riallinea_caddy() {
    local nel_container
    nel_container="$(compose exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | sha256sum | cut -d' ' -f1)" || return 0
    if [[ "$nel_container" != "$(sha256sum docker/Caddyfile | cut -d' ' -f1)" ]]; then
        echo "    Caddyfile cambiato: riavvio Caddy"
        compose restart caddy
    fi
}

costruisci_e_avvia() {
    # Con && perché la funzione gira dentro un `if` (set -e sospeso): il primo errore deve fermare la catena.
    # ARENALIVE_COMMIT: commit corto mostrato con la versione (le build Docker non vedono .git; vuoto se non si legge).
    export ARENALIVE_COMMIT
    ARENALIVE_COMMIT="$(git_utente rev-parse --short HEAD 2>/dev/null || true)"
    compose pull --quiet caddy postgres && compose build --pull && compose up -d --remove-orphans && riallinea_caddy
}

principale() {
    [[ $EUID -eq 0 ]] || { echo "ERRORE: va eseguito come root" >&2; exit 1; }
    if [[ -r "$CONFIG_SISTEMA" ]]; then
        # shellcheck disable=SC1090
        . "$CONFIG_SISTEMA"
    fi
    local riferimento="${1:-$REPO_RIFERIMENTO}"
    [[ "$riferimento" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "ERRORE: riferimento non valido" >&2; exit 1; }
    touch "$LOG" && chmod 0600 "$LOG"
    exec > >(tee -a "$LOG") 2>&1
    echo "=== Aggiornamento a '$riferimento' del $(date '+%Y-%m-%d %H:%M:%S %z') ==="
    cd "$CARTELLA_INSTALLAZIONE"
    exec 8>/run/lock/arenalive-aggiorna.lock
    flock -n 8 || { echo "ERRORE: un altro aggiornamento è in corso" >&2; exit 1; }

    local precedente nuovo era_attivo=no
    precedente="$(git_utente rev-parse HEAD)"
    if stack_attivo; then
        era_attivo=si
        echo "1/5 Backup prima dell'aggiornamento"
        bash "$CARTELLA_INSTALLAZIONE/scripts/backup-produzione.sh" pre-aggiornamento
    else
        echo "1/5 Stack non in esecuzione (prima installazione): backup saltato"
    fi

    echo "2/5 Scarico il codice"
    git_utente fetch --quiet --tags --force --prune origin '+refs/heads/*:refs/remotes/origin/*'
    nuovo="$(risolvi_riferimento "$riferimento")"
    git_utente -c advice.detachedHead=false checkout --quiet --force --detach "$nuovo"
    echo "    versione: $(git_utente log -1 --format='%h %s' HEAD)"
    echo "    release: $(git_utente describe --tags --exact-match HEAD 2>/dev/null || echo 'nessun tag (ramo o commit)')"

    echo "3/5 Build e avvio (le migrazioni girano all'avvio del server)"
    if costruisci_e_avvia && echo "4/5 Verifica della salute" && attendi_salute; then
        # Libera il disco: immagini non più usate (le versioni precedenti) e cache di build più vecchia di 7 giorni.
        docker image prune -f >/dev/null || true
        docker builder prune -f --filter until=168h >/dev/null || true
        echo "5/5 Aggiornamento riuscito. Agente scaricabile dal portale:"
        # Non critico: un errore qui non annulla l'aggiornamento (il portale dice solo che l'agente non è pubblicato).
        bash "$CARTELLA_INSTALLAZIONE/scripts/pubblica-agente-produzione.sh" || echo "ATTENZIONE: agente non pubblicato (vedi sopra); riprova con scripts/pubblica-agente-produzione.sh --forza" >&2
        return 0
    fi

    echo "ERRORE: la nuova versione non è sana. Ultimi log del server:" >&2
    compose logs --tail 40 server >&2 || true
    if [[ $era_attivo == si && "$precedente" != "$nuovo" ]]; then
        echo "Torno alla versione precedente ($precedente)." >&2
        git_utente -c advice.detachedHead=false checkout --quiet --force --detach "$precedente"
        costruisci_e_avvia || true
        if attendi_salute; then
            echo "Ripristinata la versione precedente. Il backup 'pre-aggiornamento' è in cartella backup." >&2
        else
            echo "ERRORE GRAVE: anche la versione precedente non è sana. Ripristina dal backup (docs/infrastruttura.md)." >&2
        fi
        # Le migrazioni del database non si annullano da sole: se la nuova versione ne aveva applicate, controllare i log.
    fi
    return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    principale "$@"
    exit $?
fi
