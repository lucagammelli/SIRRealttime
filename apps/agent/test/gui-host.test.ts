import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import { agentBranding, agentDownloadConfig } from '@sir/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { runGui } from '../src/gui/main.js';
import type { GuiOutMessage } from '../src/gui/protocol.js';
import { GuiOutMessageSchema } from '../src/gui/protocol.js';
import { WINDOW_SCRIPT } from '../src/gui/window-script.js';
import { ADMIN, login } from '../../server/test/helpers.js';
import { png } from '../../server/test/imageFixtures.js';
import { registrationFile } from '../src/register.js';
import { serverMatches, startLiveServer, tempDirs, waitFor } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const FAKE_WINDOW = fileURLToPath(new URL('./fixtures/fake-window.mjs', import.meta.url));

/** The test side of the fake window: lines received from the agent, and a way to send messages. */
interface Window {
  messages: GuiOutMessage[];
  raw: string[];
  send: (message: object) => void;
  close: () => void;
}

async function windowServer(): Promise<{ port: number; connected: Promise<Window>; close: () => Promise<void> }> {
  let resolveWindow: (w: Window) => void = () => undefined;
  const connected = new Promise<Window>((resolve) => {
    resolveWindow = resolve;
  });
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    const w: Window = {
      messages: [],
      raw: [],
      send: (message) => socket.write(`${JSON.stringify(message)}\n`),
      close: () => socket.destroy(),
    };
    createInterface({ input: socket }).on('line', (line) => {
      w.raw.push(line);
      w.messages.push(GuiOutMessageSchema.parse(JSON.parse(line)));
    });
    resolveWindow(w);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connected,
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

const lastPhase = (w: Window): string | undefined =>
  w.messages.flatMap((m) => (m.type === 'state' ? [m.phase] : [])).at(-1);

describe('finestra (host + controller) con un finto powershell', () => {
  it('lo script incluso è quello della finestra', () => {
    expect(WINDOW_SCRIPT).toContain('System.Windows.Forms');
    expect(WINDOW_SCRIPT).not.toMatch(/^\s*else\b/m);
  });

  it('con branding.json e logo accanto all’eseguibile la finestra riceve la grafica del cliente', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.home, { recursive: true });
    await writeFile(join(dirs.home, 'branding.json'), JSON.stringify(agentBranding('Club A', { primary: '#ffeb3b' })));
    await writeFile(join(dirs.home, 'logo.png'), png(120, 40));
    const configPath = join(dirs.home, 'config.json');
    await writeFile(configPath, JSON.stringify(agentDownloadConfig('https://club-a.sir.it')));
    const ws = await windowServer();
    cleanups.push(ws.close);
    const exit = runGui({
      baseDir: dirs.home,
      configPath,
      command: process.execPath,
      args: () => [FAKE_WINDOW, String(ws.port)],
    });
    const w = await ws.connected;
    await waitFor(() => lastPhase(w) === 'idle', 5000, 'init');
    expect(w.messages[0]).toMatchObject({
      type: 'init',
      serverUrl: 'https://club-a.sir.it',
      token: { present: false },
      branding: { name: 'Club A', primary: '#ffeb3b', onPrimary: '#000000', logoPath: join(dirs.home, 'logo.png') },
    });
    w.send({ type: 'quit' });
    expect(await exit).toBe(0);
  });

  it('START → righe sul server; STOP → nessun invio; START → riprende; quit → uscita 0', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    await mkdir(dirs.home, { recursive: true });
    const server = await startLiveServer();
    cleanups.push(() => server.close());
    const match = generateMatch({ seed: 21 });
    const dvw = join(dirs.stick, 'partita.dvw');
    await writeFile(dvw, renderDvw(match, 20));
    const configPath = join(dirs.home, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({ watchPath: 'E:\\', serverUrl: server.url, pollIntervalMs: 10, stableMs: 20, logLevel: 'info' }),
    );
    const ws = await windowServer();
    cleanups.push(ws.close);

    const exit = runGui({
      baseDir: dirs.home,
      configPath,
      command: process.execPath,
      args: () => [FAKE_WINDOW, String(ws.port)],
      statusIntervalMs: 50,
    });
    const w = await ws.connected;
    await waitFor(() => lastPhase(w) === 'idle', 5000, 'init');
    expect(w.messages[0]).toMatchObject({ type: 'init', serverUrl: server.url, token: { present: false } });
    const script = await readFile(join(dirs.home, 'data', 'gui', 'window.ps1'));
    expect([...script.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    w.send({ type: 'start', watchPath: dirs.stick, token: server.token });
    await waitFor(async () => (await serverMatches(server))[0]?.lineCount === 20, 15_000, '20 righe');
    expect(lastPhase(w)).toBe('running');
    await waitFor(() => w.messages.some((m) => m.type === 'state' && m.status?.lines === 20), 5000, 'stato');
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toMatchObject({
      watchPath: dirs.stick,
      agentToken: server.token,
      pollIntervalMs: 10,
    });

    w.send({ type: 'stop' });
    await waitFor(() => lastPhase(w) === 'idle', 5000, 'idle');
    await writeFile(dvw, renderDvw(match, 35));
    await new Promise((r) => setTimeout(r, 400));
    expect((await serverMatches(server))[0]?.lineCount).toBe(20);

    w.send({ type: 'start', watchPath: dirs.stick });
    await waitFor(async () => (await serverMatches(server))[0]?.lineCount === 35, 15_000, '35 righe');

    w.send({ type: 'quit' });
    expect(await exit).toBe(0);
    expect(w.raw.join('\n')).not.toContain(server.token);
    expect(w.messages.some((m) => m.type === 'log' && m.msg.includes('agente avviato'))).toBe(true);
    await expect(readFile(join(dirs.home, 'data', 'agent.lock'))).rejects.toThrow();
  }, 60_000);

  it('registrazione con il server vero: codice, abilitazione dal portale, token salvato, START invia le righe', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    await mkdir(dirs.home, { recursive: true });
    const server = await startLiveServer();
    cleanups.push(() => server.close());
    const match = generateMatch({ seed: 5 });
    await writeFile(join(dirs.stick, 'partita.dvw'), renderDvw(match, 12));
    const configPath = join(dirs.home, 'config.json');
    await writeFile(configPath, JSON.stringify({ serverUrl: server.url, pollIntervalMs: 10, stableMs: 20 }));
    const ws = await windowServer();
    cleanups.push(ws.close);
    const exit = runGui({
      baseDir: dirs.home,
      configPath,
      command: process.execPath,
      args: () => [FAKE_WINDOW, String(ws.port)],
      statusIntervalMs: 50,
      registrationPollMs: 50,
    });
    const w = await ws.connected;
    const lastRegistration = () => w.messages.flatMap((m) => (m.type === 'registration' ? [m] : [])).at(-1);
    await waitFor(() => lastRegistration()?.state === 'none', 5000, 'init');

    w.send({ type: 'register', name: 'PC campo prova' });
    await waitFor(() => lastRegistration()?.state === 'pending', 10_000, 'pending');
    const pairingCode = lastRegistration()?.pairingCode;
    expect(pairingCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const { secret } = JSON.parse(await readFile(registrationFile(join(dirs.home, 'data')), 'utf8')) as {
      secret: string;
    };

    // L'admin trova la richiesta con lo stesso codice e la abilita.
    const cookie = await login(server.app, ADMIN);
    const list = await server.app.inject({ method: 'GET', url: '/api/admin/agent-registrations', headers: { cookie } });
    const requests = list.json<{ id: string; name: string; pairingCode: string }[]>();
    expect(requests).toMatchObject([{ name: 'PC campo prova', pairingCode }]);
    const approve = await server.app.inject({
      method: 'POST',
      url: `/api/admin/agent-registrations/${requests[0]?.id ?? ''}/approve`,
      headers: { cookie },
      payload: {},
    });
    expect(approve.statusCode).toBe(200);

    await waitFor(() => lastRegistration()?.state === 'approved', 10_000, 'approved');
    expect(w.messages.filter((m) => m.type === 'init').at(-1)).toMatchObject({ token: { present: true } });
    const saved = JSON.parse(await readFile(configPath, 'utf8')) as { agentToken: string };
    expect(saved.agentToken).toMatch(/^[A-Za-z0-9_-]{20,200}$/);
    await expect(readFile(registrationFile(join(dirs.home, 'data')))).rejects.toThrow();

    w.send({ type: 'start', watchPath: dirs.stick });
    await waitFor(async () => (await serverMatches(server))[0]?.lineCount === 12, 15_000, '12 righe');

    w.send({ type: 'quit' });
    expect(await exit).toBe(0);
    const raw = w.raw.join('\n');
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(saved.agentToken);
  }, 60_000);

  it.each([
    ['logDir', { logDir: 'pennina/logs' }],
    ['dataDir', { dataDir: 'pennina/data' }],
  ])(
    '%s sulla pennina: niente scritto lì, finestra aperta con l’errore, START e Registra rifiutati',
    async (_, extra) => {
      const dirs = tempDirs();
      cleanups.push(dirs.cleanup);
      await mkdir(dirs.stick, { recursive: true });
      await mkdir(dirs.home, { recursive: true });
      const fallbackDir = join(dirs.root, 'sicura');
      const configPath = join(dirs.home, 'config.json');
      // percorsi relativi alla cartella dell'agente: `pennina/...` sta dentro watchPath
      const stickFromHome = join(dirs.home, 'pennina');
      await mkdir(stickFromHome, { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify({
          watchPath: stickFromHome,
          serverUrl: 'http://127.0.0.1:9',
          agentToken: 'b'.repeat(43),
          ...extra,
        }),
      );
      const ws = await windowServer();
      cleanups.push(ws.close);
      const exit = runGui({
        baseDir: dirs.home,
        configPath,
        command: process.execPath,
        args: () => [FAKE_WINDOW, String(ws.port)],
        fallbackDir,
      });
      const w = await ws.connected;
      await waitFor(() => w.messages.some((m) => m.type === 'error'), 5000, 'errore');
      expect(w.messages.find((m) => m.type === 'error')).toMatchObject({
        message: expect.stringMatching(/non può stare dentro watchPath.*correggi config\.json/) as unknown,
      });
      w.send({ type: 'start', watchPath: stickFromHome });
      await waitFor(() => w.messages.filter((m) => m.type === 'error').length >= 2, 5000, 'START rifiutato');
      w.send({ type: 'register', name: 'PC' });
      await waitFor(
        () => w.messages.some((m) => m.type === 'registration' && m.state === 'error'),
        5000,
        'Registra rifiutato',
      );
      w.send({ type: 'quit' });
      expect(await exit).toBe(0);
      expect(await readdir(stickFromHome)).toEqual([]);
      await expect(readFile(join(fallbackDir, 'data', 'gui', 'window.ps1'))).resolves.toBeDefined();
      expect((await readdir(join(fallbackDir, 'logs'))).length).toBeGreaterThan(0);
      expect(lastPhase(w)).toBe('idle');
    },
  );

  it("se la finestra muore durante la lettura, l'agente si ferma e il processo esce", async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    await mkdir(dirs.home, { recursive: true });
    const configPath = join(dirs.home, 'config.json');
    await writeFile(
      configPath,
      JSON.stringify({
        watchPath: dirs.stick,
        serverUrl: 'http://127.0.0.1:9',
        agentToken: 'b'.repeat(43),
        pollIntervalMs: 10,
      }),
    );
    const ws = await windowServer();
    cleanups.push(ws.close);
    const exit = runGui({
      baseDir: dirs.home,
      configPath,
      command: process.execPath,
      args: () => [FAKE_WINDOW, String(ws.port)],
    });
    const w = await ws.connected;
    await waitFor(() => lastPhase(w) === 'idle', 5000, 'init');
    w.send({ type: 'start', watchPath: dirs.stick });
    await waitFor(() => lastPhase(w) === 'running', 5000, 'running');
    w.close();
    expect(await exit).toBe(0);
    await expect(readFile(join(dirs.home, 'data', 'agent.lock'))).rejects.toThrow();
  });

  it('comando della finestra inesistente: codice 1', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.home, { recursive: true });
    const code = await runGui({
      baseDir: dirs.home,
      configPath: join(dirs.home, 'config.json'),
      command: join(dirs.home, 'non-esiste.exe'),
      args: () => [],
    });
    expect(code).toBe(1);
  });
});
