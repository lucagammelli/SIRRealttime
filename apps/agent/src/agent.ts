import { AGENT_EXPIRED_ERROR, INGEST_PROTOCOL, IngestRequestSchema, hashScoutLines } from '@sir/shared';
import type { IngestRequest, IngestResponse } from '@sir/shared';
import { usesPlainHttpOnPrivateNetwork, type AgentConfig } from './config.js';
import type { DvwContent } from './dvw.js';
import { bytesHash, deriveMatchKey, readDvw, suspicion } from './dvw.js';
import type { Logger } from './logger.js';
import type { FetchLike } from './sender.js';
import { Sender } from './sender.js';
import type { MatchRecord } from './store.js';
import { MatchStore, newRecord } from './store.js';
import type { PlannedRequest } from './sync.js';
import { planRequests } from './sync.js';
import { errorMessage, sleep } from './util.js';
import { FileWatcher } from './watcher.js';

export interface AgentTiming {
  /** First retry delay after a network error or a 5xx; doubles at each failure (with jitter). */
  retryBaseMs: number;
  retryMaxMs: number;
  /** Pause after a 401/403 (token not valid or revoked). */
  authPauseMs: number;
  /** Period of the status line in the log. */
  statusIntervalMs: number;
  /** Read the file again after this long even if size and mtime did not change. */
  rereadMs: number;
  /** A file that keeps changing is read anyway after this long (see `WatcherOptions.maxWaitMs`). */
  maxWaitMs: number;
  requestTimeoutMs: number;
  /** More queued messages than this for one match: the queue is replaced by a single snapshot. */
  compactThreshold: number;
}

export const DEFAULT_TIMING: AgentTiming = {
  retryBaseMs: 1000,
  retryMaxMs: 30_000,
  authPauseMs: 60_000,
  statusIntervalMs: 60_000,
  rereadMs: 10_000,
  maxWaitMs: 2000,
  requestTimeoutMs: 15_000,
  compactThreshold: 20,
};

export interface AgentOptions {
  config: AgentConfig;
  logger: Logger;
  timing?: Partial<AgentTiming>;
  fetch?: FetchLike;
  now?: () => number;
  random?: () => number;
}

export interface AgentStatus {
  file: string | null;
  matchKey: string | null;
  lines: number;
  queue: number;
  lastSuccessAt: string | null;
  serverReachable: boolean;
  /** The server answered that the registration has expired: register again (the queue is kept). */
  registrationExpired: boolean;
}

const AUTH_MESSAGE = 'token agente non valido o revocato';

/** Reads the `.dvw`, queues the differences and delivers them in order. One instance per process. */
export class Agent {
  private readonly watcher: FileWatcher;
  private readonly sender: Sender;
  private readonly timing: AgentTiming;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly log: Logger;

  private currentFile: string | null = null;
  private currentKey: string | null = null;
  private missing = false;
  private busyPolls = 0;
  private pendingHash: string | null = null;
  private lastNotice = '';
  private failures = 0;
  private nextAttemptAt = 0;
  private authBlocked = false;
  private registrationExpired = false;
  private serverReachable = true;
  private lastSuccessAt: number | null = null;
  private lastStatusAt = 0;
  /** A stable read was processed (sent, queued or found unchanged): used by `--once`. */
  private settled = false;

