import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateRegistrationResponse, RegistrationStatusResponse } from '@arenalive/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentConfig } from '../src/config.js';
import type { RunnableAgent } from '../src/gui/controller.js';
import { GuiController } from '../src/gui/controller.js';
import { LogSink } from '../src/gui/log-sink.js';
import type { GuiOutMessage, GuiRegistrationMessage } from '../src/gui/protocol.js';
import { GuiOutMessageSchema } from '../src/gui/protocol.js';
import { createLogger } from '../src/logger.js';
import type { RegistrationApi } from '../src/register.js';
import { RegistrationError, registrationFile, savePendingRegistration } from '../src/register.js';
import { tempDirs, waitFor } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const SECRET = 'segretoregistrazione_' + 'r'.repeat(22);
const TOKEN = 'tokenricevuto_' + 'q'.repeat(26) + 'Wx42';
const CREATED: CreateRegistrationResponse = {
  registrationId: '6f1d3c1e-8a4b-4f7e-9d2a-1b2c3d4e5f60',
  secret: SECRET,
  pairingCode: 'K7MP3Q',
  expiresAt: '2026-10-16T10:00:00.000Z',
};
const PENDING: RegistrationStatusResponse = { status: 'pending', expiresAt: CREATED.expiresAt };
const APPROVED: RegistrationStatusResponse = {
  status: 'approved',
  token: TOKEN,
  agentId: '0b6f1d3c-8a4b-4f7e-9d2a-1b2c3d4e5f61',
};

type Answer = RegistrationStatusResponse | Error;

/** Registration server whose answers the test decides; it checks that queries never overlap. */
class FakeApi implements RegistrationApi {
  servers: string[] = [];
  names: string[] = [];
  secrets: string[] = [];
  answers: Answer[] = [];
  /** Answer once `answers` is empty. */
  fallback: Answer = PENDING;
  createError: Error | null = null;
  inFlight = 0;
  maxInFlight = 0;

  readonly factory = (serverUrl: string): RegistrationApi => {
    this.servers.push(serverUrl);
    return this;
  };

  create = (name: string): Promise<CreateRegistrationResponse> => {
    this.names.push(name);
    return this.createError ? Promise.reject(this.createError) : Promise.resolve(CREATED);
  };

  /** When set, the next queries wait for it (or for the abort, if `honourAbort`). */
  gate: Promise<void> | null = null;
  honourAbort = true;
  aborted = 0;

  status = async (secret: string, signal?: AbortSignal): Promise<RegistrationStatusResponse> => {
    this.secrets.push(secret);
    // Chosen when the query starts: a late answer is the one of its own query.
    const answer = this.answers.shift() ?? this.fallback;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const waits: Promise<unknown>[] = [new Promise((r) => setTimeout(r, 5)).then(() => this.gate)];
      if (this.honourAbort && signal) {
        waits.push(
          new Promise((_, reject) => {
            const abort = (): void => {
              this.aborted++;
              reject(new RegistrationError('ABORTED', 'Richiesta annullata'));
            };
            if (signal.aborted) abort();
            signal.addEventListener('abort', abort, { once: true });
          }),
        );
      }
      await Promise.race(waits);
    } finally {
      this.inFlight--;
    }
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

class FakeAgents {
  created: AgentConfig[] = [];
  readonly create = (config: AgentConfig): Promise<RunnableAgent> => {
    this.created.push(config);
    return Promise.resolve({
      status: () => ({
        file: null,
        matchKey: null,
        lines: 0,
        queue: 0,
        lastSuccessAt: null,
        serverReachable: true,
        registrationExpired: false,
      }),
      run: (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        }),
    });
  };
}

const BASE_CONFIG = { serverUrl: 'https://sir.example.it/base', watchPath: 'E:\\' };

