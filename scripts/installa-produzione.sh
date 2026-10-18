#!/usr/bin/env bash
# Installa SIRRealtime in produzione su un Ubuntu Server 24.04 o 26.04 LTS minimale (anche «minimized»), come root.
# Idempotente: si può rilanciare per riallineare sistema e configurazione; chiama scripts/aggiorna-produzione.sh per
# backup, build, avvio e verifica. Non sovrascrive mai un .env esistente (aggiunge solo le variabili mancanti).
#
# Uso:  1) copia questo file sul server, 2) compila il blocco «variabili» qui sotto, 3) sudo bash installa-produzione.sh
# Log: /var/log/sir-realtime-installazione.log

# --- variabili (le uniche da modificare; ogni "<…>" va sostituito) ---
CERTIFICATI="interno"                              # «interno» = certificato firmato da una CA locale di Caddy (radice generata sul server; da installare sui PC): per hostname non pubblici, es. realtime.local risolti dal file hosts. «letsencrypt» = certificato pubblico (serve DNS pubblico e porte 80/443 raggiungibili). Si passa da uno all'altro rilanciando lo script
DOMINIO_PORTALE="<dominio del portale, es. portale.example.org: con «letsencrypt» il record DNS A/AAAA deve puntare a questo server; con «interno» può essere un nome privato come realtime.local>"
ALTRI_HOSTNAME=""                                  # altri hostname dei clienti separati da spazio (stessi requisiti DNS); si aggiungono rilanciando lo script
EMAIL_LETSENCRYPT="<email per gli avvisi di scadenza di Let's Encrypt; con «interno» può restare vuota>"
ADMIN_EMAIL="<email del superadmin iniziale>"
ADMIN_PASSWORD=""                                  # vuota = generata e mostrata una sola volta; altrimenti almeno 12 caratteri tra lettere, cifre e @ % + = . , : ! _ -
REPO_URL="git@github.com:lucagammelli/SIRRealttime.git"  # GitHub, pulsante «Code»: indirizzo SSH (repo privato) o https (repo pubblico)
REPO_RIFERIMENTO="main"                            # ramo o tag da installare (GitHub, «Branches» / «Tags»)
CHIAVE_DEPLOY=""                                   # percorso di una chiave privata SSH di deploy già pronta sul server; vuoto = ne creo una io e ti mostro la parte pubblica da inserire su GitHub (Settings > Deploy keys, sola lettura)
HOSTKEY_GITHUB_SHA256="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"  # impronta ed25519 del server git, da docs.github.com «GitHub's SSH key fingerprints» (controllala); vuota con repo https
CARTELLA_INSTALLAZIONE="/opt/sir-realtime"         # dove sta il codice (e il file .env di produzione)
CARTELLA_BACKUP="/var/backups/sir-realtime"        # dove finiscono i backup giornalieri (database, immagini, .env)
BACKUP_DA_TENERE="14"                              # quanti backup di ogni tipo conservare (i più vecchi vengono cancellati)
FUSO_ORARIO="Europe/Rome"                          # elenco: timedatectl list-timezones
PORTA_SSH="22"                                     # porta su cui ascolta sshd (ss -tlnp | grep sshd): resta aperta nel firewall
UTENTE_SERVIZIO="sir"                              # utente di sistema senza login, proprietario di codice e chiave di deploy
SPAZIO_MIN_GB="20"                                 # spazio libero minimo su /var/lib e su / (immagini Docker, database, build dell'agente: ~5 GB temporanei)
MEMORIA_MIN_MB="1800"                              # RAM + swap minimi: la build del portale ne usa circa 1,5 GB
DOCKER_GPG_FPR="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"  # impronta della chiave apt di Docker, da docs.docker.com/engine/install/ubuntu
CONFIG_SISTEMA="/etc/sir-realtime/produzione.conf" # impostazioni non segrete lette da aggiorna-produzione.sh, backup e systemd
LOG="/var/log/sir-realtime-installazione.log"      # registro di questa installazione

# --- codice ---
set -Eeuo pipefail

stampa() { printf '\n==> %s\n' "$*"; }
avviso() { printf 'ATTENZIONE: %s\n' "$*" >&2; }
fallisci() { printf 'ERRORE: %s\n' "$*" >&2; exit 1; }

# Un'uscita anomala dice dove e come guardare il registro (nessun segreto nel messaggio).
su_errore() {
    local codice=$? riga=$1 comando=$2
    printf '\nERRORE: installazione interrotta alla riga %s (comando: %s, codice %s).\n' "$riga" "$comando" "$codice" >&2
    printf 'Dettagli in %s. Risolto il problema puoi rilanciare lo script: riparte senza rifare ciò che è già fatto.\n' "$LOG" >&2
}

