import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeDvw, parseDvw } from '@sir/dvw-parser';
import { generateMatch, play } from '@sir/dvw-simulator';
import type { IngestRequest } from '@sir/shared';
import { hashScoutLines, splitDvwText } from '@sir/shared';
import { computeMatchState } from '@sir/volley-stats';
import { afterEach, describe, expect, it } from 'vitest';
import type { LiveServer } from './support.js';
import {
  agentConfig,
  memoryLogger,
  recordingFetch,
  runAgent,
  serverMatches,
  startLiveServer,
  tempDirs,
  waitFor,
} from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

/** No snapshot ever removed lines: the simulator only adds or corrects rows. */
function expectNoDestructiveSnapshot(requests: IngestRequest[]): void {
  let count = 0;
  for (const r of requests) {
    if (r.kind === 'snapshot') {
      expect(r.lines.length).toBeGreaterThanOrEqual(count);
      count = r.lines.length;
    } else {
      count = Math.max(count, r.fromIndex + r.lines.length);
    }
  }
}

async function expectServerMatchesFile(server: LiveServer, file: string): Promise<void> {
  const bytes = await readFile(file);
  const { scoutLines } = splitDvwText(decodeDvw(bytes));
  const hash = await hashScoutLines(scoutLines);
  await waitFor(
    async () => (await serverMatches(server)).some((m) => m.contentHash === hash),
    20_000,
    'righe sul server',
  );
  const [m, ...others] = await serverMatches(server);
  expect(others).toHaveLength(0);
  expect(m?.lineCount).toBe(scoutLines.length);
  const expected: unknown = JSON.parse(JSON.stringify(computeMatchState(parseDvw(bytes))));
  expect(m?.state).toEqual(expected);
}

describe.each(['atomic', 'direct'] as const)('e2e con il simulatore in modalità %s', (mode) => {
  it('lo stato del server coincide con quello del file finale, correzioni comprese', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    const server = await startLiveServer();
    cleanups.push(() => server.close());
    const { logger, entries } = memoryLogger();
    const rec = recordingFetch();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), logger, { fetch: rec.fetch });
    cleanups.push(() => running.stop());

    const match = generateMatch({ seed: mode === 'atomic' ? 11 : 12 });
    const out = join(dirs.stick, 'partita.dvw');
    await play(match, { out, speed: 1500, mode, corrections: true, seed: 5 });

    await expectServerMatchesFile(server, out);
    await waitFor(() => running.agent.status().queue === 0, 5000, 'coda vuota');
    // Several deliveries during the match, not only one at the end.
    expect(rec.requests.length).toBeGreaterThan(1);
    expectNoDestructiveSnapshot(rec.requests);
    expect(entries.filter((e) => e.level >= 50)).toEqual([]);
  }, 60_000);
});
