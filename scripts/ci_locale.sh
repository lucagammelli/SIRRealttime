#!/usr/bin/env bash
# CI in locale (docs/regole/test-job-rilasci.md): unica CI del progetto (non c'è CI su GitHub), da lanciare
# prima di ogni PR dalla radice del repository (anche da un worktree).
# Di default verifica solo i pacchetti cambiati rispetto alla base e i loro dipendenti; esegue tutto se cambiano file
# della radice (configurazioni condivise, lockfile, questo script) o con --completa (da usare per i rilasci).
# Lint e typecheck girano in parallelo; test e build aspettano il turno (un solo giro pesante alla volta sulla macchina).
# Se va a buon fine su un worktree pulito, registra il tree verificato in .claude/ci-ok-<ramo> (cartella principale,
# fuori dal repository): «job.sh unisci» salta la CI se dopo l'allineamento il tree è lo stesso.
#
# Uso: scripts/ci_locale.sh [--completa]

# --- variabili ---
RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"          # radice del repository (o del worktree)
REMOTO="origin"                                                    # remoto GitHub
BASE="main"                                                        # ramo di arrivo delle PR
# file della radice che, se cambiano, richiedono la CI su tutti i pacchetti (espressione regolare sul percorso)
RADICE_COMPLETA='^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*|eslint\.config\.[^/]*|\.prettier[^/]*|\.editorconfig|\.npmrc|\.nvmrc|vitest[^/]*|scripts/ci_locale\.sh|scripts/versione\.mjs|scripts/scrivi-versione\.mjs|samples/.*)$'
SIMULTANEI=2                                                       # pacchetti in parallelo per ciascuno di lint e typecheck
ATTESA_TURNO=3600                                                  # secondi massimi di attesa del turno per test e build

# --- funzioni ---
set -uo pipefail
cd "$RADICE"
if [[ ! -f package.json ]]; then echo "Nessun package.json: monorepo non ancora creato, niente da verificare."; exit 0; fi
command -v pnpm >/dev/null || corepack enable 2>/dev/null || { echo "pnpm non disponibile (corepack enable)" >&2; exit 1; }
completa=0
case "${1:-}" in
    "") ;;
    --completa) completa=1 ;;
    *) echo "uso: scripts/ci_locale.sh [--completa]" >&2; exit 1 ;;
esac
esito=0
inizio=$(date +%s)
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ci-arenalive.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Cartella principale (dove vivono lucchetti e registrazioni): quella del repository condiviso dai worktree.
PRINCIPALE="$(cd "$(git rev-parse --git-common-dir 2>/dev/null)/.." 2>/dev/null && pwd || echo "$RADICE")"

base_rif() {
    if git show-ref --verify --quiet "refs/remotes/$REMOTO/$BASE"; then echo "$REMOTO/$BASE"
    elif git show-ref --verify --quiet "refs/heads/$BASE"; then echo "$BASE"
    fi
}

# File cambiati rispetto alla base: commit del ramo + modifiche non salvate (anche non tracciate).
file_cambiati() {
    {
        git diff --name-only "$1...HEAD" 2>/dev/null
        git status --porcelain 2>/dev/null | cut -c4- | sed 's/.* -> //'
    } | sort -u
}

fine_passo() {   # $1 = titolo, $2 = file del log, $3 = codice di uscita
    echo "== $1"
    tail -15 "$2"
    if [[ $3 -eq 0 ]]; then echo "ok"; else echo "FALLITO ($1)"; esito=1; fi
}

passo() {   # $1 = titolo, resto = comando; mostra solo le ultime righe
    "${@:2}" > "$TMP/passo.log" 2>&1
    fine_passo "$1" "$TMP/passo.log" $?
}