hostname_valido() { [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]]; }
# Con CERTIFICATI=interno bastano nomi privati (anche a una sola etichetta, es. realtime); mai indirizzi IP.
hostname_valido_interno() { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$ && ! "$1" =~ ^[0-9.]+$ ]]; }
hostname_ammesso() { if [[ "$CERTIFICATI" == "interno" ]]; then hostname_valido_interno "$1"; else hostname_valido "$1"; fi; }
email_valida() { [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; }
percorso_valido() { [[ "$1" =~ ^/[A-Za-z0-9._/-]+$ && "$1" != *..* ]]; }
password_valida() { [[ "$1" =~ ^[A-Za-z0-9@%+=.,:!_-]{12,}$ ]]; }

# Valore di KEY in un file KEY=valore (ultima occorrenza); vuoto se manca.
env_leggi() { local f=$1 k=$2; { grep -E "^${k}=" "$f" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-; }

# Imposta KEY=valore sostituendo ogni riga precedente (solo per le chiavi che governa questo script).
env_forza() {
    local f=$1 k=$2 v=$3 tmp
    tmp="$(mktemp "${f}.XXXXXX")"
    { grep -vE "^${k}=" "$f" || true; } >"$tmp"
    printf '%s=%s\n' "$k" "$v" >>"$tmp"
    cat "$tmp" >"$f"   # stesso file (permessi e proprietario restano)
    rm -f "$tmp"
}

# Imposta KEY=valore solo se la chiave manca o è vuota: un valore esistente non si tocca mai.
env_se_manca() {
    local f=$1 k=$2 v=$3
    [[ -n "$(env_leggi "$f" "$k")" ]] || env_forza "$f" "$k" "$v"
}

# Segreti casuali dal kernel (openssl rand usa /dev/urandom).
segreto_hex() { openssl rand -hex "$1"; }
segreto_base64() { openssl rand -base64 "$1" | tr -d '\n'; }
password_casuale() { openssl rand -base64 36 | tr -d '/+=\n' | cut -c1-24; }

controlla_variabili() {
    local v
    [[ "$CERTIFICATI" == "interno" || "$CERTIFICATI" == "letsencrypt" ]] || fallisci "CERTIFICATI deve essere «interno» o «letsencrypt»."
    for v in DOMINIO_PORTALE ADMIN_EMAIL; do
        [[ "${!v}" != *"<"* ]] || fallisci "Compila la variabile $v in cima allo script."
    done
    if [[ "$CERTIFICATI" == "interno" && "$EMAIL_LETSENCRYPT" == *"<"* ]]; then EMAIL_LETSENCRYPT=""; fi
    [[ "$EMAIL_LETSENCRYPT" != *"<"* ]] || fallisci "Compila la variabile EMAIL_LETSENCRYPT in cima allo script."
    DOMINIO_PORTALE="${DOMINIO_PORTALE,,}"
    hostname_ammesso "$DOMINIO_PORTALE" || fallisci "DOMINIO_PORTALE non è un nome valido (niente indirizzi IP né https://)."
    HOSTNAMES=("$DOMINIO_PORTALE")
    local h
    for h in ${ALTRI_HOSTNAME,,}; do
        hostname_ammesso "$h" || fallisci "ALTRI_HOSTNAME contiene un nome non valido: $h"
        [[ "$h" == "$DOMINIO_PORTALE" ]] || HOSTNAMES+=("$h")
    done
    if [[ "$CERTIFICATI" == "letsencrypt" || -n "$EMAIL_LETSENCRYPT" ]]; then
        email_valida "$EMAIL_LETSENCRYPT" || fallisci "EMAIL_LETSENCRYPT non valida."
    fi
    email_valida "$ADMIN_EMAIL" || fallisci "ADMIN_EMAIL non valida."
    if [[ -n "$ADMIN_PASSWORD" ]]; then
        password_valida "$ADMIN_PASSWORD" || fallisci "ADMIN_PASSWORD: almeno 12 caratteri tra lettere, cifre e @ % + = . , : ! _ -"
    fi
    for v in CARTELLA_INSTALLAZIONE CARTELLA_BACKUP CONFIG_SISTEMA LOG; do
        percorso_valido "${!v}" || fallisci "$v deve essere un percorso assoluto semplice (lettere, cifre, . _ - /)."
    done
    [[ -z "$CHIAVE_DEPLOY" ]] || percorso_valido "$CHIAVE_DEPLOY" || fallisci "CHIAVE_DEPLOY non è un percorso valido."
    [[ "$REPO_URL" =~ ^[A-Za-z0-9@:/._~-]+$ ]] || fallisci "REPO_URL contiene caratteri non ammessi."
    [[ "$REPO_RIFERIMENTO" =~ ^[A-Za-z0-9._/-]+$ ]] || fallisci "REPO_RIFERIMENTO contiene caratteri non ammessi."
    [[ "$BACKUP_DA_TENERE" =~ ^[0-9]+$ && "$BACKUP_DA_TENERE" -ge 1 ]] || fallisci "BACKUP_DA_TENERE deve essere un intero >= 1."
    [[ "$PORTA_SSH" =~ ^[0-9]+$ && "$PORTA_SSH" -ge 1 && "$PORTA_SSH" -le 65535 ]] || fallisci "PORTA_SSH non valida."
    [[ "$UTENTE_SERVIZIO" =~ ^[a-z][a-z0-9_-]{0,30}$ ]] || fallisci "UTENTE_SERVIZIO non valido."
}

controlla_sistema() {
    stampa "Controllo del sistema"
    [[ $EUID -eq 0 ]] || fallisci "Va eseguito come root (sudo bash $0)."
    [[ -r /etc/os-release ]] || fallisci "/etc/os-release non leggibile."
    # shellcheck disable=SC1091
    . /etc/os-release
    [[ "${ID:-}" == "ubuntu" && ( "${VERSION_ID:-}" == "24.04" || "${VERSION_ID:-}" == "26.04" ) ]] || fallisci "Serve Ubuntu Server 24.04 o 26.04 LTS (trovato: ${PRETTY_NAME:-sconosciuto})."
    # Suite del repository apt di Docker = nome in codice della release (noble per 24.04, resolute per 26.04).
    CODENAME="${VERSION_CODENAME:-}"
    if [[ -z "$CODENAME" ]]; then
        case "$VERSION_ID" in 24.04) CODENAME=noble ;; 26.04) CODENAME=resolute ;; *) CODENAME="" ;; esac
    fi
    [[ "$CODENAME" =~ ^[a-z]+$ ]] || fallisci "Nome in codice di Ubuntu non determinabile."
    case "$(uname -m)" in
        x86_64 | aarch64) ;;
        *) fallisci "Architettura non supportata: $(uname -m) (ammesse x86_64 e aarch64)." ;;
    esac
    [[ -d /run/systemd/system ]] || fallisci "systemd non è in esecuzione: serve per avvio automatico e backup."
    local libero_gb mem_mb swap_mb
    libero_gb="$(df --output=avail -BG /var/lib | tail -n 1 | tr -dc '0-9')"
    (( libero_gb >= SPAZIO_MIN_GB )) || fallisci "Spazio libero su /var/lib: ${libero_gb} GB, ne servono almeno $SPAZIO_MIN_GB."
    mem_mb="$(awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo)"
    swap_mb="$(awk '/^SwapTotal:/ {print int($2/1024)}' /proc/meminfo)"
    (( mem_mb + swap_mb >= MEMORIA_MIN_MB )) || fallisci "RAM+swap: $((mem_mb + swap_mb)) MB, ne servono almeno $MEMORIA_MIN_MB (aggiungi un file di swap)."
    if dpkg -s docker.io >/dev/null 2>&1; then
        fallisci "È installato il pacchetto Ubuntu docker.io: rimuovilo (apt-get remove docker.io) prima di installare Docker ufficiale."
    fi
    # Porta SSH: se sbagliata, il firewall ti chiuderebbe fuori dal server.
    ss -ltnH "sport = :$PORTA_SSH" | grep -q . || fallisci "Nessun servizio ascolta sulla porta $PORTA_SSH: correggi PORTA_SSH prima di attivare il firewall."
    local h
    for h in "${HOSTNAMES[@]}"; do
        if ! getent ahostsv4 "$h" >/dev/null 2>&1; then
            if [[ "$CERTIFICATI" == "interno" ]]; then
                echo "Nota: $h non ha un record DNS su questo server; va bene con certificato interno, ma i PC devono risolverlo (file hosts o DNS)."
            else
                avviso "$h non ha ancora un record DNS: Let's Encrypt non potrà emettere il certificato finché non punta a questo server."
            fi
        fi
    done
    echo "Sistema ok: Ubuntu $VERSION_ID, $(uname -m), ${libero_gb} GB liberi, RAM ${mem_mb} MB + swap ${swap_mb} MB."
}

