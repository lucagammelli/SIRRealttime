#!/usr/bin/env bash
# Rilascio di una versione di SIRRealtime (semver X.Y.Z), in due tempi (docs/regole/test-job-rilasci.md):
#   1) scripts/rilascia.sh X.Y.Z            prepara il rilascio: da main pulito e allineato a origin crea il ramo
#                                           rilascio-X.Y.Z (in un worktree), porta la versione nel package.json alla
#                                           radice, aggiunge la sezione al CHANGELOG.md con i titoli dei commit dal tag
#                                           precedente, fa commit, push e apre la PR. La PR si unisce a mano (Luca).
#   2) scripts/rilascia.sh --tagga X.Y.Z    dopo il merge: controlla che main contenga la versione, crea il tag
#                                           annotato vX.Y.Z, lo pubblica e crea la release GitHub con le note del CHANGELOG.
# Con --prova fa solo i controlli e mostra cosa farebbe, senza cambiare nulla (né file, né rami, né GitHub).
# Poi, in produzione (come root):  scripts/aggiorna-produzione.sh vX.Y.Z
# Serve: git, gh (autenticato con `gh auth login`), node, accesso in scrittura a origin.

# --- variabili ---
RADICE="$(realpath "$(dirname "${BASH_SOURCE[0]}")/..")"   # radice del repository (la cartella principale, su main)
REMOTO="origin"                                             # remoto GitHub
RAMO_PRINCIPALE="main"                                      # ramo da cui si rilascia
FILE_CHANGELOG="CHANGELOG.md"                               # elenco delle versioni, in italiano
CARTELLA_WORKTREE="$RADICE/.claude/worktrees"               # dove si crea il worktree del ramo di rilascio (esclusa da git)
CO_AUTORE="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"   # riga finale del commit
FIRMA_PR="🤖 Generated with [Claude Code](https://claude.com/claude-code)"   # riga finale della PR

# --- codice ---
set -Eeuo pipefail
trap 'echo "ERRORE: rilascio interrotto alla riga $LINENO ($BASH_COMMAND)" >&2' ERR

PROVA=0
TAGGA=0
VERSIONE=""
FILE_NOTE=""   # file temporaneo con le note della release (rimosso all'uscita)
trap '[[ -z "$FILE_NOTE" ]] || rm -f "$FILE_NOTE"' EXIT

uso() {
    echo "Uso: scripts/rilascia.sh [--prova] X.Y.Z        prepara il rilascio (ramo, versione, CHANGELOG, PR)" >&2
    echo "     scripts/rilascia.sh [--prova] --tagga X.Y.Z  dopo il merge: tag vX.Y.Z e release GitHub" >&2
    exit 2
}
errore() { echo "ERRORE: $*" >&2; exit 1; }
# Esegue il comando, oppure lo mostra soltanto con --prova.
esegui() {
    if (( PROVA )); then echo "[prova] $*"; else "$@"; fi
}

