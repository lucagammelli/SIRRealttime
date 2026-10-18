// Unica fonte della versione di SIRRealtime: il campo "version" del package.json alla radice (docs/regole/test-job-rilasci.md).
// Lo usano il build del server (scripts/scrivi-versione.mjs), la configurazione di Vite del portale e scripts/rilascia.sh.
// Il commit corto viene da SIR_COMMIT (build Docker, dove non c'è .git) oppure da git; senza nessuno dei due è assente.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RADICE = fileURLToPath(new URL('..', import.meta.url));
const SEMVER = /^\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

/** Versione della radice (a.b.c); errore se manca o non è nel formato. */
export function leggiVersione() {
  const pkg = JSON.parse(readFileSync(`${RADICE}package.json`, 'utf8'));
  if (typeof pkg.version !== 'string' || !SEMVER.test(pkg.version)) {
    throw new Error(`"version" del package.json alla radice non valida: ${String(pkg.version)}`);
  }
  return pkg.version;
}

/** Commit corto (esadecimale) da SIR_COMMIT o da git, oppure stringa vuota. */
export function leggiCommit() {
  const daAmbiente = (process.env.SIR_COMMIT ?? '').trim().toLowerCase();
  if (COMMIT.test(daAmbiente)) return daAmbiente;
  try {
    const out = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: RADICE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return COMMIT.test(out) ? out : '';
  } catch {
    return '';
  }
}

// Da riga di comando: `node scripts/versione.mjs` stampa la versione, `... commit` il commit corto.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${process.argv[2] === 'commit' ? leggiCommit() : leggiVersione()}\n`);
}
