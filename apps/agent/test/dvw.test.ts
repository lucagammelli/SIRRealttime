import { generateMatch, renderDvw } from '@arenalive/dvw-simulator';
import { describe, expect, it } from 'vitest';
import { MatchKeySchema } from '@arenalive/shared';
import { deriveMatchKey, readDvw, suspicion } from '../src/dvw.js';

const match = generateMatch({ seed: 3 });
const headerAt = (m: typeof match, n: number): string => {
  const r = readDvw(renderDvw(m, n));
  if (r.kind !== 'content') throw new Error('incomplete');
  return r.content.header;
};

describe('matchKey', () => {
  it('stabile tra le riscritture dello stesso file (punteggi e set cambiano)', () => {
    const k0 = deriveMatchKey(headerAt(match, 0), 'E:\\partita.dvw');
    const kEnd = deriveMatchKey(headerAt(match, match.lines.length), 'E:\\altro-nome.dvw');
    expect(kEnd).toBe(k0);
    expect(MatchKeySchema.safeParse(k0).success).toBe(true);
    expect(k0).toBe(k0.toLowerCase());
  });

  it('diversa per un’altra partita (altra data/ora o altre squadre)', () => {
    const other = generateMatch({ seed: 3, startTime: '2025-02-01T20:30:00Z' });
    const otherTeams = generateMatch({ seed: 3, homeName: 'Robur Ravenna', awayName: 'Cus Bologna' });
    const k = deriveMatchKey(headerAt(match, 10), 'a.dvw');
    expect(deriveMatchKey(headerAt(other, 10), 'a.dvw')).not.toBe(k);
    expect(deriveMatchKey(headerAt(otherTeams, 10), 'a.dvw')).not.toBe(k);
  });

  it('senza [3MATCH] usa il nome del file', () => {
    const header = '[3DATAVOLLEYSCOUT]\nFILEFORMAT: 2.0\n';
    const a = deriveMatchKey(header, 'E:\\Finale Coppa.dvw');
    expect(a).toMatch(/^file_finale-coppa_[0-9a-f]{10}$/);
    expect(deriveMatchKey(header, 'E:\\Semifinale.dvw')).not.toBe(a);
    expect(MatchKeySchema.safeParse(a).success).toBe(true);
  });
});

describe('lettura del file', () => {
  const full = renderDvw(match, 100);

  it('file completo: header e righe scout', () => {
    const r = readDvw(full);
    expect(r.kind).toBe('content');
    if (r.kind !== 'content') return;
    expect(r.content.lines).toHaveLength(100);
    expect(r.endsWithNewline).toBe(true);
    expect(suspicion(r, null)).toBeNull();
  });

  it('vuoto o senza [3SCOUT]: incompleto, mai inviato', () => {
    expect(readDvw(new Uint8Array()).kind).toBe('incomplete');
    expect(readDvw(full.subarray(0, 200)).kind).toBe('incomplete');
  });

  it('troncato a metà di una riga o con righe in meno: sospetto', () => {
    const r = readDvw(full);
    if (r.kind !== 'content') throw new Error('incomplete');
    const half = readDvw(full.subarray(0, full.length - 7));
    if (half.kind !== 'content') throw new Error('incomplete');
    expect(suspicion(half, r.content)).toMatch(/a capo finale/);
    const shorter = readDvw(renderDvw(match, 60));
    if (shorter.kind !== 'content') throw new Error('incomplete');
    expect(suspicion(shorter, r.content)).toMatch(/diminuite da 100 a 60/);
    expect(suspicion(r, shorter.content)).toBeNull();
  });
});
