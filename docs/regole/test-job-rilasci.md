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
- Si lancia una volta, dopo `allinea` e prima del push (la lancia il coordinatore). Un esito precedente al rebase non vale.
- Si salta solo per modifiche a soli documenti, skill o agenti (nessun file TypeScript, `package.json` o configurazione di build).
- Non c'è CI su GitHub: la CI è solo locale; nella PR si riporta l'esito di `ci_locale.sh`.

## Commit, PR, merge
- Commit e PR in italiano; il commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  la PR con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- PR solo se Luca lo chiede; il merge di una PR solo con `scripts/job.sh unisci`, mai `gh pr merge` a mano.
- Mai push forzati. Su `main` solo push fast-forward dal worktree del job dopo la CI verde, come ha scelto Luca
  (2026-10-15), seguito da `job.sh chiudi`; PR e `job.sh unisci` quando li chiede.

## Rilasci
- Il deploy (hosting ancora da decidere) e la distribuzione dell'eseguibile dell'agente li esegue Luca;
  Claude prepara gli script completi con le variabili in alto.
