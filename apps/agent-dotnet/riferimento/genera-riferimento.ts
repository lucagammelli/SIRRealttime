/**
 * Reference of the Node agent for the tests of the C# agent: for some files derived from the example
 * `packages/dvw-parser/test/fixtures/partita.dvw` (encodings, line endings, truncations, odd spaces), what the Node
 * agent computes (decoded header and scout lines, matchKey, suspicion, planned requests with seq-free content hash).
 * The C# tests (`tests/SirAgent.Core.Tests/RiferimentoNodeTests.cs`) must give the same results.
 *
 * Uso (dalla radice del repository, dopo pnpm install):
 *   pnpm --filter @sir/agent exec tsx --conditions=@sir/source ../agent-dotnet/riferimento/genera-riferimento.ts
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bytesHash, deriveMatchKey, readDvw, suspicion } from '../../agent/src/dvw.ts';
import type { DvwContent } from '../../agent/src/dvw.ts';
import { planRequests } from '../../agent/src/sync.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const source = join(root, 'packages', 'dvw-parser', 'test', 'fixtures', 'partita.dvw');
const output = join(import.meta.dirname, '..', 'tests', 'SirAgent.Core.Tests', 'riferimento-node.json');

/** Windows-1252 encoding of a text that only uses characters of the code page (the fixture does). */
function win1252(text: string): Buffer {
  const reverse = new Map<string, number>();
  const table = new TextDecoder('windows-1252');
  for (let b = 0; b < 256; b++) reverse.set(table.decode(Uint8Array.of(b)), b);
  return Buffer.from([...text].map((c) => reverse.get(c) ?? 0x3f));
}

interface Case {
  name: string;
  filePath: string;
  bytes: Buffer;
  /** Plans computed with these bases (null = first send); `maxLines` splits long requests. */
  maxLines?: number;
}

const original = await readFile(source);
const text = new TextDecoder('windows-1252').decode(original);
const scoutAt = text.indexOf('[3SCOUT]');
const head = text.slice(0, scoutAt);
const scout = text.slice(scoutAt);
const lf = text.replace(/\r\n/g, '\n');

const cases: Case[] = [
  { name: 'originale-windows-1252', filePath: 'E:\\partita.dvw', bytes: original },
  {
    name: 'utf8-con-bom',
    filePath: 'E:\\partita.dvw',
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lf, 'utf8')]),
  },
  { name: 'utf8-crlf', filePath: 'E:\\partita.dvw', bytes: Buffer.from(lf.replace(/\n/g, '\r\n'), 'utf8') },
  { name: 'solo-cr', filePath: 'E:\\partita.dvw', bytes: win1252(lf.replace(/\n/g, '\r')) },
  { name: 'troncato-a-meta-riga', filePath: 'E:\\partita.dvw', bytes: original.subarray(0, original.length - 25) },
  { name: 'senza-scout', filePath: 'E:\\partita.dvw', bytes: win1252(head) },
  { name: 'vuoto', filePath: 'E:\\partita.dvw', bytes: Buffer.alloc(0) },
  {
    name: 'byte-non-definiti-in-1252',
    filePath: 'E:\\partita.dvw',
    bytes: Buffer.concat([
      win1252(head),
      Buffer.from([0x81, 0x8d, 0x8f, 0x90, 0x9d, 0x80, 0x9f, 0x0a]),
      win1252(scout),
    ]),
  },
  {
    name: 'utf8-con-bom-troncato-nel-carattere',
    filePath: 'E:\\partita.dvw',
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(lf, 'utf8'), Buffer.from([0xc3])]),
  },
  {
    name: 'senza-data-chiave-dal-nome',
    filePath: 'E:\\Partite\\Città ﬁnale ß Ùno.DVW',
    bytes: win1252(lf.replace(/^10\/01\/2026;18\.00\.00;/m, ';;')),
  },
  {
    name: 'senza-data-percorso-con-barre',
    filePath: 'C:/dati/scout/gara_01.dvw',
    bytes: win1252(lf.replace(/^10\/01\/2026;18\.00\.00;/m, ' ; ;')),
  },
  {
    name: 'spazi-strani',
    filePath: 'E:\\partita.dvw',
    bytes: Buffer.from(
      lf
        .replace('10/01/2026;18.00.00;', ' 10/01/2026\t;  18.00.00 ;')
        .replace('PCI;', 'P\u00a0C  I;')
        .replace('OSP;', '\u3000Osp ;')
        .replace('[3SCOUT]\n', ' \t[3SCOUT]\t\n   \n')
        .replace(/\n$/, '\n \t \n'),
      'utf8',
    ),
  },
  {
    name: 'marcatore-dopo-separatore-unicode',
    filePath: 'E:\\partita.dvw',
    bytes: Buffer.from(lf.replace('[3RESERVE]\n[3SCOUT]', '[3RESERVE]\u2028[3SCOUT]'), 'utf8'),
  },
  {
    name: 'minuscole-speciali',
    filePath: 'E:\\partita.dvw',
    bytes: Buffer.from(lf.replace('PCI;', 'İSTANBUL ΟΔΟΣ;').replace('OSP;', 'ΣΑΣ ΣΟΦΙΑΣ.;'), 'utf8'),
  },
  {
    name: 'minuscole-speciali-nome-file',
    filePath: 'E:\\İzmir ΟΔΟΣ.dvw',
    bytes: win1252(lf.replace(/^10\/01\/2026;18\.00\.00;/m, ';;')),
  },
  {
    name: 'lungo-diviso',
    filePath: 'E:\\partita.dvw',
    bytes: win1252(lf + scout.split('\n').slice(1).join('\n').repeat(2)),
    maxLines: 7,
  },
];

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

