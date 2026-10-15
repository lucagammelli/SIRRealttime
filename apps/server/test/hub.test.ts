import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import type { JsonValue, ServerMessage, StateMessage } from '@sir/shared';
import { applyPatch } from '@sir/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { FrameEncoding, Grant, Target } from '../src/hub.js';
import { CLOSE_SESSION_GONE, CLOSE_TOKEN_GONE, HEARTBEAT_MS, LiveHub, MAX_BUFFERED_BYTES } from '../src/hub.js';

/** Minimal stand-in of a `ws` socket that records what the hub does with it. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  /** Raw frames, with their kind (binary = gzip). */
  frames: { data: Buffer; binary: boolean }[] = [];
  closedWith: number | null = null;
  terminated = false;
  send(data: Buffer, options: { binary: boolean }): void {
    this.frames.push({ data, binary: options.binary });
    this.sent.push((options.binary ? gunzipSync(data) : data).toString('utf8'));
  }
  messages(): ServerMessage[] {
    return this.sent.map((t) => JSON.parse(t) as ServerMessage);
  }
  close(code: number): void {
    this.closedWith = code;
  }
  terminate(): void {
    this.terminated = true;
  }
  ping(): void {
    // The tests answer with `emit('pong')` when needed.
  }
}

const state = (version: number): StateMessage =>
  ({ type: 'state', matchId: 'm1', version, state: {} }) as unknown as StateMessage;

let now: Date;
let hub: LiveHub;
beforeEach(() => {
  vi.useFakeTimers();
  now = new Date('2026-01-01T10:00:00Z');
  hub = new LiveHub(() => now);
});
afterEach(() => {
  hub.closeAll();
  vi.useRealTimers();
});

const TENANT = 't-a';

function add(
  grant: Grant,
  expiresAt: Date | null = null,
  target: Target = { kind: 'live', tenantId: TENANT },
  extra: { encoding?: FrameEncoding; ip?: string | null } = {},
): FakeSocket {
  const socket = new FakeSocket();
  hub.add({ socket: socket as unknown as WebSocket, target, grant, expiresAt, ...extra });
  return socket;
}

const MATCH = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
/** A state with a long list (the full state is much larger than one change). */
const big = (version: number, home: number): StateMessage =>
  ({
    type: 'state',
    matchId: MATCH,
    version,
    state: { score: { home, away: 0 }, actions: Array.from({ length: 200 }, (_, i) => ({ i, code: `*${i}SH+` })) },
  }) as unknown as StateMessage;
const share = { kind: 'share', shareTokenId: 's1' } as const;

