#!/usr/bin/env bash
# Ripristina in una nuova installazione di ArenaLive (installa-produzione.sh già eseguito) i dati della vecchia
# produzione: dump del database (pg_dump -Fc, anche di un database con altro nome e altro utente, es. «sir») e archivio
# del volume delle immagini; riporta i segreti che servono ai dati (codici brevi dei QR, password della posta) dal
# vecchio .env e cambia gli hostname dei clienti salvati nel database (es. sir.istante.info -> sir.arenalive.studio).
# Le migrazioni del database girano all'avvio del server. Prima di sovrascrivere fa un backup della nuova installazione.
#
# Uso (come root, sul server nuovo): compila il blocco «variabili», poi  sudo bash scripts/ripristina-produzione.sh
# Log: /var/log/arenalive-ripristino.log

# --- variabili (le uniche da modificare; ogni "<…>" va sostituito) ---
DUMP_DATABASE="<percorso del dump della vecchia produzione, es. /root/vecchia/sir-db-20261020-030000.dump>"
ARCHIVIO_IMMAGINI="<percorso dell'archivio del vecchio volume delle immagini, es. /root/vecchia/sir-assets-20261020-030000.tar.gz>"
ENV_VECCHIO="<percorso del .env della vecchia produzione (backup «sir-env-…»): ne prendo solo i segreti dei dati; vuoto = non li riporto>"
HOSTNAME_DA_CAMBIARE="rt.istante.info=admin.arenalive.studio sir.istante.info=sir.arenalive.studio"  # coppie vecchio=nuovo separate da spazio (hostname salvati nei clienti); vuoto = nessun cambio
SEGRETI_DA_RIPORTARE="SHARE_CODE_SECRET SETTINGS_ENCRYPTION_KEY"  # chiavi del vecchio .env da copiare nel nuovo: senza, i QR stampati e la password della posta non funzionano più
CONFERMA="no"                                      # «si» = sovrascrivo davvero database e immagini della nuova installazione
CONFIG_SISTEMA="/etc/arenalive/produzione.conf"    # scritta da installa-produzione.sh (cartella di installazione)
CARTELLA_INSTALLAZIONE="/opt/arenalive"            # dove sta il codice con il .env (di norma da CONFIG_SISTEMA)
NOME_PROGETTO="arenalive"                          # progetto docker compose: volume delle immagini «<nome>_assets»
ATTESA_SALUTE_SECONDI="300"                        # tempo massimo di attesa per server e web «healthy» dopo il ripristino
LOG="/var/log/arenalive-ripristino.log"            # registro di questo ripristino

# --- codice ---
set -Eeuo pipefail
trap 'echo "ERRORE: ripristino interrotto alla riga $LINENO ($BASH_COMMAND). Dettagli in $LOG" >&2' ERR

