import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentStatus } from '../src/agent.js';
import type { AgentConfig } from '../src/config.js';
import type { RunnableAgent } from '../src/gui/controller.js';
import { GuiController } from '../src/gui/controller.js';
import { LogSink } from '../src/gui/log-sink.js';
import type { GuiOutMessage } from '../src/gui/protocol.js';
import { GuiOutMessageSchema } from '../src/gui/protocol.js';
import { acquireLock } from '../src/lock.js';
import { createLogger } from '../src/logger.js';
import { tempDirs, waitFor } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const TOKEN = 'segretissimo_' + 'k'.repeat(26) + 'Ab12';
const PASTED = 'incollato_' + 'p'.repeat(30) + 'Zz99';

const STATUS: AgentStatus = {
  file: 'E:\\partita.dvw',
  matchKey: 'm',
  lines: 3,
  queue: 0,
  lastSuccessAt: null,
  serverReachable: true,
  registrationExpired: false,
};

/** Agent whose start-up and loop the test controls. */
class FakeAgents {
  created: AgentConfig[] = [];
  runs = 0;
  running = 0;
  createDelay: Promise<void> = Promise.resolve();

  readonly create = async (config: AgentConfig): Promise<RunnableAgent> => {
    await this.createDelay;
    this.created.push(config);
    return {
      status: () => STATUS,
      run: async (signal: AbortSignal) => {
        this.runs++;
        this.running++;
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        this.running--;
      },
    };
  };
}

async function setup(
  config: object | null = { serverUrl: 'https://sir.example.it', agentToken: TOKEN, watchPath: 'E:\\' },
) {
  const dirs = tempDirs();
  cleanups.push(dirs.cleanup);
  await mkdir(dirs.home, { recursive: true });
  const configPath = join(dirs.home, 'config.json');
  if (config) await writeFile(configPath, JSON.stringify(config));
  const lines: string[] = [];
  const sink = new LogSink(200);
  const { logger, close } = createLogger({
    level: 'info',
    logDir: join(dirs.home, 'logs'),
    console: false,
    extraStream: sink,
  });
  cleanups.push(() => {
    close();
    return Promise.resolve();
  });
  const agents = new FakeAgents();
  const controller = new GuiController({
    configPath,
    baseDir: dirs.home,
    logger,
    send: (line) => lines.push(line),
    logSink: sink,
    createAgent: agents.create,
    statusIntervalMs: 20,
  });
  cleanups.push(() => controller.shutdown());
  const messages = (): GuiOutMessage[] => lines.map((l) => GuiOutMessageSchema.parse(JSON.parse(l)));
  const phases = (): string[] => messages().flatMap((m) => (m.type === 'state' ? [m.phase] : []));
  const lastPhase = (): string | undefined => phases().at(-1);
  return { dirs, configPath, lines, messages, phases, lastPhase, controller, agents, logger };
}

