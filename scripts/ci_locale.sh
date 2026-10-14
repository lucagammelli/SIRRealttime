#!/usr/bin/env bash
# CI in locale (docs/regole/test-job-rilasci.md): unica CI del progetto (non c'è CI su GitHub), da lanciare
# prima di ogni PR dalla radice del repository (anche da un worktree).
#
# Uso: scripts/ci_locale.sh

# --- variabili ---
RADICE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"          # radice del repository (o del worktree)

# --- passi ---
set -uo pipefail
cd "$RADICE"
if [[ ! -f package.json ]]; then echo "Nessun package.json: monorepo non ancora creato, niente da verificare."; exit 0; fi
command -v pnpm >/dev/null || corepack enable 2>/dev/null || { echo "pnpm non disponibile (corepack enable)" >&2; exit 1; }
esito=0

passo() {   # $1 = titolo, resto = comando; mostra solo le ultime righe
    echo "== $1"
    "${@:2}" > "/tmp/ci-sir-$$.log" 2>&1
    local r=$?
    tail -15 "/tmp/ci-sir-$$.log"
    [[ $r -eq 0 ]] && echo "ok" || { echo "FALLITO ($1)"; esito=1; }
    rm -f "/tmp/ci-sir-$$.log"
}

passo "1/5 Dipendenze" pnpm install --frozen-lockfile
passo "2/5 Lint" pnpm -r --if-present lint
passo "3/5 Typecheck" pnpm -r --if-present typecheck
passo "4/5 Test" pnpm -r --if-present test
passo "5/5 Build" pnpm -r --if-present build

echo
[[ $esito -eq 0 ]] && echo "CI locale: OK" || echo "CI locale: FALLITA"
exit $esito
