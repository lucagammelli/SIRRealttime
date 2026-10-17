#!/usr/bin/env node
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { decodeDvw, parseDvw } from '@sir/dvw-parser';
import type { IngestRequest, JsonValue } from '@sir/shared';
import {
  buildDvwText,
  diffJson,
  hashScoutLines,
  MeResponseSchema,
  splitDvwText,
  TenantSummarySchema,
} from '@sir/shared';
import { computeMatchState } from '@sir/volley-stats';
import { canonicalJson, stepCounts, summarize } from './metrics.js';
import type { ChildEvent, ParentCommand, ReadyEvent, ResultEvent } from './spectators.js';
import { runSpectatorProcess } from './spectators.js';
import { tenantForBase } from './tenant.js';

export const HELP = `carico: prova di carico dei WebSocket pubblici di SIRRealtime

Uso:
  carico prova --url <http://host:porta> (--token <link> | --admin-email <e> --admin-password <p>) [opzioni]
  carico dimensioni --dvw <file>

prova: apre N WebSocket pubblici, riproduce la partita del .dvw tramite l'ingest e misura la consegna.
  --url U            indirizzo del server (http o https)
  --token T          token del link pubblico; senza, la prova crea agente e link con l'account admin
  --agent-token A    token agente per l'ingest (senza: creato con l'account admin)
  --admin-email E    --admin-password P   account admin del cliente dell'hostname
  --clients N        spettatori (default 1000)
  --rate R           connessioni al secondo (default 200)
  --workers W        processi che aprono gli spettatori (default 2)
  --gzip             dichiara enc=gzip sull'URL del WebSocket
  --dvw F            partita da riprodurre (senza: misura solo le connessioni)
  --step point|line  un ingest per punto (default) o per riga
  --interval MS      pausa tra due ingest (default 300)
  --max-steps K      al massimo K ingest
  --verify K         spettatori che applicano i patch e confrontano lo stato finale (default 3)
  --settle MS        attesa dopo l'ultimo ingest (default 3000)
  --server-pid P     legge CPU e memoria del processo del server da /proc (solo Linux)
  --json F           scrive anche i risultati in JSON
dimensioni: byte dello stato completo e dei patch, punto per punto, in chiaro e con gzip.
`;

const now = (): number => performance.timeOrigin + performance.now();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const ms = (v: number): string => (Number.isNaN(v) ? '-' : `${Math.round(v)} ms`);

function int(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Numero non valido: ${value}`);
  return n;
}

async function api(base: string, path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.cookie) headers.set('cookie', init.cookie);
  return fetch(new URL(path, base), { ...init, headers });
}

/**
 * Agent and live link created with the account given: an admin of a client works on its own client; a superadmin
 * first enters a client (`POST /api/admin/active-tenant`, see `tenantForBase`), otherwise every admin route is a 409.
 */
async function setup(base: string, email: string, password: string): Promise<{ agent: string; share: string }> {
  const login = await api(base, '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (!login.ok) throw new Error(`login fallito: ${login.status}`);
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const me = MeResponseSchema.parse(await login.json());
  if (me.role === 'superadmin') {
    const list = await api(base, '/api/admin/tenants', { cookie });
    if (!list.ok) throw new Error(`elenco dei clienti fallito: ${list.status}`);
    const tenant = tenantForBase(TenantSummarySchema.array().parse(await list.json()), base);
    if (!tenant) throw new Error('nessun cliente in cui entrare: usa un admin di un cliente');
    const enter = await api(base, '/api/admin/active-tenant', {
      method: 'POST',
      cookie,
      body: JSON.stringify({ tenantId: tenant.id }),
    });
    if (!enter.ok) throw new Error(`ingresso nel cliente fallito: ${enter.status}`);
  }
  const agentRes = await api(base, '/api/admin/agents', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ name: 'prova di carico' }),
  });
  if (!agentRes.ok) throw new Error(`creazione agente fallita: ${agentRes.status}`);
  const shareRes = await api(base, '/api/admin/share-tokens', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ label: 'prova di carico', matchId: null, expiresAt: null }),
  });
  if (!shareRes.ok) throw new Error(`creazione link fallita: ${shareRes.status}`);
  const agent = ((await agentRes.json()) as { token: string }).token;
  const share = ((await shareRes.json()) as { token: string }).token;
  return { agent, share };
}

/** CPU (share of one core) and peak memory of a process, sampled from /proc. */
class ProcSampler {
  private timer: NodeJS.Timeout | null = null;
  private startTicks = 0;
  private startAt = 0;
  peakRss = 0;
  constructor(private readonly pid: number) {}
  private async ticks(): Promise<number> {
    const stat = await readFile(`/proc/${this.pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(fields[11]) + Number(fields[12]);
  }
  private async rss(): Promise<number> {
    const status = await readFile(`/proc/${this.pid}/status`, 'utf8');
    const m = /VmRSS:\s+(\d+) kB/.exec(status);
    return m ? Number(m[1]) * 1024 : 0;
  }
  async start(): Promise<void> {
    this.startTicks = await this.ticks();
    this.startAt = now();
    this.timer = setInterval(() => {
      void this.rss().then((r) => (this.peakRss = Math.max(this.peakRss, r)));
    }, 250);
  }
  async stop(): Promise<{ cpu: number; peakRss: number }> {
    if (this.timer) clearInterval(this.timer);
    const ticks = (await this.ticks()) - this.startTicks;
    const seconds = (now() - this.startAt) / 1000;
    return { cpu: ticks / 100 / seconds, peakRss: Math.max(this.peakRss, await this.rss()) };
  }
}

