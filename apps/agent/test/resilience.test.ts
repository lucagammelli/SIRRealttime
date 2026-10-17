import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeDvw } from '@sir/dvw-parser';
import type { GeneratedMatch } from '@sir/dvw-simulator';
import { applyCorrection, generateMatch, renderDvw } from '@sir/dvw-simulator';
import { AGENT_EXPIRED_ERROR, hashScoutLines, splitDvwText } from '@sir/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { agents } from '../../server/src/db/index.js';
import { createAgent, startServer } from '../../server/test/helpers.js';
import type { TestServer } from '../../server/test/helpers.js';
import type { FetchLike } from '../src/sender.js';
import type { LiveServer } from './support.js';
import {
  agentConfig,
  freePort,
  memoryLogger,
  recordingFetch,
  runAgent,
  serverMatches,
  startLiveServer,
  tempDirs,
  waitFor,
  wipeMatches,
} from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const match = generateMatch({ seed: 21 });

async function writeDvw(file: string, m: GeneratedMatch, n: number): Promise<void> {
  await writeFile(`${file}.tmp`, renderDvw(m, n));
  await rename(`${file}.tmp`, file);
}

const hashAt = (m: GeneratedMatch, n: number): Promise<string> =>
  hashScoutLines(splitDvwText(decodeDvw(renderDvw(m, n))).scoutLines);

async function waitServerAt(server: TestServer, m: GeneratedMatch, n: number, timeoutMs = 15_000): Promise<void> {
  const hash = await hashAt(m, n);
  await waitFor(
    async () => (await serverMatches(server)).some((x) => x.contentHash === hash && x.lineCount === n),
    timeoutMs,
    `server con ${n} righe`,
  );
}

async function setup(): Promise<{ dirs: ReturnType<typeof tempDirs>; file: string }> {
  const dirs = tempDirs();
  cleanups.push(dirs.cleanup);
  await mkdir(dirs.stick, { recursive: true });
  return { dirs, file: join(dirs.stick, 'partita.dvw') };
}

async function live(): Promise<LiveServer> {
  const server = await startLiveServer();
  cleanups.push(() => server.close());
  return server;
}

describe('sincronizzazione', () => {
  it('righe nuove come append, header solo quando cambia, nulla se il file non cambia', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const rec = recordingFetch();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), memoryLogger().logger, {
      fetch: rec.fetch,
    });
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 10);
    await waitServerAt(server, match, 10);
    await writeDvw(file, match, 25);
    await waitServerAt(server, match, 25);
    await writeDvw(file, match, 25); // same content, new mtime
    await new Promise((r) => setTimeout(r, 150));
    expect(rec.requests.map((r) => [r.kind, r.fromIndex, r.lines.length, r.seq])).toEqual([
      ['snapshot', 0, 10, 0],
      ['append', 10, 15, 1],
    ]);
    expect(rec.requests[0]?.header).toBeDefined();
    const sameHeader =
      splitDvwText(decodeDvw(renderDvw(match, 10))).header === splitDvwText(decodeDvw(renderDvw(match, 25))).header;
    expect(rec.requests[1]?.header === undefined).toBe(sameHeader);
  });
});