installa_pacchetti() {
    stampa "Pacchetti di base"
    export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
    apt-get update -q
    apt-get install -y -q --no-install-recommends ca-certificates curl gnupg git openssh-client ufw unattended-upgrades tzdata openssl util-linux jq
    # Aggiornamenti di sicurezza automatici (senza riavvio automatico del server).
    cat >/etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
    systemctl enable --now unattended-upgrades.service >/dev/null
}

# IPv6 affidabile per i client: con ip6tables attivo e senza userland-proxy Docker inoltra le connessioni IPv6 con
# l'indirizzo vero del client (altrimenti arriverebbero tutte dal gateway della rete). Unisce le chiavi a un
# eventuale daemon.json esistente e riavvia Docker solo se il file cambia.
configura_daemon_docker() {
    local f=/etc/docker/daemon.json nuovo
    install -d -m 0755 /etc/docker
    [[ -s "$f" ]] || echo '{}' >"$f"
    nuovo="$(mktemp)"
    jq '. + {"ip6tables": true, "userland-proxy": false}' "$f" >"$nuovo" || { rm -f "$nuovo"; fallisci "$f non è un JSON valido."; }
    if ! cmp -s "$f" "$nuovo"; then
        cp -a "$f" "$f.sir-bak" 2>/dev/null || true
        cat "$nuovo" >"$f"
        DOCKER_DA_RIAVVIARE=si
    fi
    rm -f "$nuovo"
}