function waitFor<T extends ChildEvent['ev']>(child: ChildProcess, ev: T): Promise<Extract<ChildEvent, { ev: T }>> {
  return new Promise((resolve, reject) => {
    const onMessage = (m: ChildEvent): void => {
      if (m.ev === ev) {
        child.off('message', onMessage);
        resolve(m as Extract<ChildEvent, { ev: T }>);
      }
    };
    child.on('message', onMessage);
    child.once('exit', (code) => reject(new Error(`processo spettatori uscito (${code})`)));
  });
}

function merge(results: ResultEvent[]): ResultEvent {
  const out: ResultEvent = {
    ev: 'result',
    latencies: [],
    perVersion: {},
    bytesInitial: 0,
    bytesUpdates: 0,
    missing: 0,
    closed: {},
    resyncs: 0,
    binaryFrames: 0,
    textFrames: 0,
    verified: { ok: 0, failed: 0 },
    matchIds: {},
  };
  for (const r of results) {
    for (const l of r.latencies) out.latencies.push(l);
    for (const [v, slot] of Object.entries(r.perVersion)) {
      const o = (out.perVersion[Number(v)] ??= { bytes: 0, clients: 0 });
      o.bytes += slot.bytes;
      o.clients += slot.clients;
    }
    out.bytesInitial += r.bytesInitial;
    out.bytesUpdates += r.bytesUpdates;
    out.missing += r.missing;
    out.resyncs += r.resyncs;
    out.binaryFrames += r.binaryFrames;
    out.textFrames += r.textFrames;
    out.verified.ok += r.verified.ok;
    out.verified.failed += r.verified.failed;
    for (const [k, n] of Object.entries(r.closed)) out.closed[k] = (out.closed[k] ?? 0) + n;
  }
  return out;
}

