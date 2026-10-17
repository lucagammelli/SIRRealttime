import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWatcher } from '../src/watcher.js';
import type { WatchEvent } from '../src/watcher.js';

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop() ?? '', { recursive: true, force: true });
});

async function tempFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sir-watcher-'));
  dirs.push(dir);
  return join(dir, 'partita.dvw');
}

/**
 * The file rewritten (one byte longer) every `writeEveryMs`, polled every `pollMs` on a fake clock for `forMs`:
 * the times of the reads.
 */
async function reads(watcher: FileWatcher, file: string, writeEveryMs: number, pollMs: number, forMs: number) {
  const at: number[] = [];
  let content = 'x';
  let nextWrite = 0;
  for (let now = 0; now <= forMs; now += pollMs) {
    if (now >= nextWrite) {
      content += 'x';
      await writeFile(file, content);
      nextWrite += writeEveryMs;
    }
    const event: WatchEvent = await watcher.poll(now);
    if (event.type === 'read') at.push(now);
  }
  return at;
}

describe('FileWatcher: file che cambia di continuo', () => {
  it('senza attesa massima un file riscritto più spesso di stableMs non viene mai letto', async () => {
    const file = await tempFile();
    const watcher = new FileWatcher(file, { stableMs: 700, rereadMs: 60_000 });
    expect(await reads(watcher, file, 500, 250, 10_000)).toEqual([]);
  });

  it('con attesa massima lo legge comunque, al più maxWaitMs dopo la prima modifica vista', async () => {
    const file = await tempFile();
    const watcher = new FileWatcher(file, { stableMs: 700, rereadMs: 60_000, maxWaitMs: 2000 });
    const at = await reads(watcher, file, 500, 250, 10_000);
    expect(at.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < at.length; i++) expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeLessThanOrEqual(2000 + 500);
  });

  it('un file stabile si legge dopo stableMs come prima, una volta sola', async () => {
    const file = await tempFile();
    await writeFile(file, 'contenuto');
    const watcher = new FileWatcher(file, { stableMs: 700, rereadMs: 60_000, maxWaitMs: 2000 });
    const events: string[] = [];
    for (let now = 0; now <= 5000; now += 250) events.push((await watcher.poll(now)).type);
    expect(events.filter((e) => e === 'read')).toHaveLength(1);
    expect(events.indexOf('read')).toBe(3);
  });

  it('attesa massima sotto stableMs: ignorata', async () => {
    const file = await tempFile();
    const watcher = new FileWatcher(file, { stableMs: 700, rereadMs: 60_000, maxWaitMs: 100 });
    expect(await reads(watcher, file, 500, 250, 5000)).toEqual([]);
  });
});
