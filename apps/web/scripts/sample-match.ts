/**
 * Writes the example match of the editor «Pagina pubblica» (src/blocks/sampleMatch.json): the synthetic match of the
 * tests (simulator, seed 1) in the second set. Run it again when the shape of MatchState changes (a test says so):
 *
 *   pnpm --filter @sir/web sample-match
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { midMatchState } from '../src/test/fixtures.ts';

const target = fileURLToPath(new URL('../src/blocks/sampleMatch.json', import.meta.url));
await writeFile(target, `${JSON.stringify(midMatchState())}\n`);
console.log(`Partita d'esempio scritta in ${target}`);
