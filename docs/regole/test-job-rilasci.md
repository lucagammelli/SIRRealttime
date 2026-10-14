# Regole: job, rami, CI e rilasci

## Un job = un ramo = un worktree
- Ogni lavoro si fa in un ramo dedicato con il suo worktree in `.claude/worktrees/<ramo>`, creato con
  `scripts/job.sh apri <ramo> "<sezione>" "<aree>"` da `origin/main` (o da `main` locale finché `origin/main` non esiste).
- La cartella principale `/home/athena/SIRRealttime` resta su `main` e pulita.
- Il registro `.claude/job-attivi.tsv` (fuori dal repository) evita che due sessioni lavorino sulla stessa sezione o
  sugli stessi file. Uscite di `job.sh`: **2** sovrapposizione, **4** job di un'altra sessione attiva.
- Nome del ramo: minuscole e trattini, che dica il lavoro (`parser-dvw-scout`, non `fix`).
- In ogni worktree le dipendenze si installano con `pnpm install` (i `node_modules` non si condividono).
- `.env` della cartella principale viene collegato nel worktree.

## Comandi
```
scripts/job.sh elenco                     # job, worktree, file toccati, PR aperte
scripts/job.sh apri <ramo> "<sez>" "<aree>"
scripts/job.sh allinea <ramo>             # rebase (o merge se già pushato) su origin/main
scripts/job.sh unisci <ramo>              # allinea, CI locale, push, merge PR, chiudi (una sessione alla volta)
scripts/job.sh chiudi <ramo>              # toglie worktree e ramo dopo il merge
```

## CI locale
- `scripts/ci_locale.sh` dalla radice del worktree: `pnpm install --frozen-lockfile`, lint, typecheck, test, build.
- Si lancia una volta, dopo `allinea` e prima della PR (la lancia l'operatore). Un esito precedente al rebase non vale.
- Non c'è CI su GitHub: la CI è solo locale; nella PR si riporta l'esito di `ci_locale.sh`.

## Commit, PR, merge
- Commit e PR in italiano; il commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  la PR con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Push e PR solo se Luca lo chiede; merge solo con `scripts/job.sh unisci`, mai `gh pr merge` a mano.
- Mai push forzati, mai push su `main` (eccezione unica: il primo commit iniziale del repository, con l'ok di Luca).

## Rilasci
- Il deploy (hosting ancora da decidere) e la distribuzione dell'eseguibile dell'agente li esegue Luca;
  Claude prepara gli script completi con le variabili in alto.