async function plans(content: DvwContent, maxLines: number | undefined): Promise<Record<string, unknown>> {
  const lines = content.lines;
  const bases: Record<string, DvwContent | null> = {
    nessuna: null,
    prefisso: { header: content.header, lines: lines.slice(0, Math.max(0, lines.length - 3)) },
    uguale: { header: content.header, lines },
    headerCambiato: { header: `${content.header}X`, lines },
    rigaCambiata: { header: content.header, lines: lines.map((l, i) => (i === 1 ? `${l}~` : l)) },
    piuLunga: { header: content.header, lines: [...lines, 'riga in più'] },
  };
  const out: Record<string, unknown> = {};
  for (const [name, base] of Object.entries(bases)) {
    for (const force of [false, true]) {
      const planned = await planRequests(base, content, force, maxLines);
      out[`${name}${force ? '+forza' : ''}`] = {
        suspicion: suspicion({ content, endsWithNewline: true }, base),
        requests: planned.map((p) => ({
          kind: p.kind,
          fromIndex: p.fromIndex,
          lineCount: p.lines.length,
          linesSha256: sha(p.lines.join('\n')),
          headerSha256: p.header === undefined ? null : sha(p.header),
          contentHash: p.contentHash,
        })),
      };
    }
  }
  return out;
}

const results = [];
for (const c of cases) {
  const read = readDvw(c.bytes);
  const entry: Record<string, unknown> = {
    name: c.name,
    filePath: c.filePath,
    bytesBase64: c.bytes.toString('base64'),
    bytesHash: bytesHash(c.bytes),
    maxLines: c.maxLines ?? null,
  };
  if (read.kind === 'incomplete') {
    entry['incomplete'] = read.reason;
  } else {
    entry['header'] = read.content.header;
    entry['headerSha256'] = sha(read.content.header);
    entry['lines'] = read.content.lines;
    entry['endsWithNewline'] = read.endsWithNewline;
    entry['matchKey'] = deriveMatchKey(read.content.header, c.filePath);
    entry['suspicionWithoutBase'] = suspicion(read, null);
    entry['plans'] = await plans(read.content, c.maxLines);
  }
  results.push(entry);
}

await writeFile(
  output,
  `${JSON.stringify({ source: 'packages/dvw-parser/test/fixtures/partita.dvw', cases: results }, null, 2)}\n`,
);
console.log(`scritto ${output} (${results.length} casi)`);