  private constructor(
    private readonly config: AgentConfig,
    private readonly store: MatchStore,
    options: AgentOptions,
  ) {
    this.timing = { ...DEFAULT_TIMING, ...options.timing };
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.log = options.logger;
    this.watcher = new FileWatcher(config.watchPath, {
      stableMs: config.stableMs,
      rereadMs: this.timing.rereadMs,
      maxWaitMs: this.timing.maxWaitMs,
    });
    this.sender = new Sender({
      serverUrl: config.serverUrl,
      agentToken: config.agentToken,
      timeoutMs: this.timing.requestTimeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  /** Loads queue and state from `dataDir`. */
  static async create(options: AgentOptions): Promise<Agent> {
    const store = new MatchStore(options.config.dataDir, {
      days: options.config.retentionDays,
      now: options.now ?? Date.now,
    });
    const warnings = await store.load();
    for (const w of warnings) options.logger.warn({ file: w.file }, w.reason);
    const agent = new Agent(options.config, store, options);
    await agent.resyncUnconfirmed();
    const queued = store.queueSize();
    if (queued > 0) options.logger.info({ queue: queued }, 'coda ripresa dal disco');
    return agent;
  }

  status(): AgentStatus {
    const record = this.currentKey ? this.store.get(this.currentKey) : undefined;
    return {
      file: this.currentFile,
      matchKey: this.currentKey,
      lines: record?.base?.lines.length ?? 0,
      queue: this.store.queueSize(),
      lastSuccessAt: this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
      serverReachable: this.serverReachable,
      registrationExpired: this.registrationExpired,
    };
  }

  /** Main loop, until `signal` is aborted. Never throws. */
  async run(signal: AbortSignal): Promise<void> {
    this.log.info(
      { watchPath: this.config.watchPath, serverUrl: this.config.serverUrl, dataDir: this.config.dataDir },
      'agente avviato',
    );
    if (usesPlainHttpOnPrivateNetwork(this.config.serverUrl, this.config.allowHttpPrivateNetwork)) {
      this.log.warn(
        `connessione senza cifratura verso ${new URL(this.config.serverUrl).host}: usare https in produzione`,
      );
    }
    while (!signal.aborted) {
      await this.step();
      await sleep(this.config.pollIntervalMs, signal);
    }
    this.log.info(this.status(), 'agente fermato');
  }

  /**
   * `--once`: waits for a stable read (at most `timeoutMs`), sends the queue once and returns the exit code:
   * 0 everything delivered, 2 messages left in the queue, 3 no file read.
   */
  async runOnce(timeoutMs: number, signal?: AbortSignal): Promise<number> {
    this.log.info({ watchPath: this.config.watchPath, serverUrl: this.config.serverUrl }, 'esecuzione singola');
    const deadline = this.now() + timeoutMs;
    while (!this.settled && this.now() < deadline && !signal?.aborted) {
      await this.poll();
      if (!this.settled) await sleep(this.config.pollIntervalMs, signal);
    }
    this.nextAttemptAt = 0;
    this.authBlocked = false;
    await this.flush(true);
    const status = this.status();
    this.log.info(status, 'esecuzione singola terminata');
    if (!this.settled) return 3;
    return status.queue === 0 ? 0 : 2;
  }

  /** One poll of the file and one delivery attempt. Never throws. */
  async step(): Promise<void> {
    await this.poll();
    await this.retryRefusedSnapshots();
    await this.flush(false);
    const now = this.now();
    if (now - this.lastStatusAt >= this.timing.statusIntervalMs) {
      this.lastStatusAt = now;
      this.log.info(this.status(), 'stato');
    }
  }

  private async poll(): Promise<void> {
    try {
      const event = await this.watcher.poll(this.now());
      if (event.type === 'missing') {
        if (!this.missing)
          this.log.warn({ reason: event.reason }, 'file .dvw non disponibile (pennina tolta?): in attesa');
        this.missing = true;
        return;
      }
      if (this.missing) {
        this.missing = false;
        this.log.info({ watchPath: this.config.watchPath }, 'file .dvw di nuovo disponibile');
      }
      if (event.type === 'busy') {
        this.busyPolls++;
        if (this.busyPolls === 10)
          this.log.warn({ file: event.path, code: event.code }, 'file bloccato da DataVolley, nuovo tentativo');
        return;
      }
      this.busyPolls = 0;
      if (event.type === 'read') await this.handleRead(event.path, event.bytes);
    } catch (err) {
      this.log.error({ err: errorMessage(err) }, 'errore nella lettura del file');
    }
  }

  /** Logs `message` only if different from the previous notice (no spam at every poll). */
  private notice(level: 'info' | 'warn', data: object, message: string): void {
    const key = `${message}|${JSON.stringify(data)}`;
    if (key === this.lastNotice) return;
    this.lastNotice = key;
    this.log[level](data, message);
  }

  private async handleRead(path: string, bytes: Uint8Array): Promise<void> {
    const read = readDvw(bytes);
    if (read.kind === 'incomplete') {
      this.notice('warn', { file: path, reason: read.reason }, 'lettura incompleta, attendo la prossima scrittura');
      this.watcher.requestReread();
      return;
    }
    const matchKey = deriveMatchKey(read.content.header, path);
    const record = this.store.get(matchKey) ?? newRecord(matchKey);
    const doubt = suspicion(read, record.base);
    if (doubt) {
      const hash = bytesHash(bytes);
      if (hash !== this.pendingHash) {
        this.pendingHash = hash;
        this.notice('info', { file: path, reason: doubt }, 'contenuto da confermare con una seconda lettura');
        this.watcher.requestReread();
        return;
      }
      this.log.info({ file: path, reason: doubt }, 'contenuto confermato da due letture uguali');
    }
    this.pendingHash = null;
    if (matchKey !== this.currentKey) this.log.info({ file: path, matchKey }, 'partita in lettura');
    this.currentFile = path;
    this.currentKey = matchKey;
    await this.enqueue(record, read.content, path);
    this.settled = true;
  }

  /** Queues the requests that bring the server to `content`; false if the content cannot be sent. */
  private async enqueue(record: MatchRecord, content: DvwContent, sourceFile: string): Promise<boolean> {
    let planned = await planRequests(record.base, content, record.forceSnapshot);
    if (planned.length === 0) return true;
    let queue = record.queue;
    if (queue.length + planned.length > this.timing.compactThreshold) {
      // Long queue (server unreachable): one snapshot of the current content replaces everything.
      planned = await planRequests(null, content);
      queue = [];
      this.log.info({ matchKey: record.matchKey }, 'coda compattata in uno snapshot');
    }
    let seq = record.nextSeq;
    const requests: IngestRequest[] = [];
    for (const p of planned) {
      const candidate = this.toRequest(record.matchKey, seq++, p);
      const valid = IngestRequestSchema.safeParse(candidate);
      if (!valid.success) {
        const where = valid.error.issues.map((i) => i.path.join('.')).join(', ');
        this.notice(
          'warn',
          { matchKey: record.matchKey, where },
          'contenuto non inviabile (righe non valide), ignorato',
        );
        return false;
      }
      requests.push(valid.data);
    }
    const { retrySnapshotAt: _retry, ...rest } = record;
    await this.store.save({
      ...rest,
      nextSeq: seq,
      base: content,
      forceSnapshot: false,
      sourceFile,
      queue: [...queue, ...requests.map((request) => ({ request, order: this.store.nextOrder() }))],
    });
    this.log.debug(
      { matchKey: record.matchKey, requests: requests.map((r) => `${r.kind}:${r.seq}:${r.lines.length}`) },
      'accodato',
    );
    return true;
  }

  private toRequest(matchKey: string, seq: number, p: PlannedRequest): IngestRequest {
    return {
      protocol: INGEST_PROTOCOL,
      matchKey,
      seq,
      kind: p.kind,
      fromIndex: p.fromIndex,
      lines: p.lines,
      ...(p.header !== undefined ? { header: p.header } : {}),
      contentHash: p.contentHash,
    };
  }

  /** Replaces the queue of a match with a snapshot of its current content (if known). */
  private async resnapshot(record: MatchRecord, minSeq: number): Promise<MatchRecord> {
    const nextSeq = Math.max(record.nextSeq, minSeq);
    const cleared: MatchRecord = { ...record, nextSeq, queue: [], base: null };
    if (!record.base) {
      const updated = { ...cleared, forceSnapshot: true };
      await this.store.save(updated);
      return updated;
    }
    if (!(await this.enqueue(cleared, record.base, record.sourceFile ?? ''))) {
      // Never leave the refused message at the head of the queue (it would be sent again at once).
      await this.store.save({ ...cleared, forceSnapshot: true });
    }
    return this.store.get(record.matchKey) ?? cleared;
  }

  /**
   * A snapshot refused by the server (4xx/413) is queued again after `snapshotRetryMs`, even if the file did not
   * change: otherwise the last actions of a match would never reach the server.
   */
  private async retryRefusedSnapshots(): Promise<void> {
    const now = this.now();
    for (const record of this.store.all()) {
      if (!record.forceSnapshot || !record.base || record.queue.length > 0) continue;
      if (record.retrySnapshotAt === undefined || now < record.retrySnapshotAt) continue;
      this.log.info({ matchKey: record.matchKey }, 'nuovo tentativo dello snapshot rifiutato');
      try {
        await this.resnapshot(record, record.nextSeq);
      } catch (err) {
        this.log.error({ err: errorMessage(err) }, 'errore nel nuovo tentativo dello snapshot');
      }
    }
  }

  /** At start-up: a match whose last content was never confirmed and has nothing queued is sent again. */
  private async resyncUnconfirmed(): Promise<void> {
    for (const record of this.store.all()) {
      if (record.queue.length > 0 || !record.base) continue;
      const hash = await hashScoutLines(record.base.lines);
      if (record.confirmed?.contentHash === hash) continue;
      this.log.info({ matchKey: record.matchKey }, 'stato non confermato dal server: nuovo snapshot');
      await this.resnapshot(record, record.nextSeq);
    }
  }

  private backoff(retryAfterMs = 0): void {
    this.failures++;
    const delay = Math.min(this.timing.retryMaxMs, this.timing.retryBaseMs * 2 ** Math.min(this.failures - 1, 20));
    const jittered = delay / 2 + (this.random() * delay) / 2;
    this.nextAttemptAt = this.now() + Math.max(jittered, Math.min(retryAfterMs, 60_000));
  }

  private delivered(): void {
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.lastSuccessAt = this.now();
    if (!this.serverReachable || this.authBlocked) this.log.info('server di nuovo raggiungibile');
    this.serverReachable = true;
    this.authBlocked = false;
  }

  /** Delivers the queue in order until it is empty or a request fails. `force`: ignore the backoff. */
  private async flush(force: boolean): Promise<void> {
    try {
      while (force || this.now() >= this.nextAttemptAt) {
        const record = this.store.nextToSend();
        const head = record?.queue[0];
        if (!record || !head) return;
        const ok = await this.deliver(record, head.request);
        if (!ok) return;
      }
    } catch (err) {
      this.log.error({ err: errorMessage(err) }, 'errore nella gestione della coda');
      this.backoff();
    }
  }

  /** Sends the first message of the queue of `record`; false when delivery must stop for now. */
  private async deliver(record: MatchRecord, request: IngestRequest): Promise<boolean> {
    const result = await this.sender.send(request);
    const ctx = { matchKey: request.matchKey, seq: request.seq, kind: request.kind, lines: request.lines.length };
    if (result.type === 'network') {
      if (this.serverReachable)
        this.log.warn(
          { ...ctx, err: result.message, queue: this.store.queueSize() },
          'server non raggiungibile: i dati restano in coda',
        );
      this.serverReachable = false;
      this.backoff();
      return false;
    }
    if (result.type === 'http') {
      this.registrationExpired = result.expired === true;
      return this.handleHttpError(record, request, result.status, result.retryAfterMs, ctx);
    }
    this.registrationExpired = false;
    this.delivered();
    await this.handleResponse(record, request, result.response, ctx);
    return true;
  }

  private async handleResponse(
    record: MatchRecord,
    request: IngestRequest,
    response: IngestResponse,
    ctx: object,
  ): Promise<void> {
    const confirmed = {
      seq: response.seq,
      lineCount: response.lineCount,
      ...(response.contentHash ? { contentHash: response.contentHash } : {}),
      at: new Date(this.now()).toISOString(),
    };
    const inSync =
      response.status === 'ok' ||
      (response.status === 'duplicate' && response.seq === request.seq && response.contentHash === request.contentHash);
    if (inSync) {
      this.log.debug({ ...ctx, status: response.status }, 'inviato');
      await this.store.save({
        ...record,
        nextSeq: Math.max(record.nextSeq, response.seq + 1),
        confirmed,
        queue: record.queue.slice(1),
      });
      return;
    }
    const updated = { ...record, confirmed };
    if (response.status === 'needSnapshot' && request.kind === 'snapshot') {
      // Should not happen (a snapshot carries the header): do not loop, wait for the next change.
      this.log.error(
        { ...ctx, status: response.status },
        'snapshot rifiutato dal server: riprovo alla prossima modifica o più tardi',
      );
      await this.store.save({
        ...updated,
        nextSeq: Math.max(record.nextSeq, response.seq + 1),
        queue: [],
        forceSnapshot: true,
        retrySnapshotAt: this.now() + this.config.snapshotRetryMs,
      });
      return;
    }
    this.log.warn(
      { ...ctx, status: response.status, serverSeq: response.seq },
      'server non allineato: invio uno snapshot',
    );
    await this.resnapshot(updated, response.seq + 1);
  }

  private async handleHttpError(
    record: MatchRecord,
    request: IngestRequest,
    status: number,
    retryAfterMs: number | undefined,
    ctx: object,
  ): Promise<boolean> {
    if (status === 401 || status === 403) {
      if (!this.authBlocked) {
        const what = this.registrationExpired ? AGENT_EXPIRED_ERROR : AUTH_MESSAGE;
        this.log.error(
          { status, queue: this.store.queueSize() },
          `${what}: nuovo tentativo tra ${Math.round(this.timing.authPauseMs / 1000)} s, la coda è conservata`,
        );
      }
      this.authBlocked = true;
      this.nextAttemptAt = this.now() + this.timing.authPauseMs;
      return false;
    }
    if (status === 408 || status === 429 || status >= 500) {
      if (this.serverReachable) this.log.warn({ ...ctx, status }, 'errore temporaneo del server: nuovo tentativo');
      this.serverReachable = false;
      this.backoff(retryAfterMs);
      return false;
    }
    // Other 4xx: the request will never be accepted. Drop it; the match is realigned with a snapshot.
    this.failures = 0;
    this.serverReachable = true;
    if (status === 413) {
      this.log.error(
        { ...ctx, status },
        'richiesta troppo grande per il server (413): scartata, riprovo con uno snapshot alla prossima modifica o più tardi',
      );
    } else {
      this.log.error({ ...ctx, status }, 'richiesta rifiutata dal server: scartata');
    }
    if (status === 413 || request.kind === 'snapshot') {
      await this.store.save({
        ...record,
        queue: [],
        forceSnapshot: true,
        retrySnapshotAt: this.now() + this.config.snapshotRetryMs,
      });
    } else {
      await this.resnapshot({ ...record, queue: [] }, record.nextSeq);
    }
    return true;
  }
}
