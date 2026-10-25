#!/usr/bin/env bash
# Job di sviluppo con Claude (skill coordina): un job = un ramo = un worktree, e un registro condiviso tra le sessioni
# per non sovrapporre due lavori sulla stessa sezione o sugli stessi file.
# Ogni job ha un proprietario (la sessione di Claude che l'ha aperto): solo lui lo allinea, lo unisce e lo chiude.
# I merge passano da «unisci», una sessione alla volta.
#
# Uso:
#   scripts/job.sh elenco [breve]                          job registrati con proprietario, worktree, file toccati
#                                                          («breve»: solo i job, per l'avvio delle sessioni)
#   scripts/job.sh controlla "<sezione>" "<aree>"          sovrapposizioni con i job aperti (esce con 2 se ce ne sono)
#   scripts/job.sh apri <ramo> "<sezione>" "<aree>" [--forza]   controlla, crea ramo e worktree dalla base, registra
#   scripts/job.sh allinea <ramo> [--forza]                porta il ramo sulla base (rebase, o merge se già pushato)
#   scripts/job.sh pr <ramo> "<titolo>" "<corpo>" [--forza]  allinea, CI locale, push, PR (con l'esito della CI)
#   scripts/job.sh unisci <ramo> [--forza]                 merge della PR, una sessione alla volta: lucchetto, allinea,
#                                                          CI locale (saltata se il tree è già verificato), push, merge, chiudi
#   scripts/job.sh chiudi <ramo> [--forza]                 dopo il merge: toglie worktree, ramo locale e riga del registro
#
# <aree>: prefissi di percorso separati da virgola (es. "packages/dvw-parser/,docs/dvw-parser.md").
# --forza su allinea, pr, unisci, chiudi: agire sul job di un'altra sessione ancora attiva (solo con l'ok di Luca).
# Flusso: commit nel worktree, «pr» (una CI sola), «unisci» (salta la CI se dopo l'allineamento il tree è lo stesso).
# Base: origin/main se esiste, altrimenti main locale (repository appena creato, prima del primo push).

# --- variabili ---
PRINCIPALE="/home/athena/SIRRealttime"                         # cartella principale (resta su main, pulita)
WORKTREES="$PRINCIPALE/.claude/worktrees"                      # dove nascono i worktree dei job
REGISTRO="$PRINCIPALE/.claude/job-attivi.tsv"                  # registro condiviso (non nel repository)
COLLEGATI=".env apps/agent/config.json"                        # file della cartella principale collegati in ogni worktree
REMOTO="origin"                                                # remoto GitHub
BASE="main"                                                    # ramo di partenza e di arrivo delle PR
SESSIONI="$HOME/.claude/projects"                              # conversazioni di Claude Code (<sessione>.jsonl)
ATTIVA_MINUTI=120                                              # sessione attiva se ha lavorato negli ultimi N minuti
LUCCHETTO_UNISCI="$PRINCIPALE/.claude/unisci.lock"             # un merge alla volta tra tutte le sessioni
ATTESA_UNISCI=5400                                             # secondi massimi di attesa del proprio turno di merge
SESSIONE="${CLAUDE_CODE_SESSION_ID:-}"                         # sessione di Claude che lancia lo script (vuota = a mano)

# --- funzioni ---
set -uo pipefail
INTESTAZIONE=$'ramo\tsezione\taree\taperto\tnote\tsessione'

errore() { echo "ERRORE: $*" >&2; exit 1; }
registro_pronto() { [[ -f "$REGISTRO" ]] || printf '%s\n' "$INTESTAZIONE" > "$REGISTRO"; }

# Riferimento della base: origin/main se esiste, altrimenti main locale.
rif_base() {
    if git -C "$PRINCIPALE" show-ref --verify --quiet "refs/remotes/$REMOTO/$BASE"; then echo "$REMOTO/$BASE"
    else echo "$BASE"; fi
}
aggiorna_remoto() { git -C "$PRINCIPALE" fetch -q "$REMOTO" 2>/dev/null || echo "Avviso: fetch di $REMOTO non riuscito, uso $(rif_base)."; }

