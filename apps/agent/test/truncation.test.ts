import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateMatch, renderDvw } from '@arenalive/dvw-simulator';
import { afterEach, describe, expect, it } from 'vitest';
import { Agent } from '../src/agent.js';
import {
  FAST_TIMING,
  agentConfig,
  memoryLogger,
  recordingFetch,
  serverMatches,
  startLiveServer,
  tempDirs,
} from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const match = generateMatch({ seed: 31 });

/** Agent driven by hand with a fake clock: every `settle` is a stable read (stableMs 20) and a delivery. */
async function setup() {
  const dirs = tempDirs();
  cleanups.push(dirs.cleanup);
  await mkdir(dirs.stick, { recursive: true });
  const server = await startLiveServer();
  cleanups.push(() => server.close());
  const rec = recordingFetch();
  const { logger, entries } = memoryLogger();
  let clock = 1_000_000;
  const agent = await Agent.create({
    config: agentConfig(dirs, server.url, server.token),
    logger,
    timing: FAST_TIMING,
    fetch: rec.fetch,
    now: () => clock,
  });
  const settle = async (): Promise<void> => {
    await agent.step();
    clock += 30;
    await agent.step();
  };
  const lineCount = async (): Promise<number | undefined> => (await serverMatches(server))[0]?.lineCount;
  return { file: join(dirs.stick, 'partita.dvw'), agent, rec, entries, settle, lineCount };
}

describe('file troncato', () => {
  it('lettura a metà (modalità direct): nessuno snapshot distruttivo, poi solo l’append', async () => {
    const t = await setup();
    await writeFile(t.file, renderDvw(match, 100));
    await t.settle();
    expect(await t.lineCount()).toBe(100);

    const next = renderDvw(match, 101);
    await writeFile(t.file, next.subarray(0, next.length - 1500)); // cut inside the scout section, mid-line
    await t.settle();
    expect(t.rec.requests).toHaveLength(1);
    expect(t.entries.some((e) => e.msg === 'contenuto da confermare con una seconda lettura')).toBe(true);

    await writeFile(t.file, next);
    await t.settle();
    expect(await t.lineCount()).toBe(101);
    expect(t.rec.requests.map((r) => [r.kind, r.fromIndex, r.lines.length])).toEqual([
      ['snapshot', 0, 100],
      ['append', 100, 1],
    ]);
  });

  it('troncato prima di [3SCOUT]: mai inviato, anche se resta così', async () => {
    const t = await setup();
    await writeFile(t.file, renderDvw(match, 50));
    await t.settle();
    await writeFile(t.file, renderDvw(match, 51).subarray(0, 300));
    for (let i = 0; i < 5; i++) await t.settle();
    expect(t.rec.requests).toHaveLength(1);
    expect(await t.lineCount()).toBe(50);
    expect(t.agent.status().lines).toBe(50);
  });

  it('righe cancellate davvero dallo scoutman: inviate dopo due letture stabili uguali', async () => {
    const t = await setup();
    await writeFile(t.file, renderDvw(match, 80));
    await t.settle();
    await writeFile(t.file, renderDvw(match, 75));
    await t.settle();
    expect(await t.lineCount()).toBe(80);
    await t.settle();
    expect(await t.lineCount()).toBe(75);
    expect(t.rec.requests.map((r) => [r.kind, r.lines.length])).toEqual([
      ['snapshot', 80],
      ['snapshot', 75],
    ]);
  });

  it('--once: legge quando è stabile, invia e restituisce 0', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    const server = await startLiveServer();
    cleanups.push(() => server.close());
    await writeFile(join(dirs.stick, 'partita.dvw'), renderDvw(match, 42));
    const agent = await Agent.create({
      config: agentConfig(dirs, server.url, server.token),
      logger: memoryLogger().logger,
      timing: FAST_TIMING,
    });
    expect(await agent.runOnce(5000)).toBe(0);
    expect((await serverMatches(server))[0]?.lineCount).toBe(42);
    const empty = tempDirs();
    cleanups.push(empty.cleanup);
    const none = await Agent.create({
      config: agentConfig(empty, server.url, server.token),
      logger: memoryLogger().logger,
      timing: FAST_TIMING,
    });
    expect(await none.runOnce(200)).toBe(3);
  });
});