describe('rete e server', () => {
  it('server non raggiungibile per un po’: la coda viene consegnata dopo, senza duplicati né righe perse', async () => {
    const { dirs, file } = await setup();
    const port = await freePort();
    const server = await startServer();
    cleanups.push(() => server.close());
    const token = await createAgent(server);
    const rec = recordingFetch();
    const { logger, entries } = memoryLogger();
    const running = await runAgent(agentConfig(dirs, `http://127.0.0.1:${port}`, token), logger, { fetch: rec.fetch });
    cleanups.push(() => running.stop());

    for (const n of [10, 30, 45]) {
      await writeDvw(file, match, n);
      await waitFor(() => running.agent.status().lines === n, 5000, `lettura di ${n} righe`);
    }
    const corrected = applyCorrection(match, 20, 99, 45);
    await writeDvw(file, corrected, 60);
    await waitFor(() => running.agent.status().lines === 60, 5000, 'lettura della correzione');
    expect(running.agent.status().queue).toBeGreaterThanOrEqual(3);
    expect(running.agent.status().serverReachable).toBe(false);
    expect(entries.filter((e) => e.msg.includes('non raggiungibile'))).toHaveLength(1);

    await server.app.listen({ host: '127.0.0.1', port });
    await waitServerAt(server, corrected, 60);
    await waitFor(() => running.agent.status().queue === 0, 5000, 'coda vuota');
    const [m] = await serverMatches(server);
    expect(m?.lineCount).toBe(60);
    // Every seq delivered at most once with status ok (same seq again only after a network error).
    const seqs = rec.requests.map((r) => r.seq);
    expect([...new Set(seqs)].sort((a, b) => a - b)).toEqual([...new Set(seqs)]);
  });

  it('coda lunga compattata in uno snapshot, poi consegnata', async () => {
    const { dirs, file } = await setup();
    const port = await freePort();
    const server = await startServer();
    cleanups.push(() => server.close());
    const token = await createAgent(server);
    const rec = recordingFetch();
    const running = await runAgent(agentConfig(dirs, `http://127.0.0.1:${port}`, token), memoryLogger().logger, {
      fetch: rec.fetch,
      timing: { compactThreshold: 3 },
    });
    cleanups.push(() => running.stop());
    for (const n of [5, 10, 15, 20, 25]) {
      await writeDvw(file, match, n);
      await waitFor(() => running.agent.status().lines === n, 5000, `lettura di ${n} righe`);
    }
    expect(running.agent.status().queue).toBeLessThanOrEqual(3);
    const before = rec.requests.length;
    await server.app.listen({ host: '127.0.0.1', port });
    await waitServerAt(server, match, 25);
    const delivered = rec.requests.slice(before);
    expect(delivered[0]?.kind).toBe('snapshot');
    expect(delivered[0]?.seq).toBeGreaterThan(0);
  });

  it('riavvio con la coda piena: il nuovo processo riprende dalla coda su disco', async () => {
    const { dirs, file } = await setup();
    const port = await freePort();
    const server = await startServer();
    cleanups.push(() => server.close());
    const token = await createAgent(server);
    const config = agentConfig(dirs, `http://127.0.0.1:${port}`, token);

    const first = await runAgent(config, memoryLogger().logger);
    await writeDvw(file, match, 15);
    await waitFor(() => first.agent.status().lines === 15, 5000, 'prima lettura');
    await writeDvw(file, match, 40);
    await waitFor(() => first.agent.status().lines === 40, 5000, 'seconda lettura');
    await first.stop();
    expect(await readdir(join(config.dataDir, 'matches'))).toHaveLength(1);

    // The stick is gone: only the persisted queue can bring the data to the server.
    await rm(dirs.stick, { recursive: true });
    await server.app.listen({ host: '127.0.0.1', port });
    const { logger, entries } = memoryLogger();
    const second = await runAgent(config, logger);
    cleanups.push(() => second.stop());
    expect(entries.some((e) => e.msg === 'coda ripresa dal disco' && e['queue'] === 2)).toBe(true);
    await waitServerAt(server, match, 40);
    await waitFor(() => second.agent.status().queue === 0, 5000, 'coda vuota');
  });

  it('DB del server azzerato: needSnapshot e riallineamento con uno snapshot', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const rec = recordingFetch();
    const { logger, entries } = memoryLogger();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), logger, { fetch: rec.fetch });
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 40);
    await waitServerAt(server, match, 40);
    await wipeMatches(server);
    await writeDvw(file, match, 50);
    await waitServerAt(server, match, 50);
    expect(rec.requests.map((r) => [r.kind, r.fromIndex, r.lines.length])).toEqual([
      ['snapshot', 0, 40],
      ['append', 40, 10],
      ['snapshot', 0, 50],
    ]);
    expect(entries.some((e) => e.msg.includes('server non allineato') && e['status'] === 'needSnapshot')).toBe(true);
  });

  it('stato dell’agente perso (seq ripartito da 0): il duplicato diverso porta a uno snapshot con seq nuovo', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const config = agentConfig(dirs, server.url, server.token);
    const first = await runAgent(config, memoryLogger().logger);
    for (const n of [10, 20, 30]) {
      await writeDvw(file, match, n);
      await waitServerAt(server, match, n);
    }
    await first.stop();
    await rm(config.dataDir, { recursive: true });
    const rec = recordingFetch();
    const second = await runAgent(config, memoryLogger().logger, { fetch: rec.fetch });
    cleanups.push(() => second.stop());
    await waitFor(() => rec.requests.length === 2 && second.agent.status().queue === 0, 5000, 'riallineamento');
    await writeDvw(file, match, 35);
    await waitServerAt(server, match, 35);
    expect(rec.requests.map((r) => [r.kind, r.seq])).toEqual([
      ['snapshot', 0],
      ['snapshot', 3],
      ['append', 4],
    ]);
  });

  it('token revocato: errore chiaro nel log, coda conservata, consegna quando il token torna valido', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const { logger, entries, raw } = memoryLogger();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), logger);
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 20);
    await waitServerAt(server, match, 20);

    await server.database.db.update(agents).set({ revoked: true });
    await writeDvw(file, match, 30);
    await waitFor(() => entries.some((e) => e.msg.includes('token agente non valido o revocato')), 5000, 'log 401');
    await new Promise((r) => setTimeout(r, 400)); // a few pauses of 150 ms
    expect(running.agent.status().queue).toBe(1);
    expect((await serverMatches(server))[0]?.lineCount).toBe(20);
    expect(entries.filter((e) => e.msg.includes('token agente non valido')).every((e) => e.level === 50)).toBe(true);

    await server.database.db.update(agents).set({ revoked: false });
    await waitServerAt(server, match, 30);
    expect(raw.join('')).not.toContain(server.token);
  });
});

