#!/usr/bin/env bash
# Scansione DAST con OWASP ZAP (Docker) del server ArenaLive (apps/server), docs/regole/sicurezza.md.
# Avvia il server di prova (PGlite in memoria, limiti alzati), crea l'utente di scansione e un token agente,
# esegue zap-api-scan.py con la specifica scripts/dast/openapi.yaml e termina con codice 1 se restano avvisi di
# rischio Alto o Medio non ignorati (regole motivate in scripts/dast/zap-regole.tsv).
# Non coperti: WebSocket (/ws/*) e portale web (header e CSP del portale li mette nginx, non il server di prova).
#
# Uso: scripts/dast_zap.sh        (da qualunque cartella; richiede docker, node, pnpm)
# Uscite: 0 pulito, 1 avvisi Alto/Medio, 2 errore di preparazione.

# --- variabili ---
PORTA="18090"                                                   # porta del server di prova
SUPER_EMAIL="admin@arenalive.local"                                   # superadmin del server di prova
SUPER_PASSWORD="password-di-prova"                              # password del superadmin di prova
SCAN_EMAIL="scan@arenalive.local"                                     # utente di scansione: admin del cliente «Predefinito»
SCAN_PASSWORD="password-scansione-1"                            # password dell'utente di scansione
IMMAGINE_ZAP="ghcr.io/zaproxy/zaproxy:2.17.0"                   # immagine ZAP con versione fissa
CARTELLA_REPORT="${DAST_REPORT_DIR:-$HOME/arenalive-dast-report}"     # report HTML/JSON: fuori dal repository
MINUTI_MAX="30"                                                 # tempo massimo della scansione, in minuti
LIMITE_ALTO_MEDIO="2"                                           # rischio minimo che fa fallire (3 Alto, 2 Medio)

# --- preparazione ---
set -uo pipefail
RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER="http://localhost:$PORTA"
LOG_SERVER="$CARTELLA_REPORT/server.log"
JAR="$CARTELLA_REPORT/cookies.txt"
SERVER_PID=""

fine() {   # ferma il server di prova (e i suoi figli) a ogni uscita
    if [[ -n "$SERVER_PID" ]]; then kill -- "-$SERVER_PID" 2>/dev/null || kill "$SERVER_PID" 2>/dev/null || true; fi
    rm -f "$JAR"
}
trap fine EXIT
errore() { echo "ERRORE: $*" >&2; exit 2; }

command -v docker >/dev/null || errore "docker non disponibile"
command -v node >/dev/null || errore "node non disponibile"
command -v pnpm >/dev/null || corepack enable 2>/dev/null || errore "pnpm non disponibile"
if curl -s -o /dev/null "$SERVER/api/health"; then errore "la porta $PORTA è già occupata"; fi

if [[ -d "$CARTELLA_REPORT" && -n "$(ls -A "$CARTELLA_REPORT")" && ! -f "$CARTELLA_REPORT/zap-report.json" ]]; then
    errore "$CARTELLA_REPORT non è vuota e non è una cartella di report precedente: scegline un'altra (DAST_REPORT_DIR)"
fi
mkdir -p "$CARTELLA_REPORT"
rm -f "$CARTELLA_REPORT"/{zap-report.html,zap-report.json,zap.log,server.log,cookies.txt,openapi.yaml,zap-regole.tsv}
cp "$RADICE/scripts/dast/openapi.yaml" "$RADICE/scripts/dast/zap-regole.tsv" "$CARTELLA_REPORT/"
chmod 777 "$CARTELLA_REPORT"   # ZAP nel container gira come utente 1000 e scrive qui

# --- server di prova ---
echo "== Avvio del server di prova su $SERVER"
(
    cd "$RADICE/apps/server" || exit 2
    DATABASE_URL="pglite:memory" COOKIE_SECURE="false" ADMIN_EMAIL="$SUPER_EMAIL" ADMIN_PASSWORD="$SUPER_PASSWORD" \
    CORS_ORIGIN="http://localhost:5173" PORT="$PORTA" RATE_LIMIT_LOGIN=100000 RATE_LIMIT_ADMIN=100000 \
    RATE_LIMIT_PUBLIC=100000 RATE_LIMIT_INGEST=100000 RATE_LIMIT_REGISTER=100000 RATE_LIMIT_PUBLIC_WS=100000 \
    RATE_LIMIT_PUBLIC_INVALID=100000 RATE_LIMIT_SHORT_CODE_INVALID=100000 RATE_LIMIT_AGENT_DOWNLOAD=100000 \
    RATE_LIMIT_PASSWORD_RESET=100000 LEAGUE_SYNC=off \
    exec setsid pnpm exec tsx --conditions=@arenalive/source src/main.ts
) > "$LOG_SERVER" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 90); do
    curl -sf "$SERVER/api/health" >/dev/null && break
    kill -0 "$SERVER_PID" 2>/dev/null || { tail -20 "$LOG_SERVER" >&2; errore "il server di prova si è fermato"; }
    sleep 1
done
curl -sf "$SERVER/api/health" >/dev/null || { tail -20 "$LOG_SERVER" >&2; errore "il server non risponde su /api/health"; }