# Scrive nel registro sotto lock (più sessioni possono lavorare insieme). $@ = programma awk che riceve le righe.
registro_scrivi() {
    registro_pronto
    (
        flock -x 9
        awk -F'\t' -v OFS='\t' "$@" "$REGISTRO" > "$REGISTRO.tmp" && mv "$REGISTRO.tmp" "$REGISTRO"
    ) 9> "$REGISTRO.lock"
}

# Campo di un ramo del registro (vuoto se manca).
campo() { registro_pronto; awk -F'\t' -v r="$1" -v c="$2" 'NR>1 && $1==r {print $c}' "$REGISTRO"; }

# Minuti dall'ultima attività di una sessione (dalla sua conversazione); vuoto se non si trova.
minuti_sessione() {
    local f; f="$(ls -t "$SESSIONI"/*/"$1".jsonl 2>/dev/null | head -1)"
    [[ -n "$f" ]] && echo $(( ( $(date +%s) - $(stat -c %Y "$f") ) / 60 ))
}

# Proprietario di un job, per elenco: «questa sessione», «<id> attiva (N min fa)», «<id> inattiva», «non registrato».
descrivi_proprietario() {
    local sess="$1" min
    [[ -z "$sess" ]] && { echo "non registrato"; return; }
    [[ "$sess" == "$SESSIONE" ]] && { echo "questa sessione"; return; }
    min="$(minuti_sessione "$sess")"
    if [[ -n "$min" && "$min" -lt "$ATTIVA_MINUTI" ]]; then echo "${sess:0:8} attiva (${min} min fa)"
    else echo "${sess:0:8} inattiva"; fi
}

# Solo il proprietario agisce sul suo job. Job di una sessione inattiva: passa a questa (annotato nel registro).
verifica_proprietario() {
    local ramo="$1" forza="${2:-}" sess min
    sess="$(campo "$ramo" 6)"
    [[ -z "$sess" || "$sess" == "$SESSIONE" ]] && return 0
    if [[ -z "$SESSIONE" ]]; then
        echo "Avviso: il job $ramo è della sessione ${sess:0:8}; procedo perché il comando è lanciato a mano."; return 0
    fi
    min="$(minuti_sessione "$sess")"
    if [[ -n "$min" && "$min" -lt "$ATTIVA_MINUTI" ]]; then
        if [[ "$forza" == "--forza" ]]; then
            echo "Proseguo con --forza sul job $ramo della sessione ${sess:0:8} (accettato da Luca)."; return 0
        fi
        echo "Il job $ramo è della sessione ${sess:0:8}, attiva (ultima attività ${min} min fa)." >&2
        echo "Non intervenire: scrivi a quella sessione (SendMessage) o chiedi a Luca; --forza solo con il suo ok." >&2
        exit 4
    fi
    registro_scrivi -v r="$ramo" -v s="$SESSIONE" '$1==r {$6=s} {print}'
    echo "Il job $ramo era della sessione ${sess:0:8}, inattiva: ora è di questa sessione."
}

# File toccati da un worktree rispetto alla base: commit del ramo + modifiche non salvate.
file_toccati() {
    local wt="$1"
    {
        git -C "$wt" diff --name-only "$(rif_base)...HEAD" 2>/dev/null
        git -C "$wt" status --porcelain 2>/dev/null | cut -c4- | sed 's/.* -> //'
    } | sort -u
}

# Worktree dei job: percorso<TAB>ramo, esclusa la cartella principale.
worktree_job() {
    git -C "$PRINCIPALE" worktree list --porcelain | awk -v p="$PRINCIPALE" '
        /^worktree / {wt=substr($0,10); ramo=""}
        /^branch /   {ramo=substr($0,8); sub("refs/heads/","",ramo)}
        /^$/         {if (wt!="" && wt!=p) print wt "\t" (ramo==""?"(staccato)":ramo); wt=""}
        END          {if (wt!="" && wt!=p) print wt "\t" (ramo==""?"(staccato)":ramo)}'
}