describe('controller della finestra', () => {
  it('init: campi del config.json, token solo come presente/ultimi 4, stato idle', async () => {
    const t = await setup();
    await t.controller.init();
    const [init, state] = t.messages();
    expect(init).toEqual({
      type: 'init',
      watchPath: 'E:\\',
      serverUrl: 'https://sir.example.it',
      token: { present: true, last4: 'Ab12' },
    });
    expect(state).toEqual({ type: 'state', phase: 'idle', status: null });
  });

  it("config.json mancante: configError con il rimando all'area admin", async () => {
    const t = await setup(null);
    await t.controller.init();
    expect(t.messages()[0]).toMatchObject({
      type: 'init',
      token: { present: false },
      configError: expect.stringMatching(/pagina «Agenti»/) as unknown,
    });
    t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick, token: PASTED }));
    await waitFor(() => t.messages().some((m) => m.type === 'error'), 5000, 'errore');
    expect(t.lastPhase()).toBe('idle');
    expect(t.agents.created).toHaveLength(0);
  });

  it('START / STOP ripetuti: config salvato, una sola esecuzione per volta, lucchetto preso e lasciato', async () => {
    const t = await setup();
    await t.controller.init();
    for (let i = 0; i < 3; i++) {
      t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick }));
      await waitFor(() => t.lastPhase() === 'running', 5000, 'running');
      expect(t.messages().at(-1)).toMatchObject({ type: 'state', phase: 'running', status: STATUS });
      // START in running: rifiutato, nessun secondo agente.
      t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick }));
      expect(t.messages().at(-1)).toMatchObject({ type: 'error' });
      await expect(readFile(join(t.dirs.home, 'data', 'agent.lock'), 'utf8')).resolves.toContain(String(process.pid));
      await t.controller.stop();
      expect(t.lastPhase()).toBe('idle');
      expect(t.agents.running).toBe(0);
      await expect(readFile(join(t.dirs.home, 'data', 'agent.lock'))).rejects.toThrow();
    }
    expect(t.agents.runs).toBe(3);
    expect(t.agents.created[0]?.watchPath).toBe(t.dirs.stick);
    const saved = JSON.parse(await readFile(t.configPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toEqual({ serverUrl: 'https://sir.example.it', agentToken: TOKEN, watchPath: t.dirs.stick });
    const changes = t.phases().filter((p, k, all) => k === 0 || p !== all[k - 1]);
    expect(changes).toEqual([
      'idle',
      ...Array.from({ length: 3 }, () => ['starting', 'running', 'stopping', 'idle']).flat(),
    ]);
  });

  it("STOP durante l'avvio: l'agente non parte", async () => {
    const t = await setup();
    await t.controller.init();
    let release: () => void = () => undefined;
    t.agents.createDelay = new Promise((r) => {
      release = r;
    });
    t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick }));
    expect(t.lastPhase()).toBe('starting');
    t.controller.handleLine(JSON.stringify({ type: 'stop' }));
    expect(t.lastPhase()).toBe('stopping');
    await new Promise((r) => setTimeout(r, 50));
    release();
    await waitFor(() => t.lastPhase() === 'idle', 5000, 'idle');
    expect(t.agents.runs).toBe(0);
    expect(t.phases()).not.toContain('running');
  });

  it('configurazione non valida o lucchetto occupato: errore alla finestra, idle', async () => {
    const t = await setup({ serverUrl: 'http://sir.example.it', agentToken: TOKEN });
    await t.controller.init();
    t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick }));
    await waitFor(() => t.lastPhase() === 'idle' && t.messages().some((m) => m.type === 'error'), 5000, 'errore');
    expect(t.messages().find((m) => m.type === 'error')).toMatchObject({
      message: expect.stringMatching(/https/) as unknown,
    });

    const u = await setup();
    await u.controller.init();
    const held = await acquireLock(join(u.dirs.home, 'data'), { pid: 4242 });
    const controller = new GuiController({
      configPath: u.configPath,
      baseDir: u.dirs.home,
      logger: u.logger,
      send: (line) => u.lines.push(line),
      createAgent: u.agents.create,
      acquireLock: (dir) => acquireLock(dir, { isAlive: () => true }),
    });
    controller.start(u.dirs.stick);
    await waitFor(() => u.messages().some((m) => m.type === 'error'), 5000, 'errore');
    const error = u.messages().find((m) => m.type === 'error');
    expect(error?.type === 'error' && error.message).toMatch(/altra istanza.*pid 4242/);
    expect(u.agents.created).toHaveLength(0);
    await held.release();
  });

  it('il token non compare mai nei messaggi verso la finestra, neanche se finisce in un log', async () => {
    const t = await setup({ serverUrl: 'https://sir.example.it', watchPath: 'E:\\' });
    await t.controller.init();
    expect(t.messages()[0]).toMatchObject({ token: { present: false, last4: null } });
    t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick, token: PASTED }));
    await waitFor(() => t.lastPhase() === 'running', 5000, 'running');
    expect(
      t
        .messages()
        .filter((m) => m.type === 'init')
        .at(-1),
    ).toMatchObject({ token: { present: true, last4: 'Zz99' } });
    t.logger.info({ agentToken: PASTED }, 'redatto da pino');
    t.logger.info(`per sbaglio ${PASTED} e ${TOKEN}`);
    t.controller.handleLine(`{"type":"start","watchPath":"x","token":"${PASTED}","bad":1}`);
    await t.controller.stop();
    expect(JSON.parse(await readFile(t.configPath, 'utf8'))).toMatchObject({ agentToken: PASTED });
    const all = t.lines.join('\n');
    expect(all).not.toContain(PASTED);
    expect(all).not.toContain(PASTED.slice(0, -4));
    expect(all).toContain('per sbaglio [nascosto]');
    expect(all).toContain('messaggio della finestra non valido');
  });

  it('quit durante la lettura: agente fermato e done risolto', async () => {
    const t = await setup();
    await t.controller.init();
    t.controller.handleLine(JSON.stringify({ type: 'start', watchPath: t.dirs.stick }));
    await waitFor(() => t.lastPhase() === 'running', 5000, 'running');
    t.controller.handleLine(JSON.stringify({ type: 'quit' }));
    await t.controller.done;
    expect(t.agents.running).toBe(0);
    expect(t.lastPhase()).toBe('idle');
    // Dopo quit, START non fa più niente.
    t.controller.start(t.dirs.stick);
    expect(t.lastPhase()).toBe('idle');
  });
});
