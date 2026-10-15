import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { acquireLock } from '../src/lock.js';
import { freePort, serverMatches, startLiveServer, tempDirs, waitFor } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

function io(baseDir: string) {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t: string) => out.push(t), err: (t: string) => err.push(t), baseDir } };
}

async function logText(home: string): Promise<string> {
  try {
    const files = await readdir(join(home, 'logs'));
    const texts = await Promise.all(files.map((f) => readFile(join(home, 'logs', f), 'utf8')));
    return texts.join('');
  } catch {
    return '';
  }
}

describe('sir-agent (CLI)', () => {
  it('--help e opzioni sconosciute', async () => {
    const a = io('/tmp');
    expect(await runCli(['--help'], a.io)).toBe(0);
    expect(a.out.join('')).toContain('sir-agent [--config <file>] [--console] [--once]');
    expect(a.out.join('')).toContain('--gui');
    const b = io('/tmp');
    expect(await runCli(['--boh'], b.io)).toBe(1);
  });

  it.skipIf(process.platform === 'win32')(
    'senza argomenti o con --gui fuori da Windows: codice 1, messaggio chiaro',
    async () => {
      for (const argv of [[], ['--gui']]) {
        const a = io('/tmp');
        expect(await runCli(argv, a.io)).toBe(1);
        expect(a.err.join('')).toMatch(/solo su Windows/);
      }
      const b = io('/tmp');
      expect(await runCli(['--gui', '--once'], b.io)).toBe(1);
      expect(b.err.join('')).toMatch(/--gui non si usa/);
    },
  );

  it("lettura continua con il lucchetto di un'altra istanza: attende, poi parte quando si libera", async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    await mkdir(dirs.home, { recursive: true });
    const server = await startLiveServer();
    cleanups.push(() => server.close());
    await writeFile(join(dirs.stick, 'partita.dvw'), renderDvw(generateMatch({ seed: 4 }), 12));
    const configFile = join(dirs.home, 'config.json');
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
    // Lock of another live process (as if it were the service).
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    cleanups.push(() => Promise.resolve(void other.kill()));
    const held = await acquireLock(join(dirs.home, 'data'), { pid: other.pid ?? 0 });
    const stop = new AbortController();
    const a = io(dirs.home);
    const running = runCli(['--config', configFile], { ...a.io, signal: stop.signal, lockRetryMs: 30 });
    await waitFor(
      async () => (await logText(dirs.home)).includes("un'altra istanza dell'agente è attiva"),
      5000,
      'attesa',
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(await serverMatches(server)).toHaveLength(0);
    await held.release();
    await waitFor(async () => (await serverMatches(server))[0]?.lineCount === 12, 10_000, 'righe sul server');
    expect(JSON.parse(await readFile(join(dirs.home, 'data', 'agent.lock'), 'utf8'))).toMatchObject({
      pid: process.pid,
    });
    stop.abort();
    expect(await running).toBe(0);
    await expect(readFile(join(dirs.home, 'data', 'agent.lock'))).rejects.toThrow();
  });

  it('lettura continua fermata mentre attende il lucchetto: codice 0', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.home, { recursive: true });
    const configFile = join(dirs.home, 'config.json');
    await writeFile(
      configFile,
      JSON.stringify({ watchPath: dirs.stick, serverUrl: 'http://127.0.0.1:9', agentToken: 'a'.repeat(43) }),
    );
    const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    cleanups.push(() => Promise.resolve(void other.kill()));
    const held = await acquireLock(join(dirs.home, 'data'), { pid: other.pid ?? 0 });
    cleanups.push(() => held.release());
    const stop = new AbortController();
    const running = runCli(['--config', configFile], { ...io(dirs.home).io, signal: stop.signal, lockRetryMs: 20 });
    await waitFor(async () => (await logText(dirs.home)).includes('attendo'), 5000, 'attesa');
    stop.abort();
    expect(await running).toBe(0);
  });

  it('config.json mancante o non valido: codice 1 e messaggio chiaro', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.home, { recursive: true });
    const configFile = join(dirs.home, 'config.json');
    const a = io(dirs.home);
    expect(await runCli(['--config', configFile], a.io)).toBe(1);
    expect(a.err.join('')).toMatch(/non trovato/);
    await writeFile(
      configFile,
      JSON.stringify({ watchPath: dirs.stick, serverUrl: 'http://sir.example.it', agentToken: 'x'.repeat(43) }),
    );
    const b = io(dirs.home);
    expect(await runCli(['--config', configFile], b.io)).toBe(1);
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