# Job registrati con il proprietario al posto dell'id di sessione.
tabella_job() {
    local ramo sez aperto note sess
    {
        printf 'ramo\tsezione\taperto\tproprietario\tnote\n'
        # awk mette «-» nei campi vuoti: read con il tab salterebbe le colonne vuote
        while IFS=$'\t' read -r ramo sez aperto note sess; do
            [[ "$sess" == "-" ]] && sess=""
            printf '%s\t%s\t%s\t%s\t%s\n' "$ramo" "$sez" "$aperto" "$(descrivi_proprietario "$sess")" "$note"
        done < <(awk -F'\t' -v OFS='\t' 'NR>1 {for (i=1; i<=6; i++) if ($i=="") $i="-"; print $1, $2, $4, $5, $6}' "$REGISTRO")
    } | column -t -s $'\t'
}

elenco() {
    local wt ramo
    registro_pronto
    # dall'hook di avvio (SessionStart) l'id della sessione arriva su stdin, nel JSON dell'evento
    if [[ "${1:-}" == "breve" && -z "$SESSIONE" && ! -t 0 ]]; then
        SESSIONE="$(grep -o '"session_id" *: *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
    fi
    echo "== Job registrati"
    tabella_job
    if [[ "${1:-}" == "breve" ]]; then
        echo "Questa sessione: ${SESSIONE:0:8}"
        echo "Lavora solo sui job di questa sessione; per gli altri scrivi alla sessione proprietaria o chiedi a Luca."
        return 0
    fi
    echo
    echo "== Worktree e file toccati rispetto a $(rif_base)"
    while IFS=$'\t' read -r wt ramo; do
        local n; n="$(file_toccati "$wt" | grep -c .)"
        local reg=""; [[ -n "$(campo "$ramo" 1)" ]] || reg="  (NON registrato)"
        echo "- $ramo: $n file$reg  [$wt]"
        file_toccati "$wt" | head -15 | sed 's/^/    /'
    done < <(worktree_job)
    echo
    echo "== Cartella principale"
    git -C "$PRINCIPALE" status -sb | head -1
    [[ -z "$(git -C "$PRINCIPALE" status --porcelain)" ]] || echo "ATTENZIONE: modifiche non salvate nella cartella principale (qualcuno ci lavora?)"
    if command -v gh >/dev/null; then
        echo
        echo "== PR aperte"
        (cd "$PRINCIPALE" && gh pr list --state open --json number,headRefName,title \
            --template '{{range .}}#{{.number}} {{.headRefName}}: {{.title}}{{"\n"}}{{end}}' 2>/dev/null) || echo "(gh non disponibile)"
    fi
}

# Sovrapposizioni con i job aperti: stessa sezione nel registro, oppure file toccati dentro le aree indicate.
controlla() {
    local sezione="$1" aree="$2" escludi="${3:-}" trovate=0
    local ramo sez aree_altro wt f p a prefissi altri
    registro_pronto
    while IFS=$'\t' read -r ramo sez _ _ _; do
        [[ "$ramo" == "$escludi" ]] && continue
        if [[ -n "$sezione" && "${sez,,}" == "${sezione,,}" ]]; then
            echo "SOVRAPPOSIZIONE: il job $ramo lavora già sulla sezione «$sez»"; trovate=1
        fi
    done < <(tail -n +2 "$REGISTRO")
    IFS=',' read -ra prefissi <<< "$aree"
    while IFS=$'\t' read -r wt ramo; do
        [[ "$ramo" == "$escludi" ]] && continue
        while read -r f; do
            for p in "${prefissi[@]}"; do
                p="${p// /}"; [[ -z "$p" ]] && continue
                if [[ "$f" == "$p"* || "$p" == "$f"* ]]; then
                    echo "SOVRAPPOSIZIONE: il ramo $ramo tocca $f (area $p)"; trovate=1
                fi
            done
        done < <(file_toccati "$wt")
    done < <(worktree_job)
    # aree dichiarate dagli altri job ma non ancora toccate
    while IFS=$'\t' read -r ramo _ aree_altro _ _; do
        [[ "$ramo" == "$escludi" ]] && continue
        IFS=',' read -ra altri <<< "$aree_altro"
        for a in "${altri[@]}"; do
            for p in "${prefissi[@]}"; do
                a="${a// /}"; p="${p// /}"; [[ -z "$a" || -z "$p" ]] && continue
                if [[ "$a" == "$p"* || "$p" == "$a"* ]]; then
                    echo "SOVRAPPOSIZIONE: il job $ramo ha dichiarato l'area $a"; trovate=1
                fi
            done
        done
    done < <(tail -n +2 "$REGISTRO")
    [[ $trovate -eq 0 ]] && echo "Nessuna sovrapposizione."
    return $(( trovate * 2 ))
}