# --- utente di scansione e token agente ---
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log($1)})"; }
post() {   # $1 = percorso, $2 = body JSON
    curl -sf -b "$JAR" -c "$JAR" -H "Content-Type: application/json" -d "$2" "$SERVER$1"
}
echo "== Utente di scansione e token agente"
post /api/auth/login "{\"email\":\"$SUPER_EMAIL\",\"password\":\"$SUPER_PASSWORD\"}" >/dev/null || errore "login superadmin"
TENANT_ID="$(curl -sf -b "$JAR" "$SERVER/api/admin/tenants" | json "o.find(t=>t.slug==='predefinito').id")" || errore "cliente Predefinito"
post /api/admin/active-tenant "{\"tenantId\":\"$TENANT_ID\"}" >/dev/null || errore "cliente attivo"
post /api/admin/users "{\"email\":\"$SCAN_EMAIL\",\"password\":\"$SCAN_PASSWORD\",\"role\":\"admin\"}" >/dev/null || errore "utente di scansione"
AGENT_TOKEN="$(post /api/admin/agents '{"name":"agente-dast"}' | json "o.token")" || errore "token agente"
: > "$JAR"
post /api/auth/login "{\"email\":\"$SCAN_EMAIL\",\"password\":\"$SCAN_PASSWORD\"}" >/dev/null || errore "login utente di scansione"
SESSIONE="$(awk '$6=="arenalive_session"{print $7}' "$JAR")"
[[ -n "$SESSIONE" ]] || errore "cookie arenalive_session non ottenuto"
curl -sf -b "$JAR" "$SERVER/api/auth/me" >/dev/null || errore "sessione di scansione non valida"

# --- ZAP: cookie di sessione e token agente su ogni richiesta; il logout è escluso ---
ZAP_CONFIG=(
    -config "replacer.full_list(0).description=sessione"
    -config "replacer.full_list(0).enabled=true"
    -config "replacer.full_list(0).matchtype=REQ_HEADER"
    -config "replacer.full_list(0).matchstr=Cookie"
    -config "replacer.full_list(0).regex=false"
    -config "replacer.full_list(0).replacement=arenalive_session=$SESSIONE"
    -config "replacer.full_list(1).description=agente"
    -config "replacer.full_list(1).enabled=true"
    -config "replacer.full_list(1).matchtype=REQ_HEADER"
    -config "replacer.full_list(1).matchstr=Authorization"
    -config "replacer.full_list(1).regex=false"
    -config "replacer.full_list(1).replacement=Bearer $AGENT_TOKEN"
    -config "globalexcludeurl.url_list.url(0).regex=true"
    -config "globalexcludeurl.url_list.url(0).enabled=true"
    -config "globalexcludeurl.url_list.url(0).description=logout"
    -config "globalexcludeurl.url_list.url(0).regex=.*/api/auth/logout.*"
)
# zap-api-scan.py spezza -z con shlex: ogni argomento va tra apici, altrimenti «Bearer <token>» diventa due parole
ZAP_Z="$(printf "'%s' " "${ZAP_CONFIG[@]}")"

echo "== Scansione ZAP ($IMMAGINE_ZAP), al massimo $MINUTI_MAX minuti"
docker run --rm --network host -v "$CARTELLA_REPORT:/zap/wrk:rw" "$IMMAGINE_ZAP" \
    zap-api-scan.py -t /zap/wrk/openapi.yaml -f openapi -O "$SERVER" -c zap-regole.tsv \
    -r zap-report.html -J zap-report.json -T "$MINUTI_MAX" -I -z "$ZAP_Z" \
    > "$CARTELLA_REPORT/zap.log" 2>&1
ZAP_ESITO=$?
if [[ ! -s "$CARTELLA_REPORT/zap-report.json" ]]; then tail -30 "$CARTELLA_REPORT/zap.log" >&2; errore "ZAP non ha prodotto il report (uscita $ZAP_ESITO)"; fi

# --- riassunto ---
echo "== Riassunto (report in $CARTELLA_REPORT/zap-report.html)"
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const soglia = Number(process.argv[2]);
const nomi = { 3: "Alto", 2: "Medio", 1: "Basso", 0: "Informativo" };
const conta = { 3: 0, 2: 0, 1: 0, 0: 0 };
const gravi = [];
for (const s of r.site ?? []) for (const a of s.alerts ?? []) {
    const rischio = Number(a.riskcode);
    conta[rischio] += 1;
    const esempio = a.instances?.[0];
    const riga = `${nomi[rischio]}: ${a.name} (plugin ${a.pluginid}, ${a.instances?.length ?? 0} istanze)` +
        (esempio ? ` es. ${esempio.method} ${esempio.uri}` : "");
    if (rischio >= soglia) gravi.push(riga); else if (rischio === 1) console.log("  " + riga);
}
console.log(`Alto ${conta[3]}, Medio ${conta[2]}, Basso ${conta[1]}, Informativo ${conta[0]}`);
for (const g of gravi) console.log("  DA CORREGGERE - " + g);
process.exit(gravi.length > 0 ? 1 : 0);
' "$CARTELLA_REPORT/zap-report.json" "$LIMITE_ALTO_MEDIO"