installa_docker() {
    stampa "Docker Engine (repository ufficiale)"
    install -m 0755 -d /etc/apt/keyrings
    local chiave_tmp
    chiave_tmp="$(mktemp)"
    curl -fsSL --proto '=https' --tlsv1.2 https://download.docker.com/linux/ubuntu/gpg -o "$chiave_tmp"
    local fpr
    fpr="$(gpg --show-keys --with-colons "$chiave_tmp" | awk -F: '$1 == "fpr" {print $10; exit}')"
    [[ "$fpr" == "$DOCKER_GPG_FPR" ]] || { rm -f "$chiave_tmp"; fallisci "Impronta della chiave Docker inattesa ($fpr): non la installo."; }
    install -m 0644 "$chiave_tmp" /etc/apt/keyrings/docker.asc
    rm -f "$chiave_tmp"
    # La suite di questa release deve esistere nel repository Docker: altrimenti ci si ferma con un messaggio chiaro
    # (niente ripiego silenzioso su un'altra suite).
    curl -fsSI --proto '=https' --tlsv1.2 "https://download.docker.com/linux/ubuntu/dists/$CODENAME/Release" >/dev/null \
        || fallisci "Il repository Docker non ha ancora la suite «$CODENAME» per questa versione di Ubuntu."
    cat >/etc/apt/sources.list.d/docker.sources <<DOCKERAPT
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
DOCKERAPT
    apt-get update -q
    apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    configura_daemon_docker
    systemctl enable --now docker.service containerd.service >/dev/null
    if [[ "${DOCKER_DA_RIAVVIARE:-no}" == "si" ]]; then systemctl restart docker.service; fi
    docker compose version >/dev/null || fallisci "Il plugin docker compose non risponde."
}

crea_utente() {
    stampa "Utente di servizio"
    if ! id -u "$UTENTE_SERVIZIO" >/dev/null 2>&1; then
        adduser --system --group --home "/var/lib/$UTENTE_SERVIZIO" --shell /usr/sbin/nologin --disabled-password "$UTENTE_SERVIZIO" >/dev/null
    fi
    # Non entra nel gruppo docker (equivarrebbe a root): docker lo usa solo root, da systemd.
    install -d -o "$UTENTE_SERVIZIO" -g "$UTENTE_SERVIZIO" -m 0700 "/var/lib/$UTENTE_SERVIZIO/.ssh"
}

configura_firewall() {
    stampa "Firewall (ufw)"
    ufw default deny incoming >/dev/null
    ufw default allow outgoing >/dev/null
    ufw limit "${PORTA_SSH}/tcp" >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
    ufw --force enable >/dev/null
    # Docker scavalca ufw per le porte che pubblica: nel compose di produzione sono solo 80 e 443 (Caddy).
    ufw status | sed -n '1,12p'
}

configura_fuso_orario() {
    stampa "Fuso orario"
    [[ -e "/usr/share/zoneinfo/$FUSO_ORARIO" ]] || fallisci "Fuso orario sconosciuto: $FUSO_ORARIO"
    timedatectl set-timezone "$FUSO_ORARIO"
}

