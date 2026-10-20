import { mkdir } from 'node:fs/promises';
import type { RegistrationStatusResponse } from '@arenalive/shared';
import type { AgentStatus } from '../agent.js';
import { Agent } from '../agent.js';
import type { AgentConfig } from '../config.js';
import { ConfigError } from '../config.js';
import type { Lock } from '../lock.js';
import { LockError, acquireLock } from '../lock.js';
import type { Logger } from '../logger.js';
import type { PendingRegistration, RegistrationApi } from '../register.js';
import {
  RegistrationClient,
  RegistrationError,
  clearPendingRegistration,
  loadPendingRegistration,
  savePendingRegistration,
} from '../register.js';
import { errorMessage } from '../util.js';
import {
  guiPaths,
  readConfigFile,
  registrationDataDir,
  registrationServerUrl,
  saveTokenToFile,
  saveWatchPath,
  tokenInfo,
  windowFields,
} from './config-file.js';
import type { WindowBranding } from './branding.js';
import type { ProductAssets } from './productAssets.js';
import type { LogSink } from './log-sink.js';
import type { GuiInMessage, GuiOutMessage, GuiPhase, GuiRegistrationMessage } from './protocol.js';
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
  /** Client of the self-registration for a server (a fake one in the tests). */
  createRegistrationApi?: (serverUrl: string) => RegistrationApi;
  /** Pause between two status queries of a pending registration (default 5 s). */
  registrationPollMs?: number;
  /** Problem found before the window opened (e.g. folders on the USB stick), shown after the first state. */
  startupError?: string;
  /** Graphics of the client, sent with every `init` (absent: the default graphics). */
  branding?: WindowBranding;
  /** Logo and icon of ArenaLive next to the window script, sent with every `init`. */
  product?: ProductAssets;
}

