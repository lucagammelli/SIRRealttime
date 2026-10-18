#!/usr/bin/env bash
# Backup di SIRRealtime in produzione: dump del database (pg_dump), volume delle immagini e .env, con rotazione.
# Lo lancia ogni giorno il timer systemd sir-backup.timer; lo chiama anche aggiorna-produzione.sh prima di aggiornare.
# Uso (come root):  scripts/backup-produzione.sh [etichetta]     (etichetta opzionale nel nome dei file, es. pre-aggiornamento)
# Ripristino: docs/infrastruttura.md. Contiene segreti (.env): la cartella è 700 e i file 600, solo root.

# --- variabili ---
CONFIG_SISTEMA="${CONFIG_SISTEMA:-/etc/sir-realtime/produzione.conf}"  # scritta da installa-produzione.sh
CARTELLA_INSTALLAZIONE="${CARTELLA_INSTALLAZIONE:-/opt/sir-realtime}"  # dove sta il codice con .env (di norma da CONFIG_SISTEMA)
CARTELLA_BACKUP="${CARTELLA_BACKUP:-/var/backups/sir-realtime}"        # dove scrivere i backup (di norma da CONFIG_SISTEMA)
BACKUP_DA_TENERE="${BACKUP_DA_TENERE:-14}"                             # quanti file tenere per tipo (di norma da CONFIG_SISTEMA)
NOME_PROGETTO="${NOME_PROGETTO:-sir-realtime}"                           # nome fisso del progetto docker compose (volumi «<nome>_assets»)
ETICHETTA="${1:-}"                                                     # etichetta opzionale nel nome

# --- codice ---
set -Eeuo pipefail
trap 'echo "ERRORE: backup interrotto alla riga $LINENO ($BASH_COMMAND)" >&2' ERR

base=""
principale() {
    [[ $EUID -eq 0 ]] || { echo "ERRORE: va eseguito come root" >&2; exit 1; }
    if [[ -r "$CONFIG_SISTEMA" ]]; then
        # shellcheck disable=SC1090
        . "$CONFIG_SISTEMA"
    fi
    [[ "$ETICHETTA" =~ ^[A-Za-z0-9-]*$ ]] || { echo "ERRORE: etichetta non valida" >&2; exit 1; }
    [[ "$BACKUP_DA_TENERE" =~ ^[0-9]+$ && "$BACKUP_DA_TENERE" -ge 1 ]] || { echo "ERRORE: BACKUP_DA_TENERE non valido" >&2; exit 1; }
    exec 9>/run/lock/sir-backup.lock
    flock -n 9 || { echo "ERRORE: un altro backup è in corso" >&2; exit 1; }
    cd "$CARTELLA_INSTALLAZIONE"
    local utente db volume immagine_pg
    utente="$(grep -E '^POSTGRES_USER=' .env | tail -n 1 | cut -d= -f2-)"; utente="${utente:-sir}"
    db="$(grep -E '^POSTGRES_DB=' .env | tail -n 1 | cut -d= -f2-)"; db="${db:-sir}"
    docker compose exec -T postgres true || { echo "ERRORE: il servizio postgres non è in esecuzione" >&2; exit 1; }
    install -d -m 0700 "$CARTELLA_BACKUP"
    local ts
    ts="$(date +%Y%m%d-%H%M%S)"
    base="${ts}${ETICHETTA:+-$ETICHETTA}"
    umask 077
    trap 'rm -f "$CARTELLA_BACKUP/.sir-db-$base.tmp" "$CARTELLA_BACKUP/.sir-assets-$base.tmp"' EXIT   # niente file a metà se un passo fallisce

    # Database: formato custom (ripristino con pg_restore); scritto in un file temporaneo e verificato prima di rinominarlo.
    docker compose exec -T postgres pg_dump -U "$utente" -d "$db" -Fc >"$CARTELLA_BACKUP/.sir-db-$base.tmp"
    docker compose exec -T postgres pg_restore -l <"$CARTELLA_BACKUP/.sir-db-$base.tmp" >/dev/null
    mv "$CARTELLA_BACKUP/.sir-db-$base.tmp" "$CARTELLA_BACKUP/sir-db-$base.dump"

    # Immagini dei clienti (volume assets), con la stessa immagine di Postgres (già presente, nessun download).
    volume="${NOME_PROGETTO}_assets"
    immagine_pg="$(docker inspect -f '{{.Config.Image}}' "$(docker compose ps -q postgres)")"
    docker run --rm --entrypoint tar -v "$volume:/dati:ro" "$immagine_pg" -czf - -C /dati . >"$CARTELLA_BACKUP/.sir-assets-$base.tmp"
    mv "$CARTELLA_BACKUP/.sir-assets-$base.tmp" "$CARTELLA_BACKUP/sir-assets-$base.tar.gz"

    # .env: senza SETTINGS_ENCRYPTION_KEY e SHARE_CODE_SECRET un ripristino perde password di posta e QR stampati.
    install -m 0600 .env "$CARTELLA_BACKUP/sir-env-$base"

    ruota "sir-db-*.dump"
    ruota "sir-assets-*.tar.gz"
    ruota "sir-env-*"
    echo "Backup $base completato in $CARTELLA_BACKUP"
}

# Tiene i BACKUP_DA_TENERE file più recenti che corrispondono allo schema, cancella gli altri.
ruota() {
    local schema=$1 f
    # shellcheck disable=SC2012
    { ls -1t "$CARTELLA_BACKUP"/$schema 2>/dev/null || true; } | tail -n +"$((BACKUP_DA_TENERE + 1))" | while IFS= read -r f; do rm -f -- "$f"; done
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    principale
    exit 0
fi