describe('registrazione scaduta', () => {
  it('401 per registrazione scaduta: «Registrazione scaduta: registrati di nuovo» nello stato e nel log', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const { logger, entries } = memoryLogger();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), logger);
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 20);
    await waitServerAt(server, match, 20);
    expect(running.agent.status().registrationExpired).toBe(false);

    await server.database.db.update(agents).set({ expiresAt: new Date(Date.now() - 1000) });
    await writeDvw(file, match, 30);
    await waitFor(() => running.agent.status().registrationExpired, 5000, 'registrazione scaduta');
    expect(entries.some((e) => e.msg.includes(AGENT_EXPIRED_ERROR))).toBe(true);
    expect(running.agent.status().queue).toBe(1);

    // Prolungata dal portale: riparte da sola.
    await server.database.db.update(agents).set({ expiresAt: null });
    await waitServerAt(server, match, 30);
    await waitFor(() => !running.agent.status().registrationExpired, 5000, 'registrazione di nuovo valida');
  });
});

describe('risposte 4xx', () => {
  it('413: log chiaro, messaggio scartato, alla modifica successiva parte uno snapshot', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const rec = recordingFetch();
    let refuse = false;
    const fetchImpl: FetchLike = async (input, init) => {
      if (refuse) {
        refuse = false;
        return new Response('{}', { status: 413 });
      }
      return rec.fetch(input, init);
    };
    const { logger, entries } = memoryLogger();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), logger, { fetch: fetchImpl });
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 10);
    await waitServerAt(server, match, 10);
    refuse = true;
    await writeDvw(file, match, 20);
    await waitFor(() => entries.some((e) => e.msg.includes('(413)')), 5000, 'log 413');
    expect(running.agent.status().queue).toBe(0);
    await writeDvw(file, match, 25);
    await waitServerAt(server, match, 25);
    expect(rec.requests.map((r) => [r.kind, r.lines.length])).toEqual([
      ['snapshot', 10],
      ['snapshot', 25],
    ]);
  });
});

describe('snapshot rifiutato', () => {
  it('nuovo tentativo dopo snapshotRetryMs anche se il file non cambia: l’ultima azione arriva', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const rec = recordingFetch();
    let refuse = true;
    const fetchImpl: FetchLike = async (input, init) =>
      refuse ? new Response('{}', { status: 413 }) : rec.fetch(input, init);
    const { logger, entries } = memoryLogger();
    const config = agentConfig(dirs, server.url, server.token, { snapshotRetryMs: 1000 });
    const running = await runAgent(config, logger, { fetch: fetchImpl });
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 10);
    await waitFor(() => entries.some((e) => e.msg.includes('(413)')), 5000, 'log 413');
    expect(running.agent.status().queue).toBe(0);
    refuse = false;
    await waitServerAt(server, match, 10, 5000);
    expect(entries.some((e) => e.msg === 'nuovo tentativo dello snapshot rifiutato')).toBe(true);
    expect(rec.requests.map((r) => [r.kind, r.lines.length])).toEqual([['snapshot', 10]]);
  });
});