# Comandi git/ssh come utente di servizio, con la chiave di deploy e un known_hosts verificato.
CHIAVE_EFFETTIVA=""
prepara_accesso_git() {
    [[ "$REPO_URL" =~ ^(git@|ssh://) ]] || return 0
    stampa "Accesso al repository (chiave di deploy)"
    local home="/var/lib/$UTENTE_SERVIZIO" host
    host="$(printf '%s' "$REPO_URL" | sed -E 's#^ssh://([^@/]+@)?##; s#^[^@]+@##; s#[:/].*$##')"
    [[ -n "$HOSTKEY_GITHUB_SHA256" ]] || fallisci "HOSTKEY_GITHUB_SHA256 è obbligatoria con un repository SSH."
    CHIAVE_EFFETTIVA="$home/.ssh/id_ed25519_deploy"
    if [[ -n "$CHIAVE_DEPLOY" ]]; then
        [[ -r "$CHIAVE_DEPLOY" ]] || fallisci "CHIAVE_DEPLOY non leggibile: $CHIAVE_DEPLOY"
        install -o "$UTENTE_SERVIZIO" -g "$UTENTE_SERVIZIO" -m 0600 "$CHIAVE_DEPLOY" "$CHIAVE_EFFETTIVA"
        # La parte pubblica serve per il messaggio «aggiungi questa chiave su GitHub»: si ricava dalla privata.
        runuser -u "$UTENTE_SERVIZIO" -- ssh-keygen -y -f "$CHIAVE_EFFETTIVA" </dev/null >"$CHIAVE_EFFETTIVA.pub" \
            || fallisci "Non riesco a leggere la chiave $CHIAVE_DEPLOY (protetta da passphrase? Serve una chiave senza)."
        chown "$UTENTE_SERVIZIO:$UTENTE_SERVIZIO" "$CHIAVE_EFFETTIVA.pub"
    elif [[ ! -f "$CHIAVE_EFFETTIVA" ]]; then
        runuser -u "$UTENTE_SERVIZIO" -- ssh-keygen -q -t ed25519 -N '' -C "sir-realtime-deploy@$(hostname -s)" -f "$CHIAVE_EFFETTIVA"
    fi
    # known_hosts: la chiave del server git deve avere l'impronta indicata nelle variabili.
    # Una sola scansione: l'impronta controllata e la chiave scritta in known_hosts sono la stessa.
    local chiave_host trovata
    chiave_host="$(ssh-keyscan -t ed25519 "$host" 2>/dev/null)"
    trovata="$(printf '%s\n' "$chiave_host" | ssh-keygen -lf - 2>/dev/null | awk '{print $2; exit}')"
    [[ "$trovata" == "$HOSTKEY_GITHUB_SHA256" ]] || fallisci "Impronta SSH di $host inattesa ('$trovata'): possibile intercettazione o HOSTKEY_GITHUB_SHA256 da aggiornare."
    printf '%s\n' "$chiave_host" >"$home/.ssh/known_hosts"
    chown "$UTENTE_SERVIZIO:$UTENTE_SERVIZIO" "$home/.ssh/known_hosts"
    chmod 0600 "$home/.ssh/known_hosts"
}

git_utente() {
    if [[ -n "$CHIAVE_EFFETTIVA" ]]; then
        local home="/var/lib/$UTENTE_SERVIZIO"
        runuser -u "$UTENTE_SERVIZIO" -- env "GIT_SSH_COMMAND=ssh -i $CHIAVE_EFFETTIVA -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$home/.ssh/known_hosts -o BatchMode=yes" git "$@"
    else
        runuser -u "$UTENTE_SERVIZIO" -- git "$@"
    fi
}

scarica_codice() {
    stampa "Codice"
    install -d -o "$UTENTE_SERVIZIO" -g "$UTENTE_SERVIZIO" -m 0755 "$CARTELLA_INSTALLAZIONE"
    if [[ -d "$CARTELLA_INSTALLAZIONE/.git" ]]; then
        echo "Codice già presente in $CARTELLA_INSTALLAZIONE: lo aggiorna aggiorna-produzione.sh."
        return 0
    fi
    if ! git_utente clone --quiet "$REPO_URL" "$CARTELLA_INSTALLAZIONE"; then
        if [[ -n "$CHIAVE_EFFETTIVA" ]]; then
            printf '\nNon riesco a leggere il repository. Aggiungi questa chiave su GitHub\n(repository > Settings > Deploy keys > Add deploy key, SOLA LETTURA) e rilancia lo script:\n\n%s\n\n' "$(cat "$CHIAVE_EFFETTIVA.pub")" >&2
        fi
        fallisci "Clone di $REPO_URL non riuscito."
    fi
}

scrivi_configurazione_sistema() {
    stampa "Impostazioni di sistema"
    install -d -m 0755 "$(dirname "$CONFIG_SISTEMA")"
    cat >"$CONFIG_SISTEMA" <<CONF
# Scritto da installa-produzione.sh (nessun segreto). Letto da aggiorna-produzione.sh, backup-produzione.sh e systemd.
CARTELLA_INSTALLAZIONE="$CARTELLA_INSTALLAZIONE"
CARTELLA_BACKUP="$CARTELLA_BACKUP"
BACKUP_DA_TENERE="$BACKUP_DA_TENERE"
UTENTE_SERVIZIO="$UTENTE_SERVIZIO"
REPO_RIFERIMENTO="$REPO_RIFERIMENTO"
CHIAVE_DEPLOY_EFFETTIVA="$CHIAVE_EFFETTIVA"
CONF
    chmod 0644 "$CONFIG_SISTEMA"
    install -d -m 0700 "$CARTELLA_BACKUP"
}

# Radice pubblica della CA interna di Caddy (solo certificato, mai la chiave): servita dal portale su /sirrealtime-ca.crt.
CARTELLA_CA_PUBBLICA="$(dirname "$CONFIG_SISTEMA")/ca-pubblica"
FILE_CA="$CARTELLA_CA_PUBBLICA/sirrealtime-ca.crt"
IMPRONTA_CA=""

# Crea .env solo se manca; altrimenti aggiunge soltanto le variabili mancanti o vuote.
MARCA_SUPERADMIN="$(dirname "$CONFIG_SISTEMA")/superadmin-mostrato"  # esiste dopo il primo riepilogo: il superadmin è stato creato e la password mostrata
prepara_env() {
    stampa "File .env di produzione"
    local f="$CARTELLA_INSTALLAZIONE/.env" nuovo=no
    if [[ ! -f "$f" ]]; then
        nuovo=yes
        (umask 077; printf '# SIRRealtime, produzione. Generato da installa-produzione.sh. Contiene segreti: non copiarlo né condividerlo.\n# Riferimento delle variabili: .env.example\n' >"$f")
    fi
    chmod 0600 "$f"
    chown "$UTENTE_SERVIZIO:$UTENTE_SERVIZIO" "$f"
    local url="https://$DOMINIO_PORTALE" lista
    lista="$(IFS=,; printf '%s' "${HOSTNAMES[*]}" | sed 's/,/, /g')"
    # Segreti e valori di sicurezza: solo se mancano.
    env_se_manca "$f" POSTGRES_DB sir
    env_se_manca "$f" POSTGRES_USER sir
    env_se_manca "$f" POSTGRES_PASSWORD "$(segreto_hex 24)"
    env_se_manca "$f" SHARE_CODE_SECRET "$(segreto_base64 48)"
    env_se_manca "$f" SETTINGS_ENCRYPTION_KEY "$(segreto_base64 32)"
    env_se_manca "$f" COOKIE_SECURE true
    env_se_manca "$f" LEAGUE_SYNC on
    env_se_manca "$f" LEAGUE_CONTACT "$url"
    env_se_manca "$f" TRUST_PROXY true
    env_se_manca "$f" LOG_LEVEL info
    env_se_manca "$f" SESSION_TTL_HOURS 12
    # Superadmin: credenziali nel .env solo alla prima installazione (il server lo crea finché non ne esiste uno).
    # Con la marca presente non si genera né si mostra nulla di nuovo.
    if [[ ! -e "$MARCA_SUPERADMIN" ]] && [[ -z "$(env_leggi "$f" ADMIN_EMAIL)" || -z "$(env_leggi "$f" ADMIN_PASSWORD)" ]]; then
        env_forza "$f" ADMIN_EMAIL "$ADMIN_EMAIL"
        env_forza "$f" ADMIN_PASSWORD "${ADMIN_PASSWORD:-$(password_casuale)}"
    fi
    # Impostazioni di distribuzione governate da questo script: si riallineano a ogni esecuzione.
    env_forza "$f" SIR_HOSTNAMES "\"$lista\""
    # Derivati da DOMINIO_PORTALE: si riallineano a ogni esecuzione (serve cambiando dominio o modalità).
    env_forza "$f" PUBLIC_BASE_URL "$url"
    env_forza "$f" CORS_ORIGIN "$url"
    env_forza "$f" SIR_TLS_MODE "$CERTIFICATI"
    env_forza "$f" ACME_EMAIL "$EMAIL_LETSENCRYPT"
    env_forza "$f" CA_PUBBLICA_DIR "$CARTELLA_CA_PUBBLICA"
    env_forza "$f" COMPOSE_PROJECT_NAME sir-realtime
    env_forza "$f" COMPOSE_FILE docker-compose.yml:docker/compose.produzione.yml
    # Agente per Windows offerto dal portale: cartella dell'host montata in sola lettura nel server (la riempie pubblica-agente-produzione.sh).
    env_se_manca "$f" AGENT_DOWNLOAD_HOST_DIR "/var/lib/$UTENTE_SERVIZIO/downloads"
    install -d -m 0755 "$(env_leggi "$f" AGENT_DOWNLOAD_HOST_DIR)"
    # Nessuna porta pubblicata da server e web (le toglie compose.produzione.yml): valori espliciti per chiarezza.
    install -d -m 0755 "$CARTELLA_CA_PUBBLICA"
    env_se_manca "$f" SERVER_BIND 127.0.0.1
    env_se_manca "$f" WEB_BIND 127.0.0.1
    echo ".env $([[ $nuovo == yes ]] && echo creato || echo verificato) (permessi 600, proprietario $UTENTE_SERVIZIO)."
}

controlla_porte_libere() {
    # Prima installazione: 80 e 443 devono essere libere (le occuperà Caddy). Se Caddy c'è già, va bene.
    docker ps --format '{{.Names}}' | grep -q '^sir-realtime-caddy-' && return 0
    local occupate
    occupate="$(ss -ltnpH '( sport = :80 or sport = :443 )' | grep -v docker-proxy || true)"
    [[ -z "$occupate" ]] || fallisci "Le porte 80/443 sono già usate da un altro servizio:
$occupate"
}

installa_servizi_systemd() {
    stampa "Servizi systemd (avvio automatico e backup giornaliero)"
    cat >/etc/systemd/system/sir-realtime.service <<UNIT
[Unit]
Description=SIRRealtime (stack docker compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$CARTELLA_INSTALLAZIONE
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose stop
TimeoutStartSec=600
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT
    cat >/etc/systemd/system/sir-backup.service <<UNIT
[Unit]
Description=Backup di SIRRealtime (database, immagini, .env)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
EnvironmentFile=$CONFIG_SISTEMA
ExecStart=/bin/bash $CARTELLA_INSTALLAZIONE/scripts/backup-produzione.sh
Nice=10
UNIT
    cat >/etc/systemd/system/sir-backup.timer <<UNIT
[Unit]
Description=Backup giornaliero di SIRRealtime

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
    systemctl daemon-reload
    systemctl enable sir-realtime.service >/dev/null
    systemctl enable --now sir-backup.timer >/dev/null
}

avvia_stack() {
    stampa "Backup, build, avvio e verifica (aggiorna-produzione.sh)"
    bash "$CARTELLA_INSTALLAZIONE/scripts/aggiorna-produzione.sh" "$REPO_RIFERIMENTO"
    systemctl start sir-realtime.service
}

# Con CERTIFICATI=interno copia la radice pubblica generata da Caddy (appare al primo certificato emesso).
esporta_radice_ca() {
    [[ "$CERTIFICATI" == "interno" ]] || { rm -f "$FILE_CA"; return 0; }
    stampa "Radice della CA interna"
    local tentativo tmp
    tmp="$(mktemp)"
    for tentativo in $(seq 1 24); do
        if (cd "$CARTELLA_INSTALLAZIONE" && docker compose exec -T caddy cat /data/caddy/pki/authorities/local/root.crt) >"$tmp" 2>/dev/null \
            && openssl x509 -in "$tmp" -noout >/dev/null 2>&1; then
            install -m 0644 "$tmp" "$FILE_CA"
            rm -f "$tmp"
            IMPRONTA_CA="$(openssl x509 -in "$FILE_CA" -noout -fingerprint -sha256 | cut -d= -f2)"
            echo "Radice esportata in $FILE_CA (SHA-256 $IMPRONTA_CA)."
            return 0
        fi
        sleep 5
    done
    rm -f "$tmp"
    avviso "Radice della CA non ancora disponibile: rilancia lo script tra poco (cd $CARTELLA_INSTALLAZIONE && docker compose logs caddy)."
}

verifica_https() {
    stampa "Verifica HTTPS"
    local h tentativo ok opzioni_ca=()
    if [[ "$CERTIFICATI" == "interno" ]]; then
        [[ -s "$FILE_CA" ]] || { avviso "Senza la radice della CA non posso verificare l'HTTPS."; return 0; }
        opzioni_ca=(--cacert "$FILE_CA")
    fi
    for h in "${HOSTNAMES[@]}"; do
        ok=no
        for tentativo in $(seq 1 18); do
            if curl -fsS --max-time 10 "${opzioni_ca[@]}" --resolve "$h:443:127.0.0.1" "https://$h/api/health" >/dev/null 2>&1; then ok=yes; break; fi
            sleep 5
        done
        if [[ $ok == yes ]]; then echo "https://$h risponde con un certificato valido$([[ "$CERTIFICATI" == "interno" ]] && echo ' (firmato dalla CA interna)')."
        else avviso "https://$h non risponde ancora: con letsencrypt: DNS non puntato a questo server o porte 80/443 non raggiungibili da Internet. Vedi: cd $CARTELLA_INSTALLAZIONE && docker compose logs caddy"; fi
    done
}

riepilogo() {
    cat <<RIEPILOGO

=====================================================================
 SIRRealtime è installato.
=====================================================================
 Portale:          https://$DOMINIO_PORTALE
 Area admin:       https://$DOMINIO_PORTALE/admin   (accesso: $ADMIN_EMAIL)
 Altri hostname:   ${ALTRI_HOSTNAME:-nessuno} (assegnali ai clienti dal portale)
 Codice e .env:    $CARTELLA_INSTALLAZIONE   (.env con i segreti: permessi 600, non condividerlo)
 Backup:           $CARTELLA_BACKUP   (ogni giorno alle 03:30, ne restano $BACKUP_DA_TENERE per tipo)
                   Contengono anche il .env: copiali ogni tanto FUORI da questo server.
 Impostazioni:     $CONFIG_SISTEMA
 Registro:         $LOG

 Aggiornare:       sudo $CARTELLA_INSTALLAZIONE/scripts/aggiorna-produzione.sh [ramo-o-tag]
                   (backup, build, avvio, verifica; se fallisce torna alla versione precedente)
 Backup a mano:    sudo systemctl start sir-backup.service
 Vedere i log:     cd $CARTELLA_INSTALLAZIONE && sudo docker compose logs -f --tail 100 server
                   (servizi: server, web, postgres, caddy)   Stato: sudo docker compose ps
 Riavviare:        sudo systemctl restart sir-realtime.service
 Firewall:         sudo ufw status   (aperte: SSH $PORTA_SSH, 80, 443)
RIEPILOGO
    if [[ "$CERTIFICATI" == "interno" ]]; then
        cat <<CA

 Certificato:      INTERNO (CA locale di Caddy). Browser e agente Windows lo accettano solo dopo aver installato la radice.
 Radice pubblica:  $FILE_CA   (scaricabile da https://$DOMINIO_PORTALE/sirrealtime-ca.crt)
 Impronta SHA-256: ${IMPRONTA_CA:-non ancora disponibile, rilancia lo script}
 Installazione:    sul PC Windows, PowerShell come amministratore, con lo script di docs/infrastruttura.md
                   («Radice della CA interna su Windows»): confronta l'impronta sopra con quella del file.
                   Chrome/Edge su Windows usano lo stesso archivio; sui telefoni va installata a mano o si accetta l'avviso.
                   Per passare a Let's Encrypt: CERTIFICATI="letsencrypt", EMAIL_LETSENCRYPT compilata, rilancia lo script.
CA
    fi
    if [[ -e "$MARCA_SUPERADMIN" ]]; then
        printf '\n Il superadmin esisteva già: nessuna nuova password. Per recuperare l'"'"'accesso vedi docs/infrastruttura.md.\n' >&3
    elif [[ -n "$ADMIN_PASSWORD" ]]; then
        printf '\n Superadmin creato con la password scelta nelle variabili (%s).\n' "$ADMIN_EMAIL" >&3
        touch "$MARCA_SUPERADMIN"
    else
        {
            printf '\n *** Password iniziale del superadmin (mostrata UNA SOLA VOLTA, non è nel registro) ***\n'
            printf '     email:    %s\n     password: %s\n' "$ADMIN_EMAIL" "$(env_leggi "$CARTELLA_INSTALLAZIONE/.env" ADMIN_PASSWORD)"
            printf ' Cambiala dopo il primo accesso. Resta anche nel .env (permessi 600).\n'
        } >&3
        touch "$MARCA_SUPERADMIN"
    fi
}

principale() {
    controlla_variabili
    exec 3>&1 4>&2
    touch "$LOG" && chmod 0600 "$LOG"
    exec > >(tee -a "$LOG") 2>&1
    trap 'su_errore "$LINENO" "$BASH_COMMAND"' ERR
    printf 'Installazione SIRRealtime del %s\n' "$(date '+%Y-%m-%d %H:%M:%S %z')"
    controlla_sistema
    installa_pacchetti
    installa_docker
    crea_utente
    configura_firewall
    configura_fuso_orario
    prepara_accesso_git
    scarica_codice
    scrivi_configurazione_sistema
    prepara_env
    controlla_porte_libere
    installa_servizi_systemd
    avvia_stack
    esporta_radice_ca
    verifica_https
    riepilogo
}

# Eseguito solo lanciando il file (con `source` si possono provare le funzioni pure).
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    principale
    exit 0
fi