apri() {
    local ramo="$1" sezione="$2" aree="$3" forza="${4:-}"
    [[ "$ramo" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || errore "nome del ramo non valido: $ramo (minuscole, cifre, - . _)"
    [[ "$ramo" != "$BASE" ]] || errore "non si lavora su $BASE"
    [[ -z "$(campo "$ramo" 1)" ]] || errore "il job $ramo è già registrato"
    git -C "$PRINCIPALE" show-ref --verify --quiet "refs/heads/$ramo" && errore "il ramo $ramo esiste già"
    aggiorna_remoto
    local base; base="$(rif_base)"
    git -C "$PRINCIPALE" rev-parse -q --verify "$base^{commit}" >/dev/null || errore "la base $base non ha commit: serve il commit iniziale su $BASE"
    if ! controlla "$sezione" "$aree"; then
        [[ "$forza" == "--forza" ]] || { echo "Job non aperto: decidere con Luca (aspettare, accodarsi o --forza)."; exit 2; }
        echo "Proseguo con --forza (sovrapposizione accettata da Luca)."
    fi
    local wt="$WORKTREES/$ramo"
    git -C "$PRINCIPALE" worktree add -q --no-track -b "$ramo" "$wt" "$base" || errore "worktree non creato"
    for f in $COLLEGATI; do
        [[ -e "$PRINCIPALE/$f" && ! -e "$wt/$f" ]] && { mkdir -p "$(dirname "$wt/$f")"; ln -s "$PRINCIPALE/$f" "$wt/$f"; }
    done
    registro_scrivi -v r="$ramo" -v s="$sezione" -v a="$aree" -v d="$(date '+%Y-%m-%d %H:%M')" -v se="$SESSIONE" \
        '{print} END {print r, s, a, d, "", se}'
    echo "Job aperto: ramo $ramo da $base ($(git -C "$wt" rev-parse --short HEAD))"
    echo "Dipendenze: cd $wt && pnpm install"
    echo "WORKTREE=$wt"
}

allinea() {
    local ramo="$1" wt="$WORKTREES/$1"
    [[ -d "$wt" ]] || errore "worktree non trovato: $wt"
    verifica_proprietario "$ramo" "${2:-}"
    [[ -z "$(git -C "$wt" status --porcelain)" ]] || errore "modifiche non salvate in $wt: fare prima il commit"
    aggiorna_remoto
    local base; base="$(rif_base)"
    # prima del primo push: rebase (storia lineare); ramo già su GitHub: merge, così non serve mai un push forzato
    if git -C "$wt" ls-remote -q --exit-code --heads "$REMOTO" "$ramo" >/dev/null 2>&1; then
        if ! git -C "$wt" merge -q --no-edit "$base"; then
            git -C "$wt" merge --abort
            errore "merge di $base in conflitto: annullato, i conflitti vanno risolti a mano nel worktree"
        fi
    elif ! git -C "$wt" rebase -q "$base"; then
        git -C "$wt" rebase --abort
        errore "rebase su $base in conflitto: annullato, i conflitti vanno risolti a mano nel worktree"
    fi
    echo "Ramo $ramo allineato a $base ($(git -C "$wt" rev-parse --short "$base"))."
    return 0
}

chiudi() {
    local ramo="$1" forza="${2:-}" wt="$WORKTREES/$1"
    [[ -n "$(campo "$ramo" 1)" || -d "$wt" ]] || errore "job $ramo non trovato (né nel registro né tra i worktree)"
    verifica_proprietario "$ramo" "$forza"
    aggiorna_remoto
    if ! git -C "$PRINCIPALE" merge-base --is-ancestor "$ramo" "$(rif_base)" 2>/dev/null; then
        [[ "$forza" == "--forza" ]] || errore "il ramo $ramo non è unito a $(rif_base) (job abbandonato? --forza con l'ok di Luca)"
    fi
    if [[ -d "$wt" ]]; then
        [[ -z "$(git -C "$wt" status --porcelain)" ]] || errore "modifiche non salvate in $wt"
        for f in $COLLEGATI; do [[ -L "$wt/$f" ]] && rm "$wt/$f"; done
        git -C "$PRINCIPALE" worktree remove --force "$wt" || errore "worktree non rimosso"   # --force: node_modules non tracciati
    fi
    local opz="-d"; [[ "$forza" == "--forza" ]] && opz="-D"
    if git -C "$PRINCIPALE" show-ref --verify --quiet "refs/heads/$ramo"; then
        git -C "$PRINCIPALE" branch -q "$opz" "$ramo" || errore "ramo $ramo non eliminato"
    fi
    registro_scrivi -v r="$ramo" '$1!=r {print}'
    echo "Job $ramo chiuso."
}

# CI locale del ramo, una volta sola per tree: se ci_locale.sh ha già registrato (.claude/ci-ok-<ramo>) lo stesso tree
# su questa stessa base e il worktree è pulito, la salta. Imposta ESITO_CI (testo per la PR); fallita = errore.
esegui_ci() {
    local ramo="$1" wt="$WORKTREES/$1" ok="$PRINCIPALE/.claude/ci-ok-${1//\//_}" log tree_reg base_reg
    log="$PRINCIPALE/.claude/ci-$ramo.log"
    if [[ -f "$ok" && -z "$(git -C "$wt" status --porcelain)" ]]; then
        tree_reg="$(sed -n 's/^tree=//p' "$ok")"; base_reg="$(sed -n 's/^base=//p' "$ok")"
        if [[ "$tree_reg" == "$(git -C "$wt" rev-parse 'HEAD^{tree}')" && "$base_reg" == "$(git -C "$PRINCIPALE" rev-parse "$(rif_base)")" ]]; then
            ESITO_CI="OK, già verificata su questo stesso contenuto e questa base ($(sed -n 's/^modo=//p' "$ok"), $(sed -n 's/^durata=//p' "$ok")): non rieseguita"
            echo "CI locale saltata: tree $(git -C "$wt" rev-parse --short 'HEAD^{tree}') già verificato su $(rif_base)."
            return 0
        fi
    fi
    rm -f "$ok"
    echo "CI locale sul ramo allineato (log: $log)…"
    if ! (cd "$wt" && scripts/ci_locale.sh > "$log" 2>&1); then
        tail -30 "$log"; errore "CI locale fallita (log: $log)"
    fi
    ESITO_CI="OK ($(grep -m1 '^CI locale, modo' "$log" | sed 's/^CI locale, modo //'); $(sed -n 's/^durata=//p' "$ok" 2>/dev/null))"
}

# PR del job: allinea, CI locale, push, PR con l'esito della CI. Dopo, «unisci» non rifà la CI se non cambia nulla.
pr() {
    local ramo="$1" titolo="$2" corpo="$3" forza="${4:-}" wt="$WORKTREES/$1" esistente url
    [[ -d "$wt" ]] || errore "worktree non trovato: $wt"
    verifica_proprietario "$ramo" "$forza"
    command -v gh >/dev/null || errore "gh non disponibile"
    git -C "$PRINCIPALE" show-ref --verify --quiet "refs/remotes/$REMOTO/$BASE" || errore "$REMOTO/$BASE non esiste: prima il push del commit iniziale"
    allinea "$ramo" "$forza" || exit $?
    esegui_ci "$ramo"
    git -C "$wt" push -q "$REMOTO" "$ramo" || errore "push non riuscito (mai push forzati)"
    esistente="$(cd "$PRINCIPALE" && gh pr list --head "$ramo" --state open --json number -q '.[0].number')"
    if [[ -n "$esistente" ]]; then
        (cd "$PRINCIPALE" && gh pr comment "$esistente" --body "CI locale: $ESITO_CI") >/dev/null || echo "Avviso: commento sulla PR non aggiunto."
        echo "PR #$esistente già aperta: ramo aggiornato."
        return 0
    fi
    url="$(cd "$PRINCIPALE" && gh pr create --base "$BASE" --head "$ramo" --title "$titolo" \
        --body "$(printf '%s\n\nCI locale: %s\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)' "$corpo" "$ESITO_CI")")" \
        || errore "PR non creata"
    echo "PR creata: $url"
}

# Merge della PR del job, una sessione alla volta: con il lucchetto, il ramo si allinea all'ultimo main, la CI locale
# passa su quel main, poi push, merge e chiusura. Così due merge non si incrociano e main resta sempre provato.
unisci() {
    local ramo="$1" forza="${2:-}" wt="$WORKTREES/$1" pr
    [[ -d "$wt" ]] || errore "worktree non trovato: $wt"
    verifica_proprietario "$ramo" "$forza"
    command -v gh >/dev/null || errore "gh non disponibile"
    git -C "$PRINCIPALE" show-ref --verify --quiet "refs/remotes/$REMOTO/$BASE" || errore "$REMOTO/$BASE non esiste: prima il push del commit iniziale"
    pr="$(cd "$PRINCIPALE" && gh pr list --head "$ramo" --state open --json number -q '.[0].number')"
    [[ -n "$pr" ]] || errore "nessuna PR aperta per $ramo: prima la PR (con l'esito della CI), poi unisci"
    exec 8> "$LUCCHETTO_UNISCI"
    if ! flock -n 8; then
        echo "Attendo il turno: un'altra sessione sta unendo ($(cat "$LUCCHETTO_UNISCI.chi" 2>/dev/null))."
        flock -w "$ATTESA_UNISCI" 8 || errore "turno di merge non arrivato in $((ATTESA_UNISCI / 60)) minuti"
    fi
    echo "$ramo (PR #$pr) dal $(date '+%H:%M')" > "$LUCCHETTO_UNISCI.chi"
    trap 'rm -f "$LUCCHETTO_UNISCI.chi"' EXIT
    allinea "$ramo" "$forza" || exit $?
    esegui_ci "$ramo"
    git -C "$wt" push -q "$REMOTO" "$ramo" || errore "push non riuscito (mai push forzati)"
    (cd "$PRINCIPALE" && gh pr comment "$pr" --body "CI locale dopo l'allineamento a $BASE ($(git -C "$wt" rev-parse --short "$REMOTO/$BASE")): $ESITO_CI" >/dev/null) \
        || echo "Avviso: commento con l'esito della CI non aggiunto alla PR."
    (cd "$PRINCIPALE" && gh pr merge "$pr" --merge) || errore "merge della PR #$pr non riuscito"
    echo "PR #$pr unita."
    git -C "$PRINCIPALE" pull -q --ff-only || echo "Avviso: cartella principale non aggiornata (pull --ff-only non riuscito)."
    chiudi "$ramo" "$forza"
}

# --- comandi ---
comando="${1:-elenco}"; shift || true
case "$comando" in
    elenco)    elenco "${1:-}" ;;
    controlla) [[ $# -ge 2 ]] || errore "uso: controlla \"<sezione>\" \"<aree>\""; controlla "$1" "$2" ;;
    apri)      [[ $# -ge 3 ]] || errore "uso: apri <ramo> \"<sezione>\" \"<aree>\" [--forza]"; apri "$@" ;;
    allinea)   [[ $# -ge 1 ]] || errore "uso: allinea <ramo> [--forza]"; allinea "$@" ;;
    pr)        [[ $# -ge 3 ]] || errore "uso: pr <ramo> \"<titolo>\" \"<corpo>\" [--forza]"; pr "$@" ;;
    unisci)    [[ $# -ge 1 ]] || errore "uso: unisci <ramo> [--forza]"; unisci "$@" ;;
    chiudi)    [[ $# -ge 1 ]] || errore "uso: chiudi <ramo> [--forza]"; chiudi "$@" ;;
    *)         errore "comando sconosciuto: $comando (elenco, controlla, apri, allinea, pr, unisci, chiudi)" ;;
esac
