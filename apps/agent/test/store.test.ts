import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchStore, newRecord } from '../src/store.js';
import { RotatingFileStream } from '../src/logger.js';
import { tempDirs } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('stato persistente', () => {
  it('salva e ricarica; un file rovinato viene messo da parte', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    const store = new MatchStore(dirs.home);
    await store.load();
    await store.save({ ...newRecord('abc'), nextSeq: 4, base: { header: 'H', lines: ['a'] } });
    await writeFile(join(store.dir, 'rotto.json'), '{');
    const again = new MatchStore(dirs.home);
    const warnings = await again.load();
    expect(warnings).toHaveLength(1);
    expect(again.get('abc')?.nextSeq).toBe(4);
    expect((await readdir(store.dir)).sort()).toEqual(['abc.json', 'rotto.json.corrupt']);
  });
});

describe('pulizia delle partite vecchie', () => {
  it('oltre retentionDays e con la coda vuota: non caricate e cancellate; con la coda restano', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    let now = Date.parse('2025-01-01T12:00:00Z');
    const clock = { days: 30, now: () => now };
    const store = new MatchStore(dirs.home, clock);
    await store.load();
    const request = {
      protocol: 1 as const,
      matchKey: 'con-coda',
      seq: 0,
      kind: 'snapshot' as const,
      fromIndex: 0,
      lines: [],
      header: 'H',
      contentHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    };
    await store.save(newRecord('vecchia'));
    await store.save({ ...newRecord('con-coda'), queue: [{ request, order: 0 }] });
    now += 29 * 86_400_000;
    await store.save(newRecord('recente'));
    now += 2 * 86_400_000;
    const again = new MatchStore(dirs.home, clock);
    const warnings = await again.load();
    expect(warnings.map((w) => w.reason)).toEqual(['partita non aggiornata da troppo tempo: stato cancellato']);
    expect(
      again
        .all()
        .map((r) => r.matchKey)
        .sort(),
    ).toEqual(['con-coda', 'recente']);
    expect((await readdir(store.dir)).sort()).toEqual(['con-coda.json', 'recente.json']);
  });
});

describe('log su file', () => {
  it('un file per giorno, nuova parte oltre la dimensione massima, vecchi giorni cancellati', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.root, { recursive: true });
    await writeFile(join(dirs.root, 'sir-agent-2020-01-01.log'), 'vecchio\n');
    let now = new Date('2025-01-18T10:00:00Z');
    const stream = new RotatingFileStream({ dir: dirs.root, maxBytes: 20, keepDays: 3, now: () => now });
    stream.write('riga uno lunga quanto basta\n');
    stream.write('riga due\n');
    now = new Date('2025-01-19T00:00:01Z');
    stream.write('giorno dopo\n');
    stream.close();
    expect((await readdir(dirs.root)).sort()).toEqual([
      'sir-agent-2025-01-18.1.log',
      'sir-agent-2025-01-18.log',
      'sir-agent-2025-01-19.log',
    ]);
  });
});