async function setup(config: object | null = BASE_CONFIG, existing?: { dirs: ReturnType<typeof tempDirs> }) {
  const dirs = existing?.dirs ?? tempDirs();
  if (!existing) cleanups.push(dirs.cleanup);
  await mkdir(dirs.home, { recursive: true });
  const configPath = join(dirs.home, 'config.json');
  if (config) await writeFile(configPath, JSON.stringify(config));
  const lines: string[] = [];
  const sink = new LogSink(200);
  const logged: string[] = [];
  const { logger, close } = createLogger({
    level: 'debug',
    logDir: join(dirs.home, 'logs'),
    console: false,
    extraStream: {
      write: (chunk: string) => {
        logged.push(chunk);
        sink.write(chunk);
      },
    },
  });
  cleanups.push(() => {
    close();
    return Promise.resolve();
  });
  const api = new FakeApi();
  const agents = new FakeAgents();
  const controller = new GuiController({
    configPath,
    baseDir: dirs.home,
    logger,
    send: (line) => lines.push(line),
    logSink: sink,
    createAgent: agents.create,
    createRegistrationApi: api.factory,
    registrationPollMs: 20,
    statusIntervalMs: 20,
  });
  cleanups.push(() => controller.shutdown());
  const messages = (): GuiOutMessage[] => lines.map((l) => GuiOutMessageSchema.parse(JSON.parse(l)));
  const registrations = (): GuiRegistrationMessage[] =>
    messages().flatMap((m) => (m.type === 'registration' ? [m] : []));
  const lastRegistration = (): GuiRegistrationMessage | undefined => registrations().at(-1);
  const lastInit = () =>
    messages()
      .filter((m) => m.type === 'init')
      .at(-1);
  const dataDir = join(dirs.home, 'data');
  const regFile = registrationFile(dataDir);
  return {
    dirs,
    configPath,
    lines,
    logged,
    messages,
    registrations,
    lastRegistration,
    lastInit,
    controller,
    api,
    agents,
    dataDir,
    regFile,
  };
}

const fileExists = (file: string): Promise<boolean> =>
  readFile(file).then(
    () => true,
    () => false,
  );