/** Registration message without `type` (what the window shows). */
type RegistrationView = Omit<GuiRegistrationMessage, 'type'>;

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
  /** Configuration writes, one at a time (START and the token received by the registration). */
  private configWrites: Promise<unknown> = Promise.resolve();

  // Self-registration: at most one, pending (with `registration`) or being created (`registering`).
  private registration: PendingRegistration | null = null;
  private registrationApi: RegistrationApi | null = null;
  private registrationDataDir: string | null = null;
  private registering = false;
  /** Changed by every new registration and by «Annulla»: answers of an older one are ignored. */
  private registrationGen = 0;
  /** Aborts the requests in flight, on «Annulla» (replaced by a new one) and on quit. */
  private registrationAbort = new AbortController();
  private pollTimer: NodeJS.Timeout | null = null;
  /** Requests to the server in flight (awaited by `shutdown`, so a token received while closing is saved). */
  private readonly registrationTasks = new Set<Promise<void>>();
  private lastRegistration = '';
  private resolveDone: () => void = () => undefined;
  /** Resolves after `quit` (or `shutdown`), when the agent is stopped. */
  readonly done: Promise<void>;

  private readonly createAgent: (config: AgentConfig, logger: Logger) => Promise<RunnableAgent>;
  private readonly lock: (dataDir: string) => Promise<Lock>;
  private readonly statusIntervalMs: number;
  private readonly createRegistrationApi: (serverUrl: string) => RegistrationApi;
  private readonly registrationPollMs: number;

  constructor(private readonly options: GuiControllerOptions) {
    this.createAgent = options.createAgent ?? ((config, logger) => Agent.create({ config, logger }));
    this.lock = options.acquireLock ?? ((dataDir) => acquireLock(dataDir));
    this.statusIntervalMs = options.statusIntervalMs ?? 1000;
    this.createRegistrationApi =
      options.createRegistrationApi ?? ((serverUrl) => new RegistrationClient({ serverUrl }));
    this.registrationPollMs = options.registrationPollMs ?? 5000;
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  get currentPhase(): GuiPhase {
    return this.phase;
  }

  /**
   * First messages to the window: fields from `config.json`, recent log, state, registration (a pending one, saved
   * in `registration.json`, is resumed).
   */
  async init(): Promise<void> {
    await this.sendInit();
    for (const message of this.options.logSink?.recent() ?? []) this.emit(message);
    this.options.logSink?.onMessage((message) => this.emit(message));
    this.sendState();
    if (this.options.startupError) this.sendError(this.options.startupError);
    await this.resumeRegistration();
  }

  /** One line from the window. Lines that are not valid messages are dropped (logged without their content). */
  handleLine(line: string): void {
    if (line.trim() === '') return;
    const message = parseGuiLine(line);
    if (!message) {
      this.options.logger.warn({ length: line.length }, 'messaggio della finestra non valido: ignorato');
      // The window waits for an answer (e.g. after «Registra»): an error unblocks it.
      this.sendError('Richiesta della finestra non valida (nome agente: da 1 a 100 caratteri, su una riga)');
      return;
    }
    this.dispatch(message);
  }

  dispatch(message: GuiInMessage): void {
    if (message.type === 'start') this.start(message.watchPath, message.token);
    else if (message.type === 'stop') void this.stop();
    else if (message.type === 'register') this.register(message.name);
    else if (message.type === 'cancelRegistration') void this.cancelRegistration();
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
    this.clearPollTimer();
    // A query in flight ends at once; registration.json stays, the wait resumes at the next start.
    this.registrationAbort.abort();
    await this.stop();
    await Promise.all([...this.registrationTasks]);
    this.options.logSink?.onMessage(null);
    this.resolveDone();
  }

  /**
   * Saves the token in `config.json` and tells the window (present, last 4 characters). Used by START with a pasted
   * token and by the self-registration with the token received from the server.
   */
  async saveToken(token: string): Promise<void> {
    this.secrets.add(token.trim());
    const saved = await this.serializeConfig(() => saveTokenToFile(this.options.configPath, token));
    this.secrets.add(saved);
    this.options.logger.info('token agente salvato in config.json');
    await this.sendInit();
  }

  private async runSession(watchPath: string, token: string | undefined, signal: AbortSignal): Promise<void> {
    let lock: Lock | null = null;
    try {
      if (token) await this.saveToken(token);
      const config = await this.serializeConfig(() =>
        saveWatchPath(this.options.configPath, this.options.baseDir, watchPath),
      );
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

  /**
   * «Registra»: asks the server for a registration with `name`; the window then shows the pairing code and the
   * controller polls until the admin approves it. Not while reading, nor with another registration in progress.
   */
  register(name: string): void {
    if (this.finished) return;
    if (this.phase !== 'idle') {
      this.sendError('Ferma la lettura (STOP) prima di registrare l’agente');
      return;
    }
    if (this.registering || this.registration) {
      this.sendError('Registrazione già in corso: premi «Annulla» per ricominciare');
      return;
    }
    this.registering = true;
    const gen = ++this.registrationGen;
    this.track(this.createRegistration(name, gen));
  }

  /** «Annulla»: stops polling and forgets the pending registration (on the server it expires by itself). */
  async cancelRegistration(): Promise<void> {
    const dataDir = this.registrationDataDir;
    const active = this.registering || this.registration !== null;
    this.resetRegistration();
    if (dataDir) await this.removeRegistrationFile(dataDir);
    if (active) this.options.logger.info('registrazione annullata');
    this.sendRegistration({ state: 'none' });
  }

  private async createRegistration(name: string, gen: number): Promise<void> {
    try {
      const { serverUrl, dataDir } = await this.registrationContext();
      const api = this.createRegistrationApi(serverUrl);
      const created = await api.create(name, this.registrationAbort.signal);
      this.secrets.add(created.secret);
      if (gen !== this.registrationGen) return;
      const pending: PendingRegistration = { version: 1, ...created, name };
      await savePendingRegistration(dataDir, pending);
      if (gen !== this.registrationGen) {
        if (!this.finished) await this.removeRegistrationFile(dataDir);
        return;
      }
      this.registration = pending;
      this.registrationApi = api;
      this.registrationDataDir = dataDir;
      this.options.logger.info(
        { registrationId: pending.registrationId, pairingCode: pending.pairingCode },
        'richiesta di registrazione inviata: in attesa di abilitazione nel portale',
      );
      this.sendPendingRegistration();
      this.schedulePoll(gen, this.registrationPollMs);
    } catch (err) {
      if (gen !== this.registrationGen || this.finished) return;
      const message =
        err instanceof RegistrationError || err instanceof ConfigError
          ? err.message
          : `Registrazione non riuscita: ${errorMessage(err)}`;
      this.options.logger.warn({ err: message }, 'registrazione non riuscita');
      this.sendRegistration({ state: 'error', name, message });
    } finally {
      if (gen === this.registrationGen) this.registering = false;
    }
  }

  /** A registration left pending by a previous run (`registration.json`): shown and polled at once. */
  private async resumeRegistration(): Promise<void> {
    if (this.registering || this.registration) return;
    const read = await readConfigFile(this.options.configPath);
    const raw = read.kind === 'ok' ? read.raw : null;
    let dataDir: string;
    try {
      dataDir = raw ? registrationDataDir(raw, this.options.baseDir) : guiPaths(null, this.options.baseDir).dataDir;
    } catch (err) {
      // dataDir on the USB stick: nothing is read, resumed or written there (START reports the same error).
      const message = err instanceof ConfigError ? err.message : errorMessage(err);
      this.options.logger.warn({ err: message }, 'registrazione in attesa non ripresa');
      this.sendRegistration({ state: 'error', message });
      return;
    }
    let pending: PendingRegistration | null;
    try {
      pending = await loadPendingRegistration(dataDir);
    } catch (err) {
      this.options.logger.warn({ err: errorMessage(err) }, 'registration.json illeggibile');
      pending = null;
    }
    if (!pending) {
      this.sendRegistration({ state: 'none' });
      return;
    }
    this.secrets.add(pending.secret);
    let serverUrl: string;
    try {
      if (read.kind !== 'ok') throw new ConfigError('CONFIG_INVALID', read.message);
      serverUrl = registrationServerUrl(read.raw);
    } catch (err) {
      // registration.json is kept: the wait resumes once config.json is fixed.
      const message = err instanceof ConfigError ? err.message : errorMessage(err);
      this.sendRegistration({ state: 'error', name: pending.name, message });
      return;
    }
    const gen = ++this.registrationGen;
    this.registration = pending;
    this.registrationApi = this.createRegistrationApi(serverUrl);
    this.registrationDataDir = dataDir;
    this.options.logger.info({ registrationId: pending.registrationId }, 'registrazione in attesa ripresa');
    this.sendPendingRegistration();
    this.schedulePoll(gen, 0);
  }

  private schedulePoll(gen: number, delayMs: number): void {
    if (this.finished || gen !== this.registrationGen || !this.registration) return;
    this.clearPollTimer();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.track(this.poll(gen));
    }, delayMs);
  }

  /** One status query; the next one is scheduled only when this one is over (never two at the same time). */
  private async poll(gen: number): Promise<void> {
    const registration = this.registration;
    const api = this.registrationApi;
    const dataDir = this.registrationDataDir;
    if (!registration || !api || !dataDir || gen !== this.registrationGen) return;
    const name = registration.name;
    let status: RegistrationStatusResponse;
    try {
      status = await api.status(registration.secret, this.registrationAbort.signal);
    } catch (err) {
      if (gen !== this.registrationGen || this.finished) return;
      if (err instanceof RegistrationError && err.code === 'UNAUTHORIZED') {
        this.options.logger.warn('registrazione non riconosciuta dal server');
        await this.finishRegistration(gen, dataDir, { state: 'error', name, message: err.message });
        return;
      }
      const message = err instanceof RegistrationError ? err.message : errorMessage(err);
      this.options.logger.warn({ err: message }, 'stato della registrazione non letto: nuovo tentativo');
      this.sendPendingRegistration(`${message}: nuovo tentativo tra ${Math.round(this.registrationPollMs / 1000)} s`);
      this.schedulePoll(gen, this.registrationPollMs);
      return;
    }
    if (status.status === 'approved') this.secrets.add(status.token);
    if (gen !== this.registrationGen) {
      if (status.status === 'approved') {
        this.options.logger.warn(
          { agentId: status.agentId },
          'token ricevuto dopo l’annullamento della registrazione: ignorato (revoca l’agente dal portale)',
        );
      }
      return;
    }
    switch (status.status) {
      case 'pending':
        registration.expiresAt = status.expiresAt;
        this.sendPendingRegistration();
        this.schedulePoll(gen, this.registrationPollMs);
        return;
      case 'approved':
        try {
          await this.saveToken(status.token);
        } catch (err) {
          const detail = err instanceof ConfigError ? err.message : errorMessage(err);
          this.options.logger.error({ err: detail }, 'token ricevuto ma non salvato in config.json');
          await this.finishRegistration(gen, dataDir, {
            state: 'error',
            name,
            message: `Token ricevuto ma non salvato in config.json (${detail}): registra di nuovo`,
          });
          return;
        }
        this.options.logger.info({ agentId: status.agentId }, 'agente registrato: token salvato in config.json');
        await this.finishRegistration(gen, dataDir, {
          state: 'approved',
          name,
          // While reading, the running agent keeps the token it started with.
          ...(this.phase === 'idle' ? {} : { message: 'Token salvato: vale dal prossimo START' }),
        });
        this.sendState();
        return;
      default:
        this.options.logger.info({ status: status.status }, 'registrazione conclusa senza token');
        await this.finishRegistration(gen, dataDir, { state: status.status, name });
    }
  }

  /** The registration is over: `registration.json` deleted, final state to the window. */
  private async finishRegistration(gen: number, dataDir: string, view: RegistrationView): Promise<void> {
    // A newer registration (or «Annulla») owns registration.json now: it is not touched.
    if (gen !== this.registrationGen) return;
    await this.removeRegistrationFile(dataDir);
    if (gen !== this.registrationGen) return;
    this.registration = null;
    this.registrationApi = null;
    this.registrationDataDir = null;
    this.sendRegistration(view);
  }

  private resetRegistration(): void {
    this.registrationGen++;
    this.registrationAbort.abort();
    this.registrationAbort = new AbortController();
    this.clearPollTimer();
    this.registration = null;
    this.registrationApi = null;
    this.registrationDataDir = null;
    this.registering = false;
  }

  private clearPollTimer(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private track(task: Promise<void>): void {
    this.registrationTasks.add(task);
    void task.finally(() => this.registrationTasks.delete(task));
  }

  private async removeRegistrationFile(dataDir: string): Promise<void> {
    try {
      await clearPendingRegistration(dataDir);
    } catch (err) {
      this.options.logger.warn({ err: errorMessage(err) }, 'registration.json non cancellato');
    }
  }

  /** Server and data folder for the registration, from `config.json`. Throws `ConfigError`. */
  private async registrationContext(): Promise<{ serverUrl: string; dataDir: string }> {
    const read = await readConfigFile(this.options.configPath);
    if (read.kind === 'missing') throw new ConfigError('CONFIG_NOT_FOUND', read.message);
    if (read.kind === 'invalid') throw new ConfigError('CONFIG_INVALID_JSON', read.message);
    const serverUrl = registrationServerUrl(read.raw);
    return { serverUrl, dataDir: registrationDataDir(read.raw, this.options.baseDir) };
  }

  /** Runs `write` after the configuration writes already queued. */
  private serializeConfig<T>(write: () => Promise<T>): Promise<T> {
    const run = this.configWrites.then(write, write);
    this.configWrites = run.catch(() => undefined);
    return run;
  }

  private sendPendingRegistration(message?: string): void {
    const r = this.registration;
    if (!r) return;
    this.sendRegistration({
      state: 'pending',
      name: r.name,
      pairingCode: r.pairingCode,
      expiresAt: r.expiresAt,
      ...(message ? { message } : {}),
    });
  }

  /** Sends the registration state; a `pending` equal to the last message is skipped (the poll repeats it). */
  private sendRegistration(view: RegistrationView): void {
    const key = JSON.stringify(view);
    if (view.state === 'pending' && key === this.lastRegistration) return;
    this.lastRegistration = key;
    this.emit({ type: 'registration', ...view });
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
      ...(this.options.branding ? { branding: this.options.branding } : {}),
      ...(this.options.product ? { product: this.options.product } : {}),
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
