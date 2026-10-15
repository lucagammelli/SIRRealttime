import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LockError, acquireLock, lockFile, waitForLock } from '../src/lock.js';
import { tempDirs } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function dataDir(): string {
  const dirs = tempDirs();
  cleanups.push(dirs.cleanup);
  return join(dirs.root, 'data');
}

describe('lucchetto dataDir/agent.lock', () => {
  it('scrive pid e ora di avvio; una seconda istanza viva è rifiutata', async () => {
    const dir = dataDir();
    const first = await acquireLock(dir, { pid: 1111, now: () => new Date('2026-10-15T08:00:00Z') });
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toEqual({
      pid: 1111,
      startedAt: '2026-10-15T08:00:00.000Z',
    });
    const second = acquireLock(dir, { pid: 2222, isAlive: (pid) => pid === 1111, bootTime: () => 0 });
    await expect(second).rejects.toBeInstanceOf(LockError);
    await expect(second).rejects.toThrow(/pid 1111/);
    await first.release();
    const third = await acquireLock(dir, { pid: 2222, isAlive: () => true, bootTime: () => 0 });
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toMatchObject({ pid: 2222 });
    await third.release();
  });

  it('lucchetto stantio (processo non più vivo) o illeggibile: sostituito', async () => {
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    await writeFile(lockFile(dir), JSON.stringify({ pid: 999_999, startedAt: '2026-01-01T00:00:00Z' }));
    const lock = await acquireLock(dir, { pid: 3333, isAlive: () => false });
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toMatchObject({ pid: 3333 });
    await lock.release();
    await writeFile(lockFile(dir), 'rotto');
    const again = await acquireLock(dir, { pid: 4444, isAlive: () => true });
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toMatchObject({ pid: 4444 });
    await again.release();
  });

  it('con il controllo predefinito un pid inesistente è stantio, un altro processo vivo no', async () => {
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    await writeFile(lockFile(dir), JSON.stringify({ pid: 2 ** 22 + 12_345, startedAt: new Date().toISOString() }));
    // Written by this process, which is alive: another pid is refused.
    const lock = await acquireLock(dir);
    await expect(acquireLock(dir, { pid: 2 ** 22 + 54_321 })).rejects.toThrow(new RegExp(`pid ${process.pid}`));
    await lock.release();
  });

  it('il lucchetto con il proprio pid è stantio (pid riassegnato dopo un riavvio)', async () => {
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    await writeFile(lockFile(dir), JSON.stringify({ pid: 4321, startedAt: new Date().toISOString() }));
    const lock = await acquireLock(dir, {
      pid: 4321,
      isAlive: () => true,
      now: () => new Date('2030-01-01T00:00:00Z'),
    });
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toEqual({
      pid: 4321,
      startedAt: '2030-01-01T00:00:00.000Z',
    });
    await lock.release();
  });

  it("lucchetto scritto prima dell'avvio del sistema (blackout): stantio anche se il pid è vivo", async () => {
    const dir = dataDir();
    await mkdir(dir, { recursive: true });
    const boot = Date.parse('2026-10-15T08:00:00Z');
    await writeFile(lockFile(dir), JSON.stringify({ pid: 1111, startedAt: '2026-10-14T20:00:00Z' }));
    const lock = await acquireLock(dir, { pid: 2222, isAlive: () => true, bootTime: () => boot });
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toMatchObject({ pid: 2222 });
    await lock.release();
    // Scritto dopo l'avvio (entro il margine): attivo.
    await writeFile(lockFile(dir), JSON.stringify({ pid: 1111, startedAt: '2026-10-15T07:59:30Z' }));
    await expect(acquireLock(dir, { pid: 2222, isAlive: () => true, bootTime: () => boot })).rejects.toBeInstanceOf(
      LockError,
    );
  });

  it('release non toglie il lucchetto di un altro processo', async () => {
    const dir = dataDir();
    const mine = await acquireLock(dir, { pid: 5555 });
    await writeFile(lockFile(dir), JSON.stringify({ pid: 6666, startedAt: '2026-01-01T00:00:00Z' }));
    await mine.release();
    expect(JSON.parse(await readFile(lockFile(dir), 'utf8'))).toMatchObject({ pid: 6666 });
  });

  it('waitForLock: avvisa una volta, prende il lucchetto quando si libera, null se fermato', async () => {
    const dir = dataDir();
    const held = await acquireLock(dir, { pid: 7777 });
    const waits: number[] = [];
    const stop = new AbortController();
    const waiting = waitForLock(dir, {
      pid: 8888,
      isAlive: () => true,
      signal: stop.signal,
      retryMs: 10,
      onWait: (pid) => waits.push(pid),
    });
    await new Promise((r) => setTimeout(r, 60));
    await held.release();
    const lock = await waiting;
    expect(lock).not.toBeNull();
    expect(waits).toEqual([7777]);
    const blocked = waitForLock(dir, { pid: 9999, isAlive: () => true, signal: stop.signal, retryMs: 10 });
    stop.abort();
    expect(await blocked).toBeNull();
    await lock?.release();
  });
});