async function prova(values: Record<string, string | boolean | undefined>): Promise<void> {
  const base = String(values.url ?? '');
  if (!base) throw new Error('--url obbligatorio');
  let share = typeof values.token === 'string' ? values.token : '';
  let agent = typeof values['agent-token'] === 'string' ? values['agent-token'] : '';
  if (!share || (!agent && values.dvw)) {
    const email = values['admin-email'];
    const password = values['admin-password'];
    if (typeof email !== 'string' || typeof password !== 'string') throw new Error('serve --token o l’account admin');
    const created = await setup(base, email, password);
    share ||= created.share;
    agent ||= created.agent;
  }
  const clients = int(values.clients as string | undefined, 1000);
  const rate = Math.max(1, int(values.rate as string | undefined, 200));
  const workers = Math.max(1, Math.min(clients, int(values.workers as string | undefined, 2)));
  const verify = int(values.verify as string | undefined, 3);
  const interval = int(values.interval as string | undefined, 300);
  const settle = int(values.settle as string | undefined, 3000);
  const wsUrl = `${base.replace(/^http/, 'ws').replace(/\/+$/, '')}/ws/public/${share}${values.gzip ? '?enc=gzip' : ''}`;

  const self = fileURLToPath(import.meta.url);
  const children = Array.from({ length: workers }, () => fork(self, ['__spettatori'], { stdio: 'inherit' }));
  const t0 = now();
  const ready: ReadyEvent[] = await Promise.all(
    children.map((child, i) => {
      const count = Math.floor(clients / workers) + (i < clients % workers ? 1 : 0);
      const command: ParentCommand = {
        cmd: 'connect',
        url: wsUrl,
        count,
        rate: rate / workers,
        verify: i === 0 ? verify : 0,
      };
      child.send(command);
      return waitFor(child, 'ready');
    }),
  );
  const connectSeconds = (now() - t0) / 1000;
  const connected = ready.reduce((n, r) => n + r.connected, 0);
  const failed: Record<string, number> = {};
  for (const r of ready) for (const [k, n] of Object.entries(r.failed)) failed[k] = (failed[k] ?? 0) + n;
  process.stdout.write(
    `connessi ${connected}/${clients} in ${connectSeconds.toFixed(1)} s; rifiutati: ${JSON.stringify(failed)}\n`,
  );
  await sleep(1000);

  const sampler = typeof values['server-pid'] === 'string' ? new ProcSampler(Number(values['server-pid'])) : null;
  await sampler?.start();
  for (const child of children) child.send({ cmd: 'start' } satisfies ParentCommand);

  const sentAt: Record<number, number> = {};
  let finalHash: string | null = null;
  const ingestMs: number[] = [];
  if (typeof values.dvw === 'string') {
    const { header, scoutLines } = splitDvwText(decodeDvw(await readFile(values.dvw)));
    const step = values.step === 'line' ? 'line' : 'point';
    let counts = stepCounts(scoutLines, step);
    if (typeof values['max-steps'] === 'string') counts = counts.slice(0, int(values['max-steps'], counts.length));
    const matchKey = `carico-${Date.now()}`;
    let prev = 0;
    for (let i = 0; i < counts.length; i++) {
      const n = counts[i] ?? 0;
      const body: IngestRequest = {
        protocol: 1,
        matchKey,
        seq: i + 1,
        kind: 'append',
        fromIndex: prev,
        lines: scoutLines.slice(prev, n),
        ...(i === 0 ? { header } : {}),
        contentHash: await hashScoutLines(scoutLines.slice(0, n)),
      };
      // Each ingest adds lines, so it publishes the next version of a new match: version = step number.
      const at = now();
      sentAt[i + 1] = at;
      const res = await fetch(new URL('/api/ingest', base), {
        method: 'POST',
        headers: { authorization: `Bearer ${agent}`, 'content-type': 'application/json', 'content-encoding': 'gzip' },
        body: gzipSync(JSON.stringify(body)),
      });
      ingestMs.push(now() - at);
      if (!res.ok) throw new Error(`ingest ${i + 1}: ${res.status}`);
      prev = n;
      await sleep(Math.max(0, interval - (now() - at)));
    }
    await sleep(settle);
    const final = await fetch(new URL(`/api/public/${share}/state`, base));
    if (final.ok) {
      const body = (await final.json()) as { state?: JsonValue };
      if (body.state !== undefined) finalHash = sha256(canonicalJson(body.state));
    }
  } else {
    await sleep(settle);
  }
  const proc = await sampler?.stop();
  for (const child of children) {
    child.send({ cmd: 'finish', sentAt, matchId: null, finalHash } satisfies ParentCommand);
  }
  const result = merge(await Promise.all(children.map((c) => waitFor(c, 'result'))));
  const updates = Object.keys(sentAt).length;
  const latency = summarize(result.latencies);
  const perUpdate = Object.values(result.perVersion).map((s) => s.bytes / Math.max(1, s.clients));
  const bytes = summarize(perUpdate);
  const ingest = summarize(ingestMs);
  const report = {
    clients,
    connected,
    connectSeconds,
    rejected: failed,
    updates,
    deliveries: result.latencies.length,
    missing: result.missing,
    latencyMs: latency,
    ingestMs: ingest,
    bytesPerUpdatePerClient: { p50: bytes.p50, p95: bytes.p95, max: bytes.max },
    bytesInitialPerClient: result.bytesInitial / Math.max(1, connected),
    bytesUpdatesTotal: result.bytesUpdates,
    closed: result.closed,
    resyncs: result.resyncs,
    frames: { binary: result.binaryFrames, text: result.textFrames },
    verified: result.verified,
    server: proc ?? null,
  };
  const lines = [
    `aggiornamenti: ${updates}, consegne: ${report.deliveries}, mancanti: ${report.missing}`,
    `latenza di consegna: p50 ${ms(latency.p50)}, p95 ${ms(latency.p95)}, p99 ${ms(latency.p99)}, max ${ms(latency.max)}`,
    `durata ingest: p50 ${ms(ingest.p50)}, p95 ${ms(ingest.p95)}`,
    `byte per aggiornamento per spettatore: p50 ${kb(bytes.p50)}, p95 ${kb(bytes.p95)}, max ${kb(bytes.max)}`,
    `byte iniziali per spettatore: ${kb(report.bytesInitialPerClient)}; totale aggiornamenti: ${(result.bytesUpdates / 1048576).toFixed(1)} MB`,
    `frame binari ${result.binaryFrames}, di testo ${result.textFrames}; resync ${result.resyncs}`,
    `client chiusi durante la prova: ${JSON.stringify(result.closed)}`,
    `verifica stato finale: ${result.verified.ok} uguali, ${result.verified.failed} diversi`,
    proc
      ? `server: CPU ${(proc.cpu * 100).toFixed(0)}% di un core, memoria massima ${(proc.peakRss / 1048576).toFixed(0)} MB`
      : '',
  ];
  process.stdout.write(`${lines.filter(Boolean).join('\n')}\n`);
  if (typeof values.json === 'string') await writeFile(values.json, `${JSON.stringify(report, null, 2)}\n`);
}

