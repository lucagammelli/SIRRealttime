import { EventEmitter } from 'node:events';
import type { StateMessage } from '@sir/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { Grant } from '../src/hub.js';
import { CLOSE_SESSION_GONE, CLOSE_TOKEN_GONE, HEARTBEAT_MS, LiveHub, MAX_BUFFERED_BYTES } from '../src/hub.js';

/** Minimal stand-in of a `ws` socket that records what the hub does with it. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  closedWith: number | null = null;
  terminated = false;
  send(text: string): void {
    this.sent.push(text);
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

function add(grant: Grant, expiresAt: Date | null = null): FakeSocket {
  const socket = new FakeSocket();
  hub.add({ socket: socket as unknown as WebSocket, target: { kind: 'live' }, grant, expiresAt });
  return socket;
}

describe('LiveHub', () => {
  it('disconnects a client with more than 1MB still to send', () => {
    const slow = add({ kind: 'share', shareTokenId: 's1' });
    const fast = add({ kind: 'share', shareTokenId: 's1' });
    slow.bufferedAmount = MAX_BUFFERED_BYTES + 1;
    hub.publish(state(1));
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
});