# --- ambito: pacchetti toccati o tutti ---
motivo="completa richiesta con --completa"
filtro=(); filtro_build=()
if [[ $completa -eq 0 ]]; then
    rif="$(base_rif)"
    if [[ -z "$rif" ]]; then
        completa=1; motivo="completa: nessuna base ($REMOTO/$BASE) con cui confrontare"
    else
        radice_toccata="$(file_cambiati "$rif" | grep -E "$RADICE_COMPLETA" | head -3 | tr '\n' ' ')"
        if [[ -n "$radice_toccata" ]]; then
            completa=1; motivo="completa: cambiati file della radice ($radice_toccata)"
        else
            # cambiati e dipendenti (senza il progetto radice, i cui script rilancerebbero tutto) per lint, typecheck e test; per la build anche le dipendenze (usano il loro dist)
            filtro=(--filter "...[$rif]" --filter "!."); filtro_build=(--filter "...[$rif]..." --filter "!.")
            motivo="parziale: pacchetti cambiati rispetto a $rif e dipendenti"
        fi
    fi
fi
echo "CI locale, modo $motivo"
[[ $completa -eq 1 ]] && { filtro=(); filtro_build=(); }

# --- passi ---
passo "1/5 Dipendenze" pnpm install --frozen-lockfile

# lint e typecheck in parallelo: ciascuno con pochi pacchetti alla volta, per non esaurire la memoria
echo "== 2-3/5 Lint e typecheck in parallelo"
( pnpm "${filtro[@]}" --workspace-concurrency="$SIMULTANEI" -r --if-present lint > "$TMP/lint.log" 2>&1; echo $? > "$TMP/lint.rc" ) &
( pnpm "${filtro[@]}" --workspace-concurrency="$SIMULTANEI" -r --if-present typecheck > "$TMP/typecheck.log" 2>&1; echo $? > "$TMP/typecheck.rc" ) &
wait
fine_passo "2/5 Lint" "$TMP/lint.log" "$(cat "$TMP/lint.rc")"
fine_passo "3/5 Typecheck" "$TMP/typecheck.log" "$(cat "$TMP/typecheck.rc")"

# test e build: un solo giro pesante alla volta tra tutte le CI della macchina
mkdir -p "$PRINCIPALE/.claude"
LUCCHETTO_CI="$PRINCIPALE/.claude/ci-pesante.lock"
exec 7> "$LUCCHETTO_CI"
if ! flock -n 7; then
    echo "Attendo il turno: un'altra CI sta eseguendo test e build ($(cat "$LUCCHETTO_CI.chi" 2>/dev/null))."
    flock -w "$ATTESA_TURNO" 7 || { echo "Turno non arrivato in $((ATTESA_TURNO / 60)) minuti" >&2; exit 1; }
fi
echo "$(git symbolic-ref --short -q HEAD || echo staccato) in $RADICE dal $(date '+%H:%M')" > "$LUCCHETTO_CI.chi"
trap 'rm -rf "$TMP"; rm -f "$LUCCHETTO_CI.chi"' EXIT
passo "4/5 Test" pnpm "${filtro[@]}" -r --if-present test
passo "5/5 Build" pnpm "${filtro_build[@]}" -r --if-present build

# --- esito e registrazione ---
durata=$(( $(date +%s) - inizio ))
echo
if [[ $esito -eq 0 ]]; then
    echo "CI locale: OK (${durata}s)"
    ramo="$(git symbolic-ref --short -q HEAD || true)"
    if [[ -n "$ramo" && -z "$(git status --porcelain)" ]]; then
        # registra tree e base verificati (percorso con «/» del ramo reso innocuo)
        printf 'tree=%s\nbase=%s\nmodo=%s\ndurata=%ss\n' "$(git rev-parse 'HEAD^{tree}')" \
            "$(git rev-parse "$(base_rif)" 2>/dev/null || echo -)" "$([[ $completa -eq 1 ]] && echo completa || echo parziale)" "$durata" \
            > "$PRINCIPALE/.claude/ci-ok-${ramo//\//_}"
    else
        echo "Nessuna registrazione: modifiche non salvate o ramo staccato (la CI vale solo su un commit)."
    fi
    exit 0
fi
echo "CI locale: FALLITA"
exit 1