per_argomento() {
    for a in "$@"; do
        case "$a" in
            --prova) PROVA=1 ;;
            --tagga) TAGGA=1 ;;
            -h|--help) uso ;;
            -*) echo "Opzione sconosciuta: $a" >&2; uso ;;
            *) [[ -z "$VERSIONE" ]] || uso; VERSIONE="$a" ;;
        esac
    done
    [[ -n "$VERSIONE" ]] || uso
    [[ "$VERSIONE" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
        || errore "la versione '$VERSIONE' non è nel formato X.Y.Z (solo numeri, senza zeri iniziali, senza 'v')"
}

# Ultimo tag vX.Y.Z (vuoto se non ce ne sono), dai tag locali già aggiornati con fetch.
# Con --prova non si scrivono riferimenti locali (niente fetch dei tag): si aggiungono quelli letti da origin con ls-remote.
ultimo_tag() {
    {
        git tag --list 'v[0-9]*.[0-9]*.[0-9]*'
        if (( PROVA )); then
            git ls-remote --tags --refs "$REMOTO" 'refs/tags/v*' | sed 's#.*refs/tags/##'
        fi
    } | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V -u | tail -n 1 || true
}

# 0 se $1 > $2 (confronto semver numerico).
maggiore() { [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" == "$1" ]]; }

controlla_main() {
    command -v gh >/dev/null || errore "gh non disponibile"
    command -v node >/dev/null || errore "node non disponibile"
    cd "$RADICE"
    [[ "$(git branch --show-current)" == "$RAMO_PRINCIPALE" ]] \
        || errore "la cartella principale deve essere su $RAMO_PRINCIPALE (ora: $(git branch --show-current))"
    [[ -z "$(git status --porcelain --untracked-files=no)" ]] \
        || errore "ci sono modifiche non salvate in $RAMO_PRINCIPALE (git status)"
    local remoto
    if (( PROVA )); then
        remoto="$(git ls-remote "$REMOTO" "refs/heads/$RAMO_PRINCIPALE" | cut -f1)"   # sola lettura: nessun riferimento locale cambia
    else
        git fetch --quiet --tags --force "$REMOTO" "$RAMO_PRINCIPALE"
        remoto="$(git rev-parse "$REMOTO/$RAMO_PRINCIPALE")"
    fi
    [[ "$(git rev-parse HEAD)" == "$remoto" ]] \
        || errore "$RAMO_PRINCIPALE non è allineato a $REMOTO/$RAMO_PRINCIPALE (git pull --ff-only, o commit non pubblicati)"
}

controlla_versione_nuova() {
    local ultimo
    ultimo="$(ultimo_tag)"
    if [[ -n "$ultimo" ]] && ! maggiore "$VERSIONE" "${ultimo#v}"; then
        errore "la versione $VERSIONE deve essere maggiore dell'ultimo tag ($ultimo)"
    fi
    git rev-parse -q --verify "refs/tags/v$VERSIONE" >/dev/null && errore "il tag v$VERSIONE esiste già"
    echo "Ultimo tag: ${ultimo:-nessuno}; nuova versione: $VERSIONE"
}

# Sezione di CHANGELOG per $VERSIONE: titoli dei commit (senza merge) dall'ultimo tag a HEAD.
sezione_changelog() {
    local ultimo intervallo
    ultimo="$(ultimo_tag)"
    # In prova il tag potrebbe non esserci in locale (nessun fetch): allora l'elenco parte dall'inizio.
    if [[ -n "$ultimo" ]] && git rev-parse -q --verify "refs/tags/$ultimo" >/dev/null; then intervallo="$ultimo..HEAD"; else intervallo="HEAD"; fi
    printf '## [%s] - %s\n\n' "$VERSIONE" "$(date +%F)"
    local righe
    righe="$(git log --no-merges --format='- %s' "$intervallo")"
    if [[ -n "$righe" ]]; then printf '%s\n' "$righe"; else echo "- Nessuna modifica."; fi
}

# Nel file $1 inserisce il testo di $2 prima della prima sezione «## » (o in fondo).
inserisci_sezione() {
    local file=$1 sezione=$2 nuovo
    nuovo="$(mktemp)"
    # ENVIRON e non `awk -v`: -v interpreta le barre rovesciate dei titoli (\t diventerebbe una tabulazione).
    SEZIONE="$sezione" awk 'BEGIN { sez = ENVIRON["SEZIONE"]; fatto = 0 } /^## / && !fatto { print sez; print ""; fatto = 1 } { print } END { if (!fatto) { print ""; print sez } }' "$file" > "$nuovo"
    cat "$nuovo" > "$file"
    rm -f "$nuovo"
}

# Testo della sezione $2 (senza il titolo) del file $1.
note_versione() {
    awk -v v="$2" '
        /^## \[/ { dentro = (index($0, "## [" v "]") == 1); next }
        dentro { riga[++n] = $0 }
        END {
            inizio = 1; fine = n
            while (inizio <= fine && riga[inizio] == "") inizio++
            while (fine >= inizio && riga[fine] == "") fine--
            for (i = inizio; i <= fine; i++) print riga[i]
        }' "$1"
}

prepara() {
    controlla_main
    controlla_versione_nuova
    local ramo="rilascio-$VERSIONE" cartella
    cartella="$CARTELLA_WORKTREE/$ramo"
    git rev-parse -q --verify "refs/heads/$ramo" >/dev/null && errore "il ramo locale $ramo esiste già"
    git ls-remote --exit-code --heads "$REMOTO" "$ramo" >/dev/null 2>&1 && errore "il ramo $ramo esiste già su $REMOTO"
    [[ ! -e "$cartella" ]] || errore "la cartella $cartella esiste già"
    local attuale
    attuale="$(node "$RADICE/scripts/versione.mjs")"
    maggiore "$VERSIONE" "$attuale" || errore "la versione $VERSIONE deve superare quella del package.json ($attuale)"
    if grep -qF "## [$VERSIONE]" "$RADICE/$FILE_CHANGELOG" 2>/dev/null; then
        errore "$FILE_CHANGELOG ha già una sezione per la versione $VERSIONE"
    fi
    local sezione
    sezione="$(sezione_changelog)"
    echo "--- Sezione del CHANGELOG ---"
    echo "$sezione"
    echo "-----------------------------"
    if (( PROVA )); then
        echo "[prova] worktree $cartella sul ramo $ramo da $REMOTO/$RAMO_PRINCIPALE"
        echo "[prova] package.json: version -> $VERSIONE; $FILE_CHANGELOG: nuova sezione"
        echo "[prova] commit «Rilascio $VERSIONE», push di $ramo, PR verso $RAMO_PRINCIPALE"
        echo "Controlli superati (prova: non è stato cambiato nulla)."
        return 0
    fi
    mkdir -p "$CARTELLA_WORKTREE"
    git worktree add -q -b "$ramo" "$cartella" "$REMOTO/$RAMO_PRINCIPALE"
    (
        cd "$cartella"
        node -e '
            const fs = require("node:fs");
            const t = fs.readFileSync("package.json", "utf8");
            const n = t.replace(/^(\s*"version":\s*")[^"]*(")/m, "$1" + process.argv[1] + "$2");
            if (n === t && !t.includes("\"version\": \"" + process.argv[1] + "\"")) { console.error("campo version non trovato"); process.exit(1); }
            fs.writeFileSync("package.json", n);' "$VERSIONE"
        [[ "$(node scripts/versione.mjs)" == "$VERSIONE" ]] || errore "la versione nel package.json non è stata aggiornata"
        if [[ ! -f "$FILE_CHANGELOG" ]]; then printf '# Changelog\n' > "$FILE_CHANGELOG"; fi
        inserisci_sezione "$FILE_CHANGELOG" "$sezione"
        git add package.json "$FILE_CHANGELOG"
        git commit -q -m "Rilascio $VERSIONE" -m "Versione $VERSIONE e sezione del $FILE_CHANGELOG." -m "$CO_AUTORE"
        git push -q -u "$REMOTO" "$ramo"
        gh pr create --base "$RAMO_PRINCIPALE" --head "$ramo" --title "Rilascio $VERSIONE" \
            --body "$(printf 'Rilascio **%s**: versione del `package.json` e sezione del `%s`.\n\n%s\n\nDopo il merge: `scripts/rilascia.sh --tagga %s`, poi in produzione `scripts/aggiorna-produzione.sh v%s`.\n\n%s\n' "$VERSIONE" "$FILE_CHANGELOG" "$sezione" "$VERSIONE" "$VERSIONE" "$FIRMA_PR")"
    )
    git worktree remove --force "$cartella"
    echo "PR aperta. Dopo il merge: scripts/rilascia.sh --tagga $VERSIONE (poi git branch -D $ramo)"
}

tagga() {
    controlla_main
    git rev-parse -q --verify "refs/tags/v$VERSIONE" >/dev/null && errore "il tag v$VERSIONE esiste già"
    git ls-remote --exit-code --tags "$REMOTO" "refs/tags/v$VERSIONE" >/dev/null 2>&1 && errore "il tag v$VERSIONE esiste già su $REMOTO"
    local su_main
    su_main="$(git show "HEAD:package.json" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>console.log(JSON.parse(t).version))')"
    [[ "$su_main" == "$VERSIONE" ]] \
        || errore "$RAMO_PRINCIPALE ha la versione $su_main nel package.json, non $VERSIONE: la PR di rilascio è stata unita e main aggiornato?"
    local ultimo
    ultimo="$(ultimo_tag)"
    if [[ -n "$ultimo" ]] && ! maggiore "$VERSIONE" "${ultimo#v}"; then
        errore "la versione $VERSIONE deve essere maggiore dell'ultimo tag ($ultimo)"
    fi
    local note
    note="$(note_versione "$FILE_CHANGELOG" "$VERSIONE")"
    [[ -n "$note" ]] || errore "nessuna sezione [$VERSIONE] in $FILE_CHANGELOG"
    echo "--- Note della release ---"
    echo "$note"
    echo "--------------------------"
    FILE_NOTE="$(mktemp)"
    printf '%s\n' "$note" > "$FILE_NOTE"
    esegui git tag -a "v$VERSIONE" -m "SIRRealtime $VERSIONE" HEAD
    esegui git push "$REMOTO" "refs/tags/v$VERSIONE"
    esegui gh release create "v$VERSIONE" --title "SIRRealtime $VERSIONE" --notes-file "$FILE_NOTE" --verify-tag
    if (( PROVA )); then
        echo "Controlli superati (prova: nessun tag né release creati)."
    else
        echo "Release v$VERSIONE pubblicata. In produzione (root): scripts/aggiorna-produzione.sh v$VERSIONE"
    fi
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    per_argomento "$@"
    if (( TAGGA )); then tagga; else prepara; fi
fi