async function dimensioni(file: string): Promise<void> {
  const { header, scoutLines } = splitDvwText(decodeDvw(await readFile(file)));
  const counts = stepCounts(scoutLines, 'point');
  let prev: JsonValue | null = null;
  const full: number[] = [];
  const fullGz: number[] = [];
  const patch: number[] = [];
  const patchGz: number[] = [];
  for (const n of counts) {
    const state = JSON.parse(
      JSON.stringify(computeMatchState(parseDvw(buildDvwText(header, scoutLines.slice(0, n))))),
    ) as JsonValue;
    const text = JSON.stringify(state);
    full.push(text.length);
    fullGz.push(gzipSync(text, { level: 6 }).length);
    if (prev !== null) {
      const ops = JSON.stringify(diffJson(prev, state));
      patch.push(ops.length);
      patchGz.push(gzipSync(ops, { level: 6 }).length);
    }
    prev = state;
  }
  const row = (name: string, v: number[]): string => {
    const s = summarize(v);
    return `${name}: p50 ${kb(s.p50)}, p95 ${kb(s.p95)}, max ${kb(s.max)}`;
  };
  process.stdout.write(
    [
      `punti: ${counts.length}`,
      row('stato completo', full),
      row('stato completo gzip', fullGz),
      row('patch', patch),
      row('patch gzip', patchGz),
    ].join('\n') + '\n',
  );
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === '__spettatori') return runSpectatorProcess();
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      url: { type: 'string' },
      token: { type: 'string' },
      'agent-token': { type: 'string' },
      'admin-email': { type: 'string' },
      'admin-password': { type: 'string' },
      clients: { type: 'string' },
      rate: { type: 'string' },
      workers: { type: 'string' },
      gzip: { type: 'boolean' },
      dvw: { type: 'string' },
      step: { type: 'string' },
      interval: { type: 'string' },
      'max-steps': { type: 'string' },
      verify: { type: 'string' },
      settle: { type: 'string' },
      'server-pid': { type: 'string' },
      json: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }
  if (command === 'prova') return prova(values);
  if (command === 'dimensioni' && typeof values.dvw === 'string') return dimensioni(values.dvw);
  throw new Error(`Comando non valido: ${command}`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`carico: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