describe('LiveHub', () => {
  it('disconnects a client with more than 1MB still to send', () => {
    const slow = add({ kind: 'share', shareTokenId: 's1' });
    const fast = add({ kind: 'share', shareTokenId: 's1' });
    slow.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    hub.publish(TENANT, state(1));
    expect(slow.terminated).toBe(true);
    expect(slow.sent).toEqual([]);
    expect(fast.sent).toHaveLength(1);
    expect(hub.size).toBe(1);
  });

  it('closes expired clients at the heartbeat, with the code of their grant', () => {
    const share = add({ kind: 'share', shareTokenId: 's1' }, new Date(now.getTime() + 1000));
    const admin = add({ kind: 'session', sessionHash: 'h1' }, new Date(now.getTime() + 1000));
    const forever = add({ kind: 'share', shareTokenId: 's2' });
    now = new Date(now.getTime() + 2000);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(share.closedWith).toBe(CLOSE_TOKEN_GONE);
    expect(admin.closedWith).toBe(CLOSE_SESSION_GONE);
    expect(forever.closedWith).toBeNull();
    expect(hub.size).toBe(1);
  });

  it('closes only the clients of the session that logged out', () => {
    const mine = add({ kind: 'session', sessionHash: 'h1' });
    const other = add({ kind: 'session', sessionHash: 'h2' });
    hub.closeSession('h1');
    expect(mine.closedWith).toBe(CLOSE_SESSION_GONE);
    expect(other.closedWith).toBeNull();
  });

  it('terminates a client that did not answer the previous ping', () => {
    const dead = add({ kind: 'share', shareTokenId: 's1' });
    const alive = add({ kind: 'share', shareTokenId: 's1' });
    vi.advanceTimersByTime(HEARTBEAT_MS);
    alive.emit('pong');
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(dead.terminated).toBe(true);
    expect(alive.terminated).toBe(false);
  });

  it('sends the live match of a client only to the clients of that client', () => {
    const mineLive = add({ kind: 'share', shareTokenId: 's1' });
    const otherLive = add({ kind: 'share', shareTokenId: 's2' }, null, { kind: 'live', tenantId: 't-b' });
    // Same match id, but followed under another client: never delivered.
    const otherFixed = add({ kind: 'share', shareTokenId: 's3' }, null, {
      kind: 'match',
      tenantId: 't-b',
      matchId: 'm1',
    });
    const mineFixed = add({ kind: 'share', shareTokenId: 's4' }, null, {
      kind: 'match',
      tenantId: TENANT,
      matchId: 'm1',
    });
    hub.publish(TENANT, state(1));
    expect(mineLive.sent).toHaveLength(1);
    expect(mineFixed.sent).toHaveLength(1);
    expect(otherLive.sent).toEqual([]);
    expect(otherFixed.sent).toEqual([]);
  });

  it('sends a patch to the clients that have the previous version, the full state to the others', () => {
    const early = add(share);
    hub.publish(TENANT, big(1, 0));
    const late = add(share);
    hub.send(late as unknown as WebSocket, big(1, 0));
    const fresh = add(share);
    hub.publish(TENANT, big(2, 1));
    const [first, second] = early.messages();
    expect(first).toMatchObject({ type: 'state', version: 1 });
    expect(second).toMatchObject({ type: 'patch', baseVersion: 1, version: 2 });
    expect(late.messages()[1]).toMatchObject({ type: 'patch', baseVersion: 1, version: 2 });
    expect(fresh.messages()).toMatchObject([{ type: 'state', version: 2 }]);
    if (first?.type !== 'state' || second?.type !== 'patch') throw new Error('unexpected messages');
    const rebuilt = applyPatch(first.state as unknown as JsonValue, second.ops);
    expect(rebuilt).toEqual(big(2, 1).state);
    // The patch is small: a fraction of the full state.
    expect(early.sent[1]?.length).toBeLessThan((early.sent[0]?.length ?? 0) / 10);
  });

  it('sends the full state when the patch would be larger than half of it', () => {
    const client = add(share);
    hub.publish(TENANT, big(1, 0));
    const other = { ...big(2, 0), state: { completely: 'different' } } as unknown as StateMessage;
    hub.publish(TENANT, other);
    expect(client.messages()[1]).toMatchObject({ type: 'state', version: 2 });
  });

  it('sends the full state again after forget (resync)', () => {
    const client = add(share);
    hub.publish(TENANT, big(1, 0));
    hub.forget(client as unknown as WebSocket);
    hub.publish(TENANT, big(2, 1));
    expect(client.messages()[1]).toMatchObject({ type: 'state', version: 2 });
  });

  it('compresses each frame once: the same gzip buffer to every gzip client, text to the others', () => {
    const a = add(share, null, undefined, { encoding: 'gzip' });
    const b = add(share, null, undefined, { encoding: 'gzip' });
    const plain = add(share);
    hub.publish(TENANT, big(1, 0));
    hub.publish(TENANT, big(2, 1));
    for (const i of [0, 1]) {
      expect(a.frames[i]?.binary).toBe(true);
      expect(a.frames[i]?.data).toBe(b.frames[i]?.data);
      expect(plain.frames[i]?.binary).toBe(false);
    }
    expect(a.sent).toEqual(plain.sent);
    expect(a.frames[0]?.data.length).toBeLessThan(plain.frames[0]?.data.length ?? 0);
    // Short messages stay text even for gzip clients.
    hub.send(a as unknown as WebSocket, { type: 'error', message: 'x' });
    expect(a.frames[2]?.binary).toBe(false);
  });

  it('serves the current state from memory, only within its client', () => {
    expect(hub.current({ kind: 'live', tenantId: TENANT })).toBeNull();
    hub.publish(TENANT, big(1, 0));
    expect(hub.current({ kind: 'live', tenantId: TENANT })).toMatchObject({ version: 1 });
    expect(hub.current({ kind: 'match', tenantId: TENANT, matchId: MATCH })).toMatchObject({ version: 1 });
    expect(hub.current({ kind: 'match', tenantId: 't-b', matchId: MATCH })).toBeNull();
    expect(hub.current({ kind: 'live', tenantId: 't-b' })).toBeNull();
    // A state read from the database never replaces a newer published one.
    hub.remember(TENANT, big(0, 0), true);
    expect(hub.current({ kind: 'live', tenantId: TENANT })).toMatchObject({ version: 1 });
  });

  it('counts the public sockets per IP and in total, until they close', () => {
    const a = add(share, null, undefined, { ip: '10.0.0.1' });
    add(share, null, undefined, { ip: '10.0.0.1' });
    add(share, null, undefined, { ip: '10.0.0.2' });
    add({ kind: 'session', sessionHash: 'h1' });
    expect(hub.publicSockets('10.0.0.1')).toEqual({ total: 3, fromIp: 2 });
    a.emit('close');
    a.emit('close');
    expect(hub.publicSockets('10.0.0.1')).toEqual({ total: 2, fromIp: 1 });
    hub.closeShareToken('s1');
    expect(hub.publicSockets('10.0.0.2')).toEqual({ total: 0, fromIp: 0 });
  });
});
