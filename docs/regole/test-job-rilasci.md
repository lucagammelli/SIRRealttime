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
scripts/job.sh pr <ramo> "<titolo>" "<corpo>"   # allinea, CI locale, push, PR con l'esito della CI
scripts/job.sh unisci <ramo>              # allinea, CI (saltata se il tree è già verificato), push, merge PR, chiudi
scripts/job.sh chiudi <ramo>              # toglie worktree e ramo dopo il merge
```

## CI locale
- `scripts/ci_locale.sh` dalla radice del worktree: `pnpm install --frozen-lockfile`, lint, typecheck, test, build.
- **Solo le parti toccate**: di default lint, typecheck, test e build girano sui pacchetti cambiati rispetto a
  `origin/main` e sui loro dipendenti. Se cambiano file della radice (`package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `tsconfig*`, configurazioni eslint/prettier/vitest, `samples/`, `scripts/ci_locale.sh`) gira tutto.
  `--completa` forza tutto: **obbligatoria per i rilasci** (`scripts/rilascia.sh`, prima della PR di rilascio).
- Lint e typecheck girano in parallelo; test e build aspettano il turno (lucchetto `.claude/ci-pesante.lock`): due CI
  di job diversi non partono insieme («Attendo il turno…»).
- **Una CI sola per job**: il flusso è `scripts/job.sh pr` (allinea, CI, push, PR con l'esito) poi `scripts/job.sh unisci`.
  Se la CI va bene su un worktree pulito, registra il tree verificato in `.claude/ci-ok-<ramo>` (fuori dal repository);
  `unisci` salta la CI se dopo l'allineamento HEAD ha lo stesso tree sulla stessa base, altrimenti la riesegue.
- Un esito precedente al rebase non vale: la CI si lancia dopo `allinea` (lo fanno `pr` e `unisci`). Modifiche non
  salvate dopo la CI annullano il salto: il commit successivo cambia il tree e la CI si rifà.
- Si salta solo per modifiche a soli documenti, skill o agenti (nessun file TypeScript, `package.json` o configurazione di build).
- Non c'è CI su GitHub: la CI è solo locale; nella PR si riporta l'esito di `ci_locale.sh`.

## Commit, PR, merge
- Commit e PR in italiano; il commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`,
  la PR con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- PR solo se Luca lo chiede (`scripts/job.sh pr`, che aggiunge da solo la riga finale e l'esito della CI); il merge di una PR solo con `scripts/job.sh unisci`, mai `gh pr merge` a mano.
- Mai push forzati. Su `main` solo push fast-forward dal worktree del job dopo la CI verde, come ha scelto Luca
  (2026-10-15), seguito da `job.sh chiudi`; PR e `job.sh unisci` quando li chiede.

## Versioni e rilasci
- **Versione unica** (semver `X.Y.Z`): il campo `version` del `package.json` **alla radice**. Conta solo quello: i
  `package.json` dei workspace restano a `0.0.0` (pacchetti privati, mai pubblicati; tenerli allineati sarebbe solo un
  secondo posto da dimenticare). Server (`dist/build-info.json`), portale (Vite), agente Node e agente C# la leggono da lì
  al build (`scripts/versione.mjs`), con il commit corto: `ARENALIVE_COMMIT` nei build Docker (non hanno `.git`) o `git`.
- **Ogni rilascio ha un tag annotato `vX.Y.Z` su `main`** e una release GitHub con le note del `CHANGELOG.md`; la
  produzione si aggiorna al tag (`scripts/aggiorna-produzione.sh vX.Y.Z`). Si sale di **patch** per correzioni, di
  **minor** per funzioni nuove compatibili, di **major** per cambi che rompono (contratti con gli agenti già installati,
  migrazioni non reversibili). Il lavoro di tutti i giorni non cambia versione: la cambia solo il rilascio.
- **Flusso**: job → `scripts/job.sh unisci` su `main` (come sopra) → quando si decide di rilasciare, da `main` pulito e
  allineato: `scripts/rilascia.sh X.Y.Z` (ramo `rilascio-X.Y.Z` in un worktree, versione, sezione del `CHANGELOG.md` con i
  titoli dei commit dal tag precedente, commit, push e PR) → merge della PR di rilascio (lo decide Luca) → `scripts/rilascia.sh --tagga X.Y.Z` (tag,
  push del tag, release GitHub) → aggiornamento della produzione. `--prova` mostra i controlli e i passi senza cambiare nulla.
  I controlli rifiutano un formato diverso da `X.Y.Z`, una versione non maggiore dell'ultimo tag, un `main` sporco o non
  allineato a `origin`.
- Il deploy e la distribuzione dell'eseguibile dell'agente li esegue Luca; Claude prepara gli script completi con le
  variabili in alto.