fallisci() { printf 'ERRORE: %s\n' "$*" >&2; exit 1; }
compose() { docker compose "$@"; }
hostname_valido() { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$ ]]; }
nome_sql_valido() { [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; }
env_leggi() { local f=$1 k=$2; { grep -E "^${k}=" "$f" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-; }
env_forza() {
    local f=$1 k=$2 v=$3 tmp
    tmp="$(mktemp "${f}.XXXXXX")"
    { grep -vE "^${k}=" "$f" || true; } >"$tmp"
    printf '%s=%s\n' "$k" "$v" >>"$tmp"
    cat "$tmp" >"$f"
    rm -f "$tmp"
}

controlla() {
    [[ $EUID -eq 0 ]] || fallisci "va eseguito come root"
    [[ "$CONFERMA" == "si" ]] || fallisci "imposta CONFERMA=\"si\": il ripristino sostituisce database e immagini della nuova installazione"
    [[ -f "$DUMP_DATABASE" && -r "$DUMP_DATABASE" ]] || fallisci "dump del database non trovato: $DUMP_DATABASE"
    [[ -f "$ARCHIVIO_IMMAGINI" && -r "$ARCHIVIO_IMMAGINI" ]] || fallisci "archivio delle immagini non trovato: $ARCHIVIO_IMMAGINI"
    [[ -z "$ENV_VECCHIO" || -r "$ENV_VECCHIO" ]] || fallisci "vecchio .env non leggibile: $ENV_VECCHIO"
    tar -tzf "$ARCHIVIO_IMMAGINI" >/dev/null || fallisci "l'archivio delle immagini non è un tar.gz valido"
    local coppia
    for coppia in $HOSTNAME_DA_CAMBIARE; do
        [[ "$coppia" == *=* ]] || fallisci "HOSTNAME_DA_CAMBIARE: «$coppia» non è nella forma vecchio=nuovo"
        hostname_valido "${coppia%%=*}" && hostname_valido "${coppia#*=}" || fallisci "HOSTNAME_DA_CAMBIARE: hostname non valido in «$coppia»"
    done
    [[ -f "$CARTELLA_INSTALLAZIONE/.env" ]] || fallisci "manca $CARTELLA_INSTALLAZIONE/.env: prima esegui installa-produzione.sh"
}

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

principale() {
    if [[ -r "$CONFIG_SISTEMA" ]]; then
        # shellcheck disable=SC1090
        . "$CONFIG_SISTEMA"
    fi
    controlla
    touch "$LOG" && chmod 0600 "$LOG"
    exec > >(tee -a "$LOG") 2>&1
    echo "=== Ripristino del $(date '+%Y-%m-%d %H:%M:%S %z') ==="
    cd "$CARTELLA_INSTALLAZIONE"
    local utente db volume immagine_pg ts
    utente="$(env_leggi .env POSTGRES_USER)"; utente="${utente:-arenalive}"
    db="$(env_leggi .env POSTGRES_DB)"; db="${db:-arenalive}"
    nome_sql_valido "$utente" && nome_sql_valido "$db" || fallisci "POSTGRES_USER o POSTGRES_DB del .env non validi"
    volume="${NOME_PROGETTO}_assets"
    ts="$(date +%Y%m%d-%H%M%S)"

    echo "1/7 Database avviato e backup della nuova installazione (prima di sovrascriverla)"
    compose up -d postgres
    local i
    for i in $(seq 1 60); do compose exec -T postgres pg_isready -U "$utente" -d postgres >/dev/null 2>&1 && break; sleep 2; done
    compose exec -T postgres pg_isready -U "$utente" -d postgres >/dev/null || fallisci "postgres non risponde"
    compose exec -T postgres pg_restore -l <"$DUMP_DATABASE" >/dev/null || fallisci "il dump non è leggibile da pg_restore (serve pg_dump -Fc)"
    if docker volume inspect "$volume" >/dev/null 2>&1; then  # basta postgres avviato, come in backup-produzione.sh
        bash "$CARTELLA_INSTALLAZIONE/scripts/backup-produzione.sh" pre-ripristino
    else
        echo "    stack mai avviato: niente da salvare"
    fi

    echo "2/7 Fermo server, portale e proxy (resta solo il database)"
    compose stop caddy web server 2>/dev/null || compose stop web server

    echo "3/7 Database: ricreo «$db» e ripristino il dump (senza proprietari né permessi del vecchio utente)"
    compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$utente" -d postgres \
        -v db="$db" -v utente="$utente" <<'SQL'
DROP DATABASE IF EXISTS :"db" WITH (FORCE);
CREATE DATABASE :"db" OWNER :"utente";
SQL
    compose exec -T postgres pg_restore --no-owner --no-privileges --exit-on-error --single-transaction \
        -U "$utente" -d "$db" <"$DUMP_DATABASE"

    echo "4/7 Hostname dei clienti"
    local coppia vecchio nuovo
    for coppia in $HOSTNAME_DA_CAMBIARE; do
        vecchio="${coppia%%=*}"
        nuovo="${coppia#*=}"
        compose exec -T postgres psql -v ON_ERROR_STOP=1 -q -U "$utente" -d "$db" \
            -v vecchio="$vecchio" -v nuovo="$nuovo" <<'SQL'
UPDATE tenants SET hostnames = array_replace(hostnames, :'vecchio', :'nuovo') WHERE :'vecchio' = ANY (hostnames);
SQL
        echo "    $vecchio -> $nuovo"
    done
    compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$utente" -d "$db" \
        -c "SELECT slug, name, array_to_string(hostnames, ' ') AS hostname FROM tenants ORDER BY slug;"

    echo "5/7 Immagini: sostituisco il contenuto del volume $volume"
    docker volume create "$volume" >/dev/null
    immagine_pg="$(docker inspect -f '{{.Config.Image}}' "$(compose ps -q postgres)")"
    docker run --rm --entrypoint sh -v "$volume:/dati" -v "$(dirname "$(realpath "$ARCHIVIO_IMMAGINI")"):/vecchio:ro" \
        "$immagine_pg" -c 'set -e; proprietario="$(stat -c %u:%g /dati)"; find /dati -mindepth 1 -delete; tar -xzf "/vecchio/$1" -C /dati; chown -R "$proprietario" /dati' \
        ripristino "$(basename "$ARCHIVIO_IMMAGINI")"

    echo "6/7 Segreti dei dati dal vecchio .env"
    if [[ -n "$ENV_VECCHIO" ]]; then
        cp -a .env ".env.pre-ripristino-$ts"
        local chiave valore
        for chiave in $SEGRETI_DA_RIPORTARE; do
            valore="$(env_leggi "$ENV_VECCHIO" "$chiave")"
            if [[ -n "$valore" ]]; then
                env_forza .env "$chiave" "$valore"
                echo "    $chiave riportata"
            else
                echo "    $chiave assente nel vecchio .env: resta quella nuova"
            fi
        done
        echo "    copia del .env di prima: $CARTELLA_INSTALLAZIONE/.env.pre-ripristino-$ts"
    else
        echo "    ENV_VECCHIO vuoto: segreti non riportati (i QR stampati e la password della posta vanno rifatti)"
    fi

    echo "7/7 Avvio (le migrazioni girano all'avvio del server) e verifica di /api/health"
    compose up -d
    if attendi_salute; then
        echo "Ripristino riuscito. Controlla dal browser il portale e i link dei clienti."
        return 0
    fi
    echo "ERRORE: dopo il ripristino lo stack non è sano. Ultimi log del server:" >&2
    compose logs --tail 60 server >&2 || true
    return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    principale "$@"
    exit $?
fi
