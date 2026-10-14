# Regole: codice TypeScript

## Struttura
- Monorepo pnpm: `apps/*`, `packages/*`, `tools/*`. Ogni pacchetto ha `package.json` con nome `@sir/<nome>`,
  script `build`, `test`, `lint`, `typecheck` (anche se vuoti), e dipende dagli altri con `workspace:*`.
- `tsconfig.base.json` alla radice (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, ESM, target ES2023);
  ogni pacchetto lo estende.
- Node 24, ESM (`"type": "module"`). pnpm via corepack, versione fissata in `packageManager` del `package.json` radice.

## Stile
- ESLint (flat config) + Prettier alla radice; nessuna regola disattivata senza commento che spiega perché.
- Niente `any` (usa `unknown` + zod o type guard). Niente `!` non motivati.
- Errori: classi d'errore con codice; nei punti di confine (ingest, file system, rete) si logga e si recupera,
  mai crash del processo per un dato sbagliato.
- Log strutturati con `pino` (server e agente).
- Date: ISO 8601 UTC nei messaggi; l'ora locale solo a video.

## Dipendenze
- Prima di aggiungerne una, verifica che non ci sia già qualcosa nel monorepo che fa lo stesso.
- Versioni esatte nel lockfile; `pnpm install --frozen-lockfile` in CI.
- Librerie scelte: zod, fastify, @fastify/websocket, drizzle-orm + pg, argon2, pino, chokidar, iconv-lite,
  react, vite, echarts, tailwindcss, vitest. Alternative solo motivandole nel rapporto.

## Test
- vitest; i test stanno accanto al codice (`*.test.ts`) o in `test/` del pacchetto.
- Parser e statistiche: test su righe reali/sintetiche, casi limite, righe malformate.
- Server: test dell'ingest (append, snapshot, duplicati, seq fuori ordine) con DB di test isolato
  (Postgres via Docker o pg-mem dove basta), mai il DB di sviluppo.
