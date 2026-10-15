import { mkdir } from 'node:fs/promises';
import type { AgentStatus } from '../agent.js';
import { Agent } from '../agent.js';
import type { AgentConfig } from '../config.js';
import { ConfigError } from '../config.js';
import type { Lock } from '../lock.js';
import { LockError, acquireLock } from '../lock.js';
import type { Logger } from '../logger.js';
import { errorMessage } from '../util.js';
import { readConfigFile, saveTokenToFile, saveWatchPath, tokenInfo, windowFields } from './config-file.js';
import type { LogSink } from './log-sink.js';
import type { GuiInMessage, GuiOutMessage, GuiPhase } from './protocol.js';
import { parseGuiLine } from './protocol.js';

/** What the controller needs of an `Agent` (a fake one in the tests). */
export interface RunnableAgent {
  run: (signal: AbortSignal) => Promise<void>;
  status: () => AgentStatus;
}

export interface GuiControllerOptions {
  configPath: string;
  baseDir: string;
  logger: Logger;
  /** Writes one line (JSON, without the newline) to the window. */
  send: (line: string) => void;
  /** Messages of the log shown in the window. */
  logSink?: LogSink;
  createAgent?: (config: AgentConfig, logger: Logger) => Promise<RunnableAgent>;
  acquireLock?: (dataDir: string) => Promise<Lock>;
  statusIntervalMs?: number;
}

const REDACTED = '[nascosto]';

/**
 * State machine of the window: idle → starting → running → stopping → idle. START saves `config.json`, validates
 * it, takes the lock and runs the agent until STOP; QUIT stops and ends `done`.
 */
export class GuiController {
  private phase: GuiPhase = 'idle';
  private abort: AbortController | null = null;
  private session: Promise<void> | null = null;
  private agent: RunnableAgent | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Tokens seen (file and window): removed from every outgoing line, as a second line of defence. */
  private readonly secrets = new Set<string>();
  private finished = false;
  private resolveDone: () => void = () => undefined;
  /** Resolves after `quit` (or `shutdown`), when the agent is stopped. */
  readonly done: Promise<void>;

  private readonly createAgent: (config: AgentConfig, logger: Logger) => Promise<RunnableAgent>;
  private readonly lock: (dataDir: string) => Promise<Lock>;
  private readonly statusIntervalMs: number;

  constructor(private readonly options: GuiControllerOptions) {
    this.createAgent = options.createAgent ?? ((config, logger) => Agent.create({ config, logger }));
    this.lock = options.acquireLock ?? ((dataDir) => acquireLock(dataDir));
    this.statusIntervalMs = options.statusIntervalMs ?? 1000;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get currentPhase(): GuiPhase {
    return this.phase;
  }

  /** First messages to the window: fields from `config.json`, recent log, state. */
  async init(): Promise<void> {
    await this.sendInit();
    for (const message of this.options.logSink?.recent() ?? []) this.emit(message);
    this.options.logSink?.onMessage((message) => this.emit(message));
    this.sendState();
  }

  /** One line from the window. Lines that are not valid messages are dropped (logged without their content). */
  handleLine(line: string): void {
    if (line.trim() === '') return;
    const message = parseGuiLine(line);
    if (!message) {
      this.options.logger.warn({ length: line.length }, 'messaggio della finestra non valido: ignorato');
      return;
    }
    this.dispatch(message);
  }

  dispatch(message: GuiInMessage): void {
    if (message.type === 'start') this.start(message.watchPath, message.token);
    else if (message.type === 'stop') void this.stop();
    else void this.shutdown();
  }

  start(watchPath: string, token?: string): void {
    if (this.finished) return;
    if (this.phase !== 'idle') {
      this.sendError('La lettura è già avviata: premi STOP prima di un nuovo START');
      return;
    }
    const pasted = token?.trim();
    if (pasted) this.secrets.add(pasted);
    const abort = new AbortController();
    this.abort = abort;
    this.setPhase('starting');
    this.session = this.runSession(watchPath, pasted || undefined, abort.signal);
  }

  /** STOP: aborts the start-up or the loop and waits for the agent to end. */
  async stop(): Promise<void> {
    if (this.phase === 'idle') return;
    if (this.phase !== 'stopping') {
      this.setPhase('stopping');
      this.abort?.abort();
    }
    await this.session;
  }

  /** QUIT, or the window is gone: stops the agent and ends `done`. Idempotent. */
  async shutdown(): Promise<void> {
    this.finished = true;
    await this.stop();
    this.options.logSink?.onMessage(null);
    this.resolveDone();
  }

  /**
   * Saves the token in `config.json` and tells the window (present, last 4 characters). Used by START with a pasted
   * token; the self-registration will use it with the token received from the server.
   */
  async saveToken(token: string): Promise<void> {
    this.secrets.add(token.trim());
    const saved = await saveTokenToFile(this.options.configPath, token);
    this.secrets.add(saved);
    this.options.logger.info('token agente salvato in config.json');
    await this.sendInit();
  }

  private async runSession(watchPath: string, token: string | undefined, signal: AbortSignal): Promise<void> {
    let lock: Lock | null = null;
    try {
      if (token) await this.saveToken(token);
      const config = await saveWatchPath(this.options.configPath, this.options.baseDir, watchPath);
      this.secrets.add(config.agentToken);
      await this.sendInit();
      if (signal.aborted) return;
      await mkdir(config.dataDir, { recursive: true });
      lock = await this.lock(config.dataDir);
      if (signal.aborted) return;
      const agent = await this.createAgent(config, this.options.logger);
      if (signal.aborted) return;
      this.agent = agent;
      this.setPhase('running');
      this.timer = setInterval(() => this.sendState(), this.statusIntervalMs);
      await agent.run(signal);
    } catch (err) {
      const known = err instanceof ConfigError || err instanceof LockError;
      const message = known ? err.message : `Avvio non riuscito: ${errorMessage(err)}`;
      this.options.logger.error({ err: message }, 'START non riuscito');
      this.sendError(message);
    } finally {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      try {
        await lock?.release();
      } catch (err) {
        this.options.logger.warn({ err: errorMessage(err) }, 'lucchetto non rimosso');
      }
      this.abort = null;
      this.session = null;
      this.agent = null;
      this.setPhase('idle');
    }
  }

  private async sendInit(): Promise<void> {
    const read = await readConfigFile(this.options.configPath);
    const raw = read.kind === 'ok' ? read.raw : null;
    const info = tokenInfo(raw);
    const saved = raw?.['agentToken'];
    if (typeof saved === 'string' && saved !== '') this.secrets.add(saved);
    this.emit({
      type: 'init',
      ...windowFields(raw),
      token: info,
      ...(read.kind === 'ok' ? {} : { configError: read.message }),
    });
  }

  private setPhase(phase: GuiPhase): void {
    this.phase = phase;
    this.sendState();
  }

  private sendState(): void {
    this.emit({ type: 'state', phase: this.phase, status: this.agent?.status() ?? null });
  }

  private sendError(message: string): void {
    this.emit({ type: 'error', message });
  }

  private emit(message: GuiOutMessage): void {
    let line = JSON.stringify(message);
    for (const secret of this.secrets) {
      if (secret.length >= 4 && line.includes(secret)) line = line.split(secret).join(REDACTED);
    }
    try {
      this.options.send(line);
    } catch (err) {
      // The window may be gone: the host notices and shuts down.
      this.options.logger.debug({ err: errorMessage(err) }, 'messaggio alla finestra non inviato');
    }
  }
}
