import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { freePort, serverMatches, startLiveServer, tempDirs } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function io(baseDir: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t), baseDir } };
}

describe('sir-agent (CLI)', () => {
  it('--help e opzioni sconosciute', async () => {
    const a = io('/tmp');
    expect(await runCli(['--help'], a.io)).toBe(0);
    expect(a.out.join('')).toContain('sir-agent [--config <file>] [--console] [--once]');
    const b = io('/tmp');
    expect(await runCli(['--boh'], b.io)).toBe(1);
  });

  it('config.json mancante o non valido: codice 1 e messaggio chiaro', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.home, { recursive: true });
    const a = io(dirs.home);
    expect(await runCli([], a.io)).toBe(1);
    expect(a.err.join('')).toMatch(/non trovato/);
    await writeFile(
      join(dirs.home, 'config.json'),
      JSON.stringify({ watchPath: dirs.stick, serverUrl: 'http://sir.example.it', agentToken: 'x'.repeat(43) }),
    );
    const b = io(dirs.home);
    expect(await runCli([], b.io)).toBe(1);
    expect(b.err.join('')).toMatch(/https/);
  });

  it('--once con --config: invia la partita, log su file senza token', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    await mkdir(dirs.home, { recursive: true });
    const server = await startLiveServer();
    cleanups.push(() => server.close());
    await writeFile(join(dirs.stick, 'partita.dvw'), renderDvw(generateMatch({ seed: 2 }), 33));
    const configFile = join(dirs.root, 'altrove.json');
    await writeFile(
      configFile,
      JSON.stringify({
        watchPath: dirs.stick,
        serverUrl: server.url,
        agentToken: server.token,
        pollIntervalMs: 10,
        stableMs: 20,
      }),
    );
    const a = io(dirs.home);
    expect(await runCli(['--config', configFile, '--once'], a.io)).toBe(0);
    expect((await serverMatches(server))[0]?.lineCount).toBe(33);
    const logs = await readdir(join(dirs.home, 'logs'));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^sir-agent-\d{4}-\d{2}-\d{2}\.log$/);
    const text = await readFile(join(dirs.home, 'logs', logs[0] ?? ''), 'utf8');
    expect(text).toContain('esecuzione singola terminata');
    expect(text).not.toContain(server.token);
    expect(await readdir(join(dirs.home, 'data', 'matches'))).toHaveLength(1);
  });

  it('--once con il server spento: codice 2, i dati restano in coda', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    await writeFile(join(dirs.stick, 'partita.dvw'), renderDvw(generateMatch({ seed: 2 }), 10));
    const configFile = join(dirs.root, 'config.json');
    await writeFile(
      configFile,
      JSON.stringify({
        watchPath: dirs.stick,
        serverUrl: `http://127.0.0.1:${await freePort()}`,
        agentToken: 'a'.repeat(43),
        pollIntervalMs: 10,
        stableMs: 20,
        dataDir: join(dirs.root, 'dati'),
      }),
    );
    const a = io(dirs.home);
    expect(await runCli(['--config', configFile, '--once'], a.io)).toBe(2);
    const [file] = await readdir(join(dirs.root, 'dati', 'matches'));
    const record = JSON.parse(await readFile(join(dirs.root, 'dati', 'matches', file ?? ''), 'utf8')) as {
      queue: unknown[];
    };
    expect(record.queue).toHaveLength(1);
  });
});
