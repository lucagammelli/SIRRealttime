import type { StateMessage } from '@sir/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { midMatchState } from '../test/fixtures.ts';
import type { ProbeResult, SocketLike } from './liveConnection.ts';
import {
  CLOSE_LINK_INVALID,
  CLOSE_SESSION_ENDED,
  LiveConnection,
  applyMessage,
  backoffDelay,
} from './liveConnection.ts';
import { useLiveSocket } from './useLiveSocket.ts';

const MATCH_A = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const MATCH_B = '0b8e8a8e-3c55-4b8a-8c2e-4b7f1b0d9e22';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  closed: number | null = null;
  constructor(readonly url: string) {}
  open(): void {
    this.onopen?.({});
  }
  send(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  serverClose(code: number): void {
    this.onclose?.({ code });
  }
  close(code?: number): void {
    this.closed = code ?? 1000;
  }
}

const state = midMatchState();
const stateMsg = (matchId: string, version: number, homeScore = state.live.homeScore): StateMessage => ({
  type: 'state',
  matchId,
  version,
  state: { ...state, live: { ...state.live, homeScore } },
});

function setup(probe?: () => Promise<ProbeResult>) {
  const sockets: FakeSocket[] = [];
  const onChange = vi.fn();
  const conn = new LiveConnection({
    url: 'ws://test/ws/public/abc',
    onChange,
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    random: () => 0.5,
    ...(probe ? { probe } : {}),
  });
  return { conn, sockets, onChange, last: () => sockets.at(-1) as FakeSocket };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('applyMessage', () => {
  it('ignores versions not newer than the one shown for the same match', () => {
    const v5 = applyMessage(null, stateMsg(MATCH_A, 5));
    expect(v5).toMatchObject({ kind: 'state', version: 5 });
    expect(applyMessage(v5, stateMsg(MATCH_A, 4))).toBeNull();
    expect(applyMessage(v5, stateMsg(MATCH_A, 5))).toBeNull();
    expect(applyMessage(v5, stateMsg(MATCH_A, 6))).toMatchObject({ version: 6 });
    // A new match starts from its own version.
    expect(applyMessage(v5, stateMsg(MATCH_B, 1))).toMatchObject({ matchId: MATCH_B, version: 1 });
    expect(applyMessage(v5, { type: 'noMatch' })).toEqual({ kind: 'noMatch' });
  });

  it('doubles the backoff up to the maximum', () => {
    expect(backoffDelay(1, 1000, 8000, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, 1000, 8000, () => 0.5)).toBe(4000);
    expect(backoffDelay(10, 1000, 8000, () => 0.5)).toBe(8000);
  });
});

describe('LiveConnection', () => {
  it('shows states in order and ignores old versions', () => {
    const { conn, last } = setup();
    conn.start();
    last().open();
    expect(conn.current().status).toBe('live');
    last().send(stateMsg(MATCH_A, 3, 10));
    last().send(stateMsg(MATCH_A, 2, 9));
    expect(conn.current().data).toMatchObject({ version: 3 });
    last().send({ type: 'garbage' });
    last().send(stateMsg(MATCH_A, 4, 11));
    const data = conn.current().data;
    expect(data?.kind === 'state' && data.state.live.homeScore).toBe(11);
    conn.stop();
  });

  it('reconnects with backoff and keeps the state shown, ignoring an older state after reconnecting', () => {
    const { conn, sockets, last } = setup();
    conn.start();
    last().open();
    last().send(stateMsg(MATCH_A, 7));
    last().serverClose(1006);
    expect(conn.current().status).toBe('reconnecting');
    expect(conn.current().data).toMatchObject({ version: 7 });
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().serverClose(1006);
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    last().open();
    expect(conn.current()).toMatchObject({ status: 'live', attempts: 0 });
    last().send(stateMsg(MATCH_A, 6));
    expect(conn.current().data).toMatchObject({ version: 7 });
    last().send(stateMsg(MATCH_A, 8));
    expect(conn.current().data).toMatchObject({ version: 8 });
    conn.stop();
  });

  it('does not reconnect after 4404 or 4401', () => {
    const a = setup();
    a.conn.start();
    a.last().open();
    a.last().serverClose(CLOSE_LINK_INVALID);
    expect(a.conn.current().status).toBe('invalid');
    vi.advanceTimersByTime(60_000);
    expect(a.sockets).toHaveLength(1);
    a.conn.retryNow();
    expect(a.sockets).toHaveLength(1);

    const b = setup();
    b.conn.start();
    b.last().open();
    b.last().serverClose(CLOSE_SESSION_ENDED);
    expect(b.conn.current().status).toBe('unauthorized');
    vi.advanceTimersByTime(60_000);
    expect(b.sockets).toHaveLength(1);
  });

  it('asks the probe when the socket never opens: a 404 link stops the retries', async () => {
    const probe = vi.fn<() => Promise<ProbeResult>>().mockResolvedValueOnce('ok').mockResolvedValueOnce('invalid');
    const { conn, sockets, last } = setup(probe);
    conn.start();
    last().serverClose(1006);
    await vi.waitFor(() => expect(conn.current().status).toBe('reconnecting'));
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(2);
    last().serverClose(1006);
    await vi.waitFor(() => expect(conn.current().status).toBe('invalid'));
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('does not open a second socket when the browser comes back online during the probe', async () => {
    let answer: (r: ProbeResult) => void = () => undefined;
    const probe = vi.fn(() => new Promise<ProbeResult>((resolve) => (answer = resolve)));
    const { conn, sockets, last } = setup(probe);
    conn.start();
    last().serverClose(1006);
    expect(probe).toHaveBeenCalledTimes(1);
    conn.retryNow();
    expect(sockets).toHaveLength(1);
    answer('ok');
    await vi.waitFor(() => expect(conn.current().status).toBe('reconnecting'));
    conn.retryNow();
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(2);
    conn.stop();
  });

  it('closes the previous socket before opening a new one', () => {
    const { conn, sockets } = setup();
    conn.start();
    (conn as unknown as { connect(): void }).connect();
    expect(sockets).toHaveLength(2);
    expect(sockets[0]?.closed).toBe(1000);
    conn.stop();
  });

  it('stop closes the socket and cancels the timer', () => {
    const { conn, sockets, last } = setup();
    conn.start();
    last().serverClose(1006);
    conn.stop();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });
});

describe('useLiveSocket', () => {
  it('renders the latest state and closes the socket on unmount', () => {
    const sockets: FakeSocket[] = [];
    const createSocket = (url: string): FakeSocket => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    };
    const { result, unmount } = renderHook(() => useLiveSocket('ws://test/ws/admin', { createSocket }));
    expect(result.current.status).toBe('connecting');
    const socket = sockets.at(-1) as FakeSocket;
    act(() => {
      socket.open();
      socket.send(stateMsg(MATCH_A, 2));
      socket.send(stateMsg(MATCH_A, 1));
    });
    expect(result.current.status).toBe('live');
    expect(result.current.data).toMatchObject({ kind: 'state', version: 2 });
    act(() => socket.serverClose(CLOSE_LINK_INVALID));
    expect(result.current.status).toBe('invalid');
    unmount();
    expect(sockets).toHaveLength(1);
  });
});