describe('crash dopo l’invio', () => {
  it('messaggio consegnato ma non tolto dalla coda: al riavvio duplicate con lo stesso hash, nessuna riga doppia', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const config = agentConfig(dirs, server.url, server.token);
    const first = await runAgent(config, memoryLogger().logger);
    await writeDvw(file, match, 10);
    await waitServerAt(server, match, 10);
    // The request reaches the server, but the answer is lost: the agent stops before removing it from the queue.
    let delivered = 0;
    const lost: FetchLike = async (input, init) => {
      await fetch(input, init);
      delivered++;
      throw new Error('connessione caduta dopo l’invio');
    };
    await first.stop();
    const crashed = await runAgent(config, memoryLogger().logger, { fetch: lost, timing: { retryBaseMs: 60_000 } });
    await writeDvw(file, match, 20);
    await waitFor(() => delivered === 1, 5000, 'invio senza risposta');
    await crashed.stop();
    expect(crashed.agent.status().queue).toBe(1);
    await waitServerAt(server, match, 20);

    const rec = recordingFetch();
    const responses: string[] = [];
    const watching: FetchLike = async (input, init) => {
      const res = await rec.fetch(input, init);
      responses.push(((await res.clone().json()) as { status: string }).status);
      return res;
    };
    const restarted = await runAgent(config, memoryLogger().logger, { fetch: watching });
    cleanups.push(() => restarted.stop());
    await waitFor(() => restarted.agent.status().queue === 0, 5000, 'coda vuota');
    expect(rec.requests.map((r) => [r.kind, r.seq, r.fromIndex, r.lines.length])).toEqual([['append', 1, 10, 10]]);
    expect(responses).toEqual(['duplicate']);
    const [m] = await serverMatches(server);
    expect(m?.lineCount).toBe(20);
    expect(m?.lastSeq).toBe(1);
  });
});

describe('pennina', () => {
  it('tolta e rimessa: un solo avviso, nessun crash, riprende', async () => {
    const { dirs, file } = await setup();
    const server = await live();
    const { logger, entries } = memoryLogger();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), logger);
    cleanups.push(() => running.stop());
    await writeDvw(file, match, 30);
    await waitServerAt(server, match, 30);

    const away = `${dirs.stick}-tolta`;
    const warned = (): number => entries.filter((e) => e.msg.includes('non disponibile')).length;
    const warnedBefore = warned(); // the folder was empty at start-up
    await rename(dirs.stick, away);
    await new Promise((r) => setTimeout(r, 200));
    expect(warned()).toBe(warnedBefore + 1);
    await writeDvw(join(away, 'partita.dvw'), match, 45);
    await rename(away, dirs.stick);
    await waitServerAt(server, match, 45);
    expect(entries.some((e) => e.msg === 'file .dvw di nuovo disponibile')).toBe(true);
    await writeDvw(file, match, 50);
    await waitServerAt(server, match, 50);
  });

  it('nella cartella sceglie il .dvw modificato più di recente e ignora .tmp e file nascosti', async () => {
    const { dirs } = await setup();
    const server = await live();
    const running = await runAgent(agentConfig(dirs, server.url, server.token), memoryLogger().logger);
    cleanups.push(() => running.stop());
    const other = generateMatch({ seed: 5, startTime: '2025-03-01T17:00:00Z' });
    await writeDvw(join(dirs.stick, 'vecchia.dvw'), other, 12);
    await waitServerAt(server, other, 12);
    await new Promise((r) => setTimeout(r, 20));
    await writeDvw(join(dirs.stick, 'nuova.dvw'), match, 8);
    await waitServerAt(server, match, 8);
    await writeFile(join(dirs.stick, '.nascosta.dvw'), renderDvw(other, 30));
    await writeFile(join(dirs.stick, 'nuova.dvw.tmp'), renderDvw(match, 3));
    await new Promise((r) => setTimeout(r, 150));
    const keys = (await serverMatches(server)).map((m) => [m.matchKey, m.lineCount]);
    expect(keys).toHaveLength(2);
    expect(keys.map((k) => k[1]).sort()).toEqual([12, 8]);
    expect(running.agent.status().lines).toBe(8);
  });
});
