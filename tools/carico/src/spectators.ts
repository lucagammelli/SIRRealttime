import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { JsonValue } from '@arenalive/shared';
import { LIVE_FRAME_MAX_DECODED_BYTES, ServerMessageSchema, applyPatch } from '@arenalive/shared';
import WebSocket from 'ws';
import { bump, canonicalJson, frameHeader } from './metrics.js';

/** Messages parent→child and child→parent of the forked spectator processes. */
export type ParentCommand =
  | { cmd: 'connect'; url: string; count: number; rate: number; verify: number }
  | { cmd: 'start' }
  | { cmd: 'finish'; sentAt: Record<number, number>; matchId: string | null; finalHash: string | null };

export interface ReadyEvent {
  ev: 'ready';
  connected: number;
  failed: Record<string, number>;
}

export interface ResultEvent {
  ev: 'result';
  latencies: number[];
  /** Per version: bytes received by all clients and number of clients that got it. */
  perVersion: Record<number, { bytes: number; clients: number }>;
  bytesInitial: number;
  bytesUpdates: number;
  missing: number;
  closed: Record<string, number>;
  resyncs: number;
  binaryFrames: number;
  textFrames: number;
  verified: { ok: number; failed: number };
  matchIds: Record<string, number>;
}

export type ChildEvent = ReadyEvent | ResultEvent;

const now = (): number => performance.timeOrigin + performance.now();
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

interface Spectator {
  socket: WebSocket;
  /** Arrival time and bytes of each version, per match. */
  arrivals: Map<string, Map<number, { t: number; bytes: number }>>;
  version: { matchId: string; version: number } | null;
  /** Full state, only for the clients that verify the patches. */
  state: JsonValue | null;
  verify: boolean;
  bytesInitial: number;
  bytesUpdates: number;
}

let started = false;
const spectators: Spectator[] = [];
const closed: Record<string, number> = {};
let resyncs = 0;
let binaryFrames = 0;
let textFrames = 0;

function onFrame(s: Spectator, data: Buffer, isBinary: boolean): void {
  if (started) s.bytesUpdates += data.length;
  else s.bytesInitial += data.length;
  if (isBinary) binaryFrames++;
  else textFrames++;
  let text: string;
  try {
    text = (isBinary ? gunzipSync(data, { maxOutputLength: LIVE_FRAME_MAX_DECODED_BYTES }) : data).toString('utf8');
  } catch {
    bump(closed, 'frame-illeggibile');
    return;
  }
  const head = frameHeader(text);
  if (!head || head.matchId === null || head.version === null) return;
  if (started) {
    let perMatch = s.arrivals.get(head.matchId);
    if (!perMatch) {
      perMatch = new Map<number, { t: number; bytes: number }>();
      s.arrivals.set(head.matchId, perMatch);
    }
    if (!perMatch.has(head.version)) perMatch.set(head.version, { t: now(), bytes: data.length });
  }
  const current = s.version;
  if (head.type === 'patch') {
    if (!current || current.matchId !== head.matchId || current.version !== head.baseVersion) {
      resyncs++;
      s.socket.send(JSON.stringify({ type: 'resync' }));
      return;
    }
  }
  if (current && current.matchId === head.matchId && current.version >= head.version) return;
  if (s.verify) {
    const parsed = ServerMessageSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return;
    const m = parsed.data;
    if (m.type === 'state') s.state = m.state as unknown as JsonValue;
    else if (m.type === 'patch' && s.state !== null) {
      try {
        s.state = applyPatch(s.state, m.ops);
      } catch {
        resyncs++;
        s.socket.send(JSON.stringify({ type: 'resync' }));
        return;
      }
    }
  }
  s.version = { matchId: head.matchId, version: head.version };
}

function open(url: string, verify: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { perMessageDeflate: false });
    const s: Spectator = {
      socket,
      arrivals: new Map(),
      version: null,
      state: null,
      verify,
      bytesInitial: 0,
      bytesUpdates: 0,
    };
    let settled = false;
    let opened = false;
    socket.on('unexpected-response', (_req, res) => {
      settled = true;
      resolve(String(res.statusCode));
      socket.terminate();
    });
    socket.on('open', () => {
      settled = true;
      opened = true;
      spectators.push(s);
      resolve(null);
    });
    socket.on('message', (data: Buffer, isBinary: boolean) => onFrame(s, data, isBinary));
    socket.on('close', (code) => {
      if (opened && !finishing) bump(closed, code);
    });
    socket.on('error', (err) => {
      if (!settled) {
        settled = true;
        resolve(err.message.slice(0, 40));
      }
    });
  });
}

let finishing = false;

async function connect(url: string, count: number, rate: number, verify: number): Promise<ReadyEvent> {
  const failed: Record<string, number> = {};
  const pending: Promise<void>[] = [];
  const gap = 1000 / rate;
  const t0 = now();
  for (let i = 0; i < count; i++) {
    const wait = t0 + i * gap - now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));
    pending.push(
      open(url, i < verify).then((error) => {
        if (error !== null) bump(failed, error);
      }),
    );
  }
  await Promise.all(pending);
  return { ev: 'ready', connected: spectators.length, failed };
}

function finish(sentAt: Record<number, number>, matchId: string | null, finalHash: string | null): ResultEvent {
  finishing = true;
  const matchIds: Record<string, number> = {};
  for (const s of spectators) for (const id of s.arrivals.keys()) bump(matchIds, id);
  const target = matchId ?? Object.entries(matchIds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const versions = Object.keys(sentAt).map(Number);
  const latencies: number[] = [];
  const perVersion: ResultEvent['perVersion'] = {};
  let missing = 0;
  const verified = { ok: 0, failed: 0 };
  for (const s of spectators) {
    const got = target ? s.arrivals.get(target) : undefined;
    for (const v of versions) {
      const a = got?.get(v);
      const sent = sentAt[v];
      if (!a || sent === undefined) {
        missing++;
        continue;
      }
      latencies.push(a.t - sent);
      const slot = (perVersion[v] ??= { bytes: 0, clients: 0 });
      slot.bytes += a.bytes;
      slot.clients++;
    }
    if (s.verify && finalHash) {
      if (s.state !== null && sha256(canonicalJson(s.state)) === finalHash) verified.ok++;
      else verified.failed++;
    }
    s.socket.terminate();
  }
  return {
    ev: 'result',
    latencies,
    perVersion,
    bytesInitial: spectators.reduce((n, s) => n + s.bytesInitial, 0),
    bytesUpdates: spectators.reduce((n, s) => n + s.bytesUpdates, 0),
    missing,
    closed,
    resyncs,
    binaryFrames,
    textFrames,
    verified,
    matchIds,
  };
}

/** Body of a forked spectator process: answers the commands of the parent over IPC. */
export function runSpectatorProcess(): void {
  const send = (event: ChildEvent): void => {
    process.send?.(event);
  };
  process.on('message', (raw: ParentCommand) => {
    if (raw.cmd === 'connect') void connect(raw.url, raw.count, raw.rate, raw.verify).then(send);
    else if (raw.cmd === 'start') started = true;
    else {
      send(finish(raw.sentAt, raw.matchId, raw.finalHash));
      setTimeout(() => process.exit(0), 200);
    }
  });
}
