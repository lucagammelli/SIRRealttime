// Scrive {"version","commit"} nel file indicato (build del server: dist/build-info.json). Uso: node scrivi-versione.mjs <file>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { leggiCommit, leggiVersione } from './versione.mjs';

const uscita = process.argv[2];
if (!uscita) {
  console.error('Uso: node scrivi-versione.mjs <file>');
  process.exit(1);
}
const file = resolve(uscita);
mkdirSync(dirname(file), { recursive: true });
const commit = leggiCommit();
writeFileSync(file, `${JSON.stringify({ version: leggiVersione(), ...(commit ? { commit } : {}) })}\n`);