describe('auto-registrazione nella finestra', () => {
  it('register → pending con il codice → approved: token salvato, START abilitato e funzionante', async () => {
    const t = await setup();
    await t.controller.init();
    expect(t.lastRegistration()).toEqual({ type: 'registration', state: 'none' });
    expect(t.lastInit()).toMatchObject({ token: { present: false } });

    t.api.answers = [PENDING, PENDING];
    t.api.fallback = APPROVED;
    t.controller.handleLine(JSON.stringify({ type: 'register', name: '  PC campo 1 ' }));
    await waitFor(() => t.lastRegistration()?.state === 'pending', 5000, 'pending');
    expect(t.lastRegistration()).toEqual({
      type: 'registration',
      state: 'pending',
      name: 'PC campo 1',
      pairingCode: 'K7MP3Q',
      expiresAt: CREATED.expiresAt,
    });
    expect(t.api.servers).toEqual(['https://sir.example.it/base']);
    expect(t.api.names).toEqual(['PC campo 1']);
    expect(JSON.parse(await readFile(t.regFile, 'utf8'))).toMatchObject({ secret: SECRET, name: 'PC campo 1' });

    await waitFor(() => t.lastRegistration()?.state === 'approved', 5000, 'approved');
    expect(t.lastRegistration()).toEqual({ type: 'registration', state: 'approved', name: 'PC campo 1' });
    expect(t.lastInit()).toMatchObject({ token: { present: true, last4: 'Wx42' } });
    // init con il token presente prima dell'esito, poi lo stato idle: la finestra abilita START.
    const all0 = t.messages();
    const approvedAt = all0.findIndex((m) => m.type === 'registration' && m.state === 'approved');
    const initAt = all0.findIndex((m) => m.type === 'init' && m.token.present);
    expect(initAt).toBeGreaterThan(-1);
    expect(initAt).toBeLessThan(approvedAt);
    expect(all0.slice(approvedAt).some((m) => m.type === 'state' && m.phase === 'idle')).toBe(true);
    expect(JSON.parse(await readFile(t.configPath, 'utf8'))).toEqual({ ...BASE_CONFIG, agentToken: TOKEN });
    expect(await fileExists(t.regFile)).toBe(false);
    expect(t.api.secrets.every((s) => s === SECRET)).toBe(true);
    expect(t.api.maxInFlight).toBe(1);
    // pending ripetuto dall'interrogazione: un solo messaggio
    expect(t.registrations().filter((m) => m.state === 'pending')).toHaveLength(1);

    // Nessuna altra interrogazione dopo la fine.
    const calls = t.api.secrets.length;
    await new Promise((r) => setTimeout(r, 80));
    expect(t.api.secrets).toHaveLength(calls);

    t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick }));
    await waitFor(() => t.agents.created.length === 1, 5000, 'agente');
    expect(t.agents.created[0]?.agentToken).toBe(TOKEN);

    const all = t.lines.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(TOKEN);
    const logs = t.logged.join('\n');
    expect(logs).not.toContain(SECRET);
    expect(logs).not.toContain(TOKEN);
  });

  it.each(['rejected', 'expired', 'consumed'] as const)(
    '%s: stato chiaro, file cancellato, si può registrare di nuovo',
    async (state) => {
      const t = await setup();
      await t.controller.init();
      t.api.fallback = { status: state };
      t.controller.register('PC');
      await waitFor(() => t.lastRegistration()?.state === state, 5000, state);
      expect(t.lastRegistration()).toEqual({ type: 'registration', state, name: 'PC' });
      expect(await fileExists(t.regFile)).toBe(false);
      expect(t.lastInit()).toMatchObject({ token: { present: false } });

      t.api.fallback = PENDING;
      t.controller.register('PC 2');
      await waitFor(() => t.lastRegistration()?.state === 'pending', 5000, 'di nuovo pending');
      expect(t.api.names).toEqual(['PC', 'PC 2']);
    },
  );

  it('annulla: interrogazione fermata, file cancellato, stato none', async () => {
    const t = await setup();
    await t.controller.init();
    t.controller.register('PC');
    await waitFor(() => t.api.secrets.length >= 2, 5000, 'interrogazioni');
    t.controller.handleLine(JSON.stringify({ type: 'cancelRegistration' }));
    await waitFor(() => t.lastRegistration()?.state === 'none', 5000, 'none');
    await new Promise((r) => setTimeout(r, 20));
    const calls = t.api.secrets.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(t.api.secrets).toHaveLength(calls);
    expect(await fileExists(t.regFile)).toBe(false);
  });

  it('registrazione già in corso o durante la lettura: rifiutata', async () => {
    const t = await setup({ ...BASE_CONFIG, agentToken: 'b'.repeat(43) });
    await t.controller.init();
    t.controller.register('PC');
    t.controller.register('PC');
    expect(t.messages().at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/già in corso/) as unknown,
    });
    await waitFor(() => t.lastRegistration()?.state === 'pending', 5000, 'pending');
    await t.controller.cancelRegistration();

    t.controller.start(t.dirs.stick);
    await waitFor(() => t.messages().some((m) => m.type === 'state' && m.phase === 'running'), 5000, 'running');
    t.controller.register('PC');
    expect(t.messages().at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/STOP/) as unknown });
    expect(t.api.names).toEqual(['PC']);
  });

  it('serverUrl non valido o config.json mancante: errore chiaro, nessuna richiesta', async () => {
    const t = await setup({ serverUrl: 'http://sir.example.it', watchPath: 'E:\\' });
    await t.controller.init();
    t.controller.register('PC');
    await waitFor(() => t.lastRegistration()?.state === 'error', 5000, 'errore');
    expect(t.lastRegistration()?.message).toMatch(/https/);

    const u = await setup(null);
    await u.controller.init();
    u.controller.register('PC');
    await waitFor(() => u.lastRegistration()?.state === 'error', 5000, 'errore');
    expect(u.lastRegistration()?.message).toMatch(/config\.json non trovato/);

    const v = await setup({ watchPath: 'E:\\' });
    await v.controller.init();
    v.controller.register('PC');
    await waitFor(() => v.lastRegistration()?.state === 'error', 5000, 'errore');
    expect(v.lastRegistration()?.message).toMatch(/serverUrl mancante/);
    expect([...t.api.names, ...u.api.names, ...v.api.names]).toEqual([]);
  });

  it('errore alla creazione (429): stato error con il messaggio, si può riprovare', async () => {
    const t = await setup();
    await t.controller.init();
    t.api.createError = new RegistrationError('RATE_LIMITED', 'Troppe richieste di registrazione', 429);
    t.controller.register('PC');
    await waitFor(() => t.lastRegistration()?.state === 'error', 5000, 'errore');
    expect(t.lastRegistration()).toEqual({
      type: 'registration',
      state: 'error',
      name: 'PC',
      message: 'Troppe richieste di registrazione',
    });
    t.api.createError = null;
    t.controller.register('PC');
    await waitFor(() => t.lastRegistration()?.state === 'pending', 5000, 'pending');
  });

  it('server non raggiungibile durante l’attesa: avviso e nuovi tentativi; 401: registrazione chiusa', async () => {
    const t = await setup();
    await t.controller.init();
    t.api.answers = [new RegistrationError('NETWORK', 'Server non raggiungibile: boom'), PENDING];
    t.api.fallback = new RegistrationError(
      'UNAUTHORIZED',
      'Richiesta di registrazione non riconosciuta dal server',
      401,
    );
    t.controller.register('PC');
    await waitFor(() => t.lastRegistration()?.state === 'error', 5000, 'errore 401');
    const states = t.registrations().map((m) => [m.state, m.message ?? '']);
    expect(states).toEqual([
      ['none', ''],
      ['pending', ''],
      ['pending', 'Server non raggiungibile: boom: nuovo tentativo tra 0 s'],
      ['pending', ''],
      ['error', 'Richiesta di registrazione non riconosciuta dal server'],
    ]);
    expect(await fileExists(t.regFile)).toBe(false);
  });

  it('ripresa da registration.json alla riapertura della finestra', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    const t = await setup(BASE_CONFIG, { dirs });
    await savePendingRegistration(t.dataDir, { version: 1, ...CREATED, name: 'PC salvato' });
    t.api.answers = [PENDING];
    t.api.fallback = APPROVED;
    await t.controller.init();
    expect(t.lastRegistration()).toEqual({
      type: 'registration',
      state: 'pending',
      name: 'PC salvato',
      pairingCode: 'K7MP3Q',
      expiresAt: CREATED.expiresAt,
    });
    await waitFor(() => t.lastRegistration()?.state === 'approved', 5000, 'approved');
    expect(t.api.names).toEqual([]);
    expect(t.api.secrets[0]).toBe(SECRET);
    expect(JSON.parse(await readFile(t.configPath, 'utf8'))).toMatchObject({ agentToken: TOKEN });
    expect(t.lines.join('\n')).not.toContain(SECRET);
  });

  it('quit durante l’attesa: interrogazione fermata, registration.json tenuto per la ripresa', async () => {
    const t = await setup();
    await t.controller.init();
    t.controller.register('PC');
    await waitFor(() => t.lastRegistration()?.state === 'pending', 5000, 'pending');
    t.controller.handleLine(JSON.stringify({ type: 'quit' }));
    await t.controller.done;
    const calls = t.api.secrets.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(t.api.secrets).toHaveLength(calls);
    expect(await fileExists(t.regFile)).toBe(true);
  });

  it('nome non valido dalla finestra: scartato con un errore (la finestra non resta in attesa)', async () => {
    const t = await setup();
    await t.controller.init();
    t.controller.handleLine(JSON.stringify({ type: 'register', name: 'a\u0001b' }));
    t.controller.handleLine(JSON.stringify({ type: 'register', name: 'x'.repeat(101) }));
    t.controller.handleLine(JSON.stringify({ type: 'register', name: '   ' }));
    expect(t.messages().filter((m) => m.type === 'error')).toHaveLength(3);
    expect(t.api.names).toEqual([]);
  });

  it('dataDir sulla pennina: «Registra» rifiutato, niente scritto sulla pennina', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    await mkdir(dirs.stick, { recursive: true });
    const onStick = join(dirs.stick, 'data');
    const t = await setup({ ...BASE_CONFIG, watchPath: dirs.stick, dataDir: onStick }, { dirs });
    await t.controller.init();
    t.controller.register('PC');
    await waitFor(() => t.lastRegistration()?.state === 'error', 5000, 'errore');
    expect(t.lastRegistration()?.message).toMatch(/dataDir non può stare dentro watchPath/);
    expect(t.api.names).toEqual([]);
    expect(await readdir(dirs.stick)).toEqual([]);

    // Anche con watchPath sul file .dvw: conta la sua cartella.
    const u = await setup({ ...BASE_CONFIG, watchPath: join(dirs.stick, 'partita.dvw'), dataDir: onStick });
    await u.controller.init();
    u.controller.register('PC');
    await waitFor(() => u.lastRegistration()?.state === 'error', 5000, 'errore');
    expect(u.lastRegistration()?.message).toMatch(/dataDir non può stare dentro watchPath/);
    expect(await readdir(dirs.stick)).toEqual([]);
  });

  it('dataDir sulla pennina alla riapertura: registrazione non ripresa, file non toccato', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    const onStick = join(dirs.stick, 'data');
    await mkdir(onStick, { recursive: true });
    const file = registrationFile(onStick);
    await writeFile(file, 'non json');
    const t = await setup({ ...BASE_CONFIG, watchPath: dirs.stick, dataDir: onStick }, { dirs });
    await t.controller.init();
    expect(t.lastRegistration()).toMatchObject({
      state: 'error',
      message: expect.stringMatching(/dataDir non può stare dentro watchPath/) as unknown,
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(t.api.secrets).toEqual([]);
    expect(await readFile(file, 'utf8')).toBe('non json');
  });

  it('quit con un’interrogazione in volo: annullata subito, registration.json tenuto', async () => {
    const t = await setup();
    await t.controller.init();
    t.api.gate = new Promise(() => undefined);
    t.controller.register('PC');
    await waitFor(() => t.api.inFlight === 1, 5000, 'interrogazione in volo');
    const started = Date.now();
    await t.controller.shutdown();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(t.api.aborted).toBe(1);
    expect(await fileExists(t.regFile)).toBe(true);
  });

  it('approvata durante la lettura: il token vale dal prossimo START', async () => {
    const t = await setup({ ...BASE_CONFIG, agentToken: 'b'.repeat(43) });
    await t.controller.init();
    let open: () => void = () => undefined;
    t.api.gate = new Promise((r) => {
      open = r;
    });
    t.api.fallback = APPROVED;
    t.controller.register('PC');
    await waitFor(() => t.api.inFlight === 1, 5000, 'interrogazione in volo');
    t.controller.start(t.dirs.stick);
    await waitFor(() => t.messages().some((m) => m.type === 'state' && m.phase === 'running'), 5000, 'running');
    open();
    await waitFor(() => t.lastRegistration()?.state === 'approved', 5000, 'approved');
    expect(t.lastRegistration()).toEqual({
      type: 'registration',
      state: 'approved',
      name: 'PC',
      message: 'Token salvato: vale dal prossimo START',
    });
    expect(t.agents.created[0]?.agentToken).toBe('b'.repeat(43));
  });

  it('risposta tardiva di una registrazione annullata: non tocca quella nuova', async () => {
    const t = await setup();
    await t.controller.init();
    let open: () => void = () => undefined;
    t.api.gate = new Promise((r) => {
      open = r;
    });
    t.api.honourAbort = false;
    t.api.answers = [{ status: 'rejected' }];
    t.controller.register('PC vecchio');
    await waitFor(() => t.api.inFlight === 1, 5000, 'interrogazione in volo');
    await t.controller.cancelRegistration();
    t.api.gate = null;
    t.controller.register('PC nuovo');
    await waitFor(() => t.lastRegistration()?.state === 'pending', 5000, 'nuova pending');
    open();
    await waitFor(() => t.api.inFlight === 0, 5000, 'vecchia risposta');
    await new Promise((r) => setTimeout(r, 30));
    expect(t.lastRegistration()?.state).toBe('pending');
    expect(t.lastRegistration()?.name).toBe('PC nuovo');
    expect(JSON.parse(await readFile(t.regFile, 'utf8'))).toMatchObject({ name: 'PC nuovo' });
  });
});
