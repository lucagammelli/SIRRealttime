import { EventEmitter } from 'node:events';
import { gunzipSync } from 'node:zlib';
import type { JsonValue, ScheduledMessage, ServerMessage, StateMessage } from '@sir/shared';
import { applyPatch } from '@sir/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { FrameEncoding, Grant, Target } from '../src/hub.js';
import {
  CLOSE_SESSION_GONE,
  CLOSE_TOKEN_GONE,
  HEARTBEAT_MS,
  LiveHub,
  MAX_BUFFERED_BYTES,
  SCHEDULED_TTL_MS,
} from '../src/hub.js';

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
  it('tells the statistics which match a socket was shown and whether it is a simulation, when it leaves', () => {
    const watcher = add(share, null, { kind: 'match', tenantId: TENANT, matchId: 'm1' });
    const asSocket = watcher as unknown as WebSocket;
    expect(hub.viewOf(asSocket)).toEqual({ matchId: null, simulated: false });
    const left: unknown[] = [];
    hub.onLeave(asSocket, (view) => left.push(view));
    hub.publish(TENANT, { ...state(1), simulated: true }, { clientFixtureId: null, becameLive: false, isolated: true });
    expect(hub.viewOf(asSocket)).toEqual({ matchId: 'm1', simulated: true });
    watcher.emit('close');
    expect(left).toEqual([{ matchId: 'm1', simulated: true }]);
    expect(hub.viewOf(asSocket)).toBeNull();
    watcher.emit('close');
    expect(left).toHaveLength(1);
  });

  it('sends a simulated match (isolated) only to the clients of its own link', () => {
    const live = add(share);
    const channel = add(share, null, { kind: 'channel', tenantId: TENANT });
    const own = add(share, null, { kind: 'match', tenantId: TENANT, matchId: 'm1' });
    hub.publish(TENANT, state(1), { clientFixtureId: null, becameLive: false, channel: false, isolated: true });
    expect(own.messages()).toHaveLength(1);
    expect(live.sent).toEqual([]);
    expect(channel.sent).toEqual([]);
    // It never becomes the live match: the next real match does.
    expect(hub.current({ kind: 'live', tenantId: TENANT })).toBeNull();
    hub.forgetMatch('m1');
    expect(hub.current({ kind: 'match', tenantId: TENANT, matchId: 'm1' })).toBeNull();
  });

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

  it('sends a state to the link of its match of the calendar, and moves the live link only to a new live match', () => {
    const fixtureA = add(share, null, { kind: 'fixture', tenantId: TENANT, clientFixtureId: 'cf-a' });
    const fixtureB = add(share, null, { kind: 'fixture', tenantId: TENANT, clientFixtureId: 'cf-b' });
    const otherClient = add(share, null, { kind: 'fixture', tenantId: 't-b', clientFixtureId: 'cf-a' });
    const live = add(share);
    const courtA = (version: number) => ({ ...state(version), matchId: 'ma' });
    const courtB = (version: number) => ({ ...state(version), matchId: 'mb' });
    hub.publish(TENANT, courtA(1), { clientFixtureId: 'cf-a', becameLive: true });
    hub.publish(TENANT, courtB(1), { clientFixtureId: 'cf-b', becameLive: true });
    // Court A goes on: its link gets it, the live link stays on court B (live last).
    hub.publish(TENANT, courtA(2), { clientFixtureId: 'cf-a', becameLive: false });
    expect(fixtureA.messages().map((m) => m.type === 'state' && [m.matchId, m.version])).toEqual([
      ['ma', 1],
      ['ma', 2],
    ]);
    expect(fixtureB.messages().map((m) => m.type === 'state' && m.matchId)).toEqual(['mb']);
    expect(live.messages().map((m) => m.type === 'state' && m.matchId)).toEqual(['ma', 'mb']);
    expect(otherClient.sent).toEqual([]);
    expect(hub.current({ kind: 'fixture', tenantId: TENANT, clientFixtureId: 'cf-b' })).toMatchObject({
      matchId: 'mb',
    });
    expect(hub.current({ kind: 'fixture', tenantId: 't-b', clientFixtureId: 'cf-a' })).toBeNull();
    // The admin takes the .dvw away from cf-b: its clients see «Prossima partita» again.
    const scheduled = { type: 'scheduled', fixture: {} } as unknown as ServerMessage;
    hub.retarget(TENANT, 'cf-b', scheduled);
    expect(fixtureB.messages().at(-1)).toEqual(scheduled);
    expect(hub.current({ kind: 'fixture', tenantId: TENANT, clientFixtureId: 'cf-b' })).toBeNull();
  });

  it('keeps «Prossima partita» for a short time, within its client, until a .dvw reaches its match', () => {
    const scheduled = { type: 'scheduled', fixture: {} } as unknown as ScheduledMessage;
    hub.rememberScheduled(TENANT, 'cf-a', scheduled);
    expect(hub.currentScheduled(TENANT, 'cf-a')).toBe(scheduled);
    expect(hub.currentScheduled('t-b', 'cf-a')).toBeNull();
    now = new Date(now.getTime() + SCHEDULED_TTL_MS);
    expect(hub.currentScheduled(TENANT, 'cf-a')).toBeNull();
    hub.rememberScheduled(TENANT, 'cf-a', scheduled);
    hub.publish(TENANT, { ...state(1), matchId: 'ma' }, { clientFixtureId: 'cf-a', becameLive: true });
    expect(hub.currentScheduled(TENANT, 'cf-a')).toBeNull();
    hub.rememberScheduled(TENANT, 'cf-b', scheduled);
    hub.retarget(TENANT, 'cf-b', scheduled);
    expect(hub.currentScheduled(TENANT, 'cf-b')).toBeNull();
    hub.rememberScheduled(TENANT, 'cf-c', scheduled);
    hub.forgetScheduled(TENANT);
    expect(hub.currentScheduled(TENANT, 'cf-c')).toBeNull();
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

describe('channel of the club', () => {
  const channel: Target = { kind: 'channel', tenantId: TENANT };
  const next = (startsAt: string): ScheduledMessage =>
    ({
      type: 'scheduled',
      fixture: { startsAt, home: { name: 'A' }, away: { name: 'B' } },
    }) as unknown as ScheduledMessage;

  it('follows the live match, then shows the next match once, and the next match after it changes', () => {
    const socket = add(share, null, channel);
    hub.publish(TENANT, state(1));
    expect(socket.messages().map((m) => m.type)).toEqual(['state']);
    expect(hub.channelTenants()).toEqual(new Set([TENANT]));
    // The watcher finds the next match: sent once, not at every check.
    hub.showChannel(TENANT, next('2026-01-08T16:00:00Z'));
    hub.showChannel(TENANT, next('2026-01-08T16:00:00Z'));
    expect(socket.messages().map((m) => m.type)).toEqual(['state', 'scheduled']);
    hub.showChannel(TENANT, next('2026-01-08T17:00:00Z'));
    expect(socket.messages()).toHaveLength(3);
    // The same match the socket shows is not sent again; a new live match is.
    hub.showChannel(TENANT, state(1));
    expect(socket.messages()).toHaveLength(4);
    hub.showChannel(TENANT, state(1));
    expect(socket.messages()).toHaveLength(4);
  });

  it('keeps what the channel shows for a while, and forgets it when a match starts', () => {
    hub.rememberChannel(TENANT, next('2026-01-08T16:00:00Z'));
    expect(hub.currentChannel(TENANT)?.type).toBe('scheduled');
    hub.publish(TENANT, state(1), { clientFixtureId: null, becameLive: true });
    expect(hub.currentChannel(TENANT)).toBeNull();
    hub.rememberChannel(TENANT, next('2026-01-08T16:00:00Z'));
    now = new Date(now.getTime() + SCHEDULED_TTL_MS);
    expect(hub.currentChannel(TENANT)).toBeNull();
    expect(hub.current(channel)?.matchId).toBe('m1');
  });
});
