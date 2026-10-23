import { gzipSync } from 'node:zlib';
import type { PatchMessage, StateMessage } from '@arenalive/shared';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { midMatchState } from '../test/fixtures.ts';
import type { ProbeResult, SocketLike } from './liveConnection.ts';
import {
  CLOSE_LINK_INVALID,
  CLOSE_SESSION_ENDED,
  LiveConnection,
  applyMessage,
  applyPatchMessage,
  backoffDelay,
} from './liveConnection.ts';
import { gunzipFrame } from './frames.ts';
import { probeShareToken, retryAfterMs } from '../pages/LivePage.tsx';
import { useLiveSocket } from './useLiveSocket.ts';

const MATCH_A = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const MATCH_B = '0b8e8a8e-3c55-4b8a-8c2e-4b7f1b0d9e22';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  binaryType = 'blob';
  closed: number | null = null;
  /** Messages sent by the client. */
  outgoing: unknown[] = [];
  constructor(readonly url: string) {}
  open(): void {
    this.onopen?.({});
  }
  /** A text frame from the server. */
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  /** A gzip binary frame from the server. */
  deliverGzip(message: unknown): void {
    const z = gzipSync(JSON.stringify(message));
    this.onmessage?.({ data: z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) });
  }
  send(data: string): void {
    this.outgoing.push(JSON.parse(data));
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

const patchMsg = (matchId: string, baseVersion: number, version: number, homeScore: number): PatchMessage => ({
  type: 'patch',
  matchId,
  baseVersion,
  version,
  ops: [{ op: 'set', path: ['live', 'homeScore'], value: homeScore }],
});

function setup(probe?: () => Promise<ProbeResult>, extra: { gzip?: boolean; restartSpreadMs?: number } = {}) {
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
    gzip: extra.gzip ?? false,
    restartSpreadMs: extra.restartSpreadMs ?? 0,
    ...(probe ? { probe } : {}),
  });
  return { conn, sockets, onChange, last: () => sockets.at(-1) as FakeSocket };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hello of the statistics', () => {
  it('is sent once at every open of the socket, also after a reconnection; nothing without it', () => {
    const sockets: FakeSocket[] = [];
    const conn = new LiveConnection({
      url: 'ws://test/ws/public/abc',
      onChange: vi.fn(),
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      baseDelayMs: 1000,
      random: () => 0.5,
      gzip: false,
      hello: () => JSON.stringify({ type: 'hello', visit: 'v'.repeat(32) }),
    });
    conn.start();
    sockets[0]?.open();
    expect(sockets[0]?.outgoing).toEqual([{ type: 'hello', visit: 'v'.repeat(32) }]);
    sockets[0]?.serverClose(1006);
    vi.advanceTimersByTime(60_000);
    sockets[1]?.open();
    expect(sockets[1]?.outgoing).toEqual([{ type: 'hello', visit: 'v'.repeat(32) }]);
    conn.stop();
    const plain = setup();
    plain.conn.start();
    plain.last().open();
    expect(plain.last().outgoing).toEqual([]);
    plain.conn.stop();
  });
});

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

  it('keeps the flag of a simulated match across the patches', () => {
    const full = applyMessage(null, { ...stateMsg(MATCH_A, 1), simulated: true });
    expect(full).toMatchObject({ kind: 'state', simulated: true });
    const patched = applyPatchMessage(full, { type: 'patch', matchId: MATCH_A, baseVersion: 1, version: 2, ops: [] });
    expect(patched).toMatchObject({ kind: 'state', version: 2, simulated: true });
    expect(applyMessage(null, stateMsg(MATCH_A, 1))).not.toHaveProperty('simulated');
  });

  it('keeps the logos of the full state across the patches', () => {
    const logos = { home: '/api/public/assets/a', away: null };
    const full = applyMessage(null, { ...stateMsg(MATCH_A, 1), logos });
    expect(full).toMatchObject({ kind: 'state', logos });
    const patched = applyPatchMessage(full, {
      type: 'patch',
      matchId: MATCH_A,
      baseVersion: 1,
      version: 2,
      ops: [],
    });
    expect(patched).toMatchObject({ kind: 'state', version: 2, logos });
    expect(applyMessage(null, stateMsg(MATCH_A, 1))).not.toHaveProperty('logos');
  });

  it('shows «Prossima partita» until the first state of the match of the calendar', () => {
    const fixture = {
      startsAt: null,
      home: { name: 'Casa', logoUrl: null },
      away: { name: 'Ospiti', logoUrl: null },
      ourSide: 'home' as const,
      venue: null,
      venueCity: null,
      roundLabel: '1ª Giornata',
      leagueName: null,
      status: 'scheduled' as const,
      result: null,
      inCalendar: true,
    };
    const scheduled = applyMessage(null, { type: 'scheduled', fixture });
    expect(scheduled).toEqual({ kind: 'scheduled', fixture });
    expect(applyMessage(scheduled, stateMsg(MATCH_A, 1))).toMatchObject({ kind: 'state', matchId: MATCH_A });
  });

  it('doubles the backoff up to the maximum', () => {
    expect(backoffDelay(1, 1000, 8000, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, 1000, 8000, () => 0.5)).toBe(4000);
    expect(backoffDelay(10, 1000, 8000, () => 0.5)).toBe(8000);
  });

  it('spreads the delay ±50% from the first attempt', () => {
    expect(backoffDelay(1, 1000, 8000, () => 0)).toBe(500);
    expect(backoffDelay(1, 1000, 8000, () => 0.999)).toBe(1499);
    expect(backoffDelay(10, 1000, 8000, () => 0)).toBe(4000);
  });
});

describe('applyPatchMessage', () => {
  const v5 = applyMessage(null, stateMsg(MATCH_A, 5, 3));
  it('applies a patch of the version shown', () => {
    const next = applyPatchMessage(v5, patchMsg(MATCH_A, 5, 6, 4));
    expect(next).toMatchObject({ kind: 'state', version: 6 });
    expect(next !== null && next !== 'resync' && next.kind === 'state' && next.state.live.homeScore).toBe(4);
    // The state shown before is not changed.
    expect(v5?.kind === 'state' && v5.state.live.homeScore).toBe(3);
  });
  it('ignores old patches and asks the full state when a step is missing or the patch does not fit', () => {
    expect(applyPatchMessage(v5, patchMsg(MATCH_A, 4, 5, 9))).toBeNull();
    expect(applyPatchMessage(v5, patchMsg(MATCH_A, 6, 7, 9))).toBe('resync');
    expect(applyPatchMessage(v5, patchMsg(MATCH_B, 5, 6, 9))).toBe('resync');
    expect(applyPatchMessage(null, patchMsg(MATCH_A, 5, 6, 9))).toBe('resync');
    const broken: PatchMessage = { ...patchMsg(MATCH_A, 5, 6, 9), ops: [{ op: 'del', path: ['nope'] }] };
    expect(applyPatchMessage(v5, broken)).toBe('resync');
    const notAState: PatchMessage = { ...patchMsg(MATCH_A, 5, 6, 9), ops: [{ op: 'del', path: ['teams'] }] };
    expect(applyPatchMessage(v5, notAState)).toBe('resync');
  });
});

describe('gunzipFrame', () => {
  it('decompresses a gzip frame, and refuses one too large once decompressed or not gzip', async () => {
    const text = JSON.stringify({ type: 'noMatch', pad: 'x'.repeat(5000) });
    const z = gzipSync(text);
    expect(await gunzipFrame(z)).toBe(text);
    expect(await gunzipFrame(z, 1000)).toBeNull();
    expect(await gunzipFrame(new TextEncoder().encode('non gzip'))).toBeNull();
    expect(await gunzipFrame('testo')).toBeNull();
  });
});

describe('probeShareToken', () => {
  const answer = (status: number, headers: Record<string, string> = {}) =>
    vi.fn(() => Promise.resolve(new Response(null, { status, headers }))) as unknown as typeof fetch;
  it('reads 404 as invalid, 503 and 429 as a wait of Retry-After', async () => {
    expect(await probeShareToken('t', answer(404))).toBe('invalid');
    expect(await probeShareToken('t', answer(200))).toBe('ok');
    expect(await probeShareToken('t', answer(503, { 'retry-after': '30' }))).toEqual({ retryAfterMs: 30_000 });
    expect(await probeShareToken('t', answer(429))).toEqual({ retryAfterMs: 20_000 });
    expect(retryAfterMs('100000')).toBe(300_000);
    expect(retryAfterMs('domani')).toBe(20_000);
  });
});

describe('LiveConnection', () => {
  it('shows states in order and ignores old versions', () => {
    const { conn, last } = setup();
    conn.start();
    last().open();
    expect(conn.current().status).toBe('live');
    last().deliver(stateMsg(MATCH_A, 3, 10));
    last().deliver(stateMsg(MATCH_A, 2, 9));
    expect(conn.current().data).toMatchObject({ version: 3 });
    last().deliver({ type: 'garbage' });
    last().deliver(stateMsg(MATCH_A, 4, 11));
    const data = conn.current().data;
    expect(data?.kind === 'state' && data.state.live.homeScore).toBe(11);
    conn.stop();
  });

  it('reconnects with backoff and keeps the state shown, ignoring an older state after reconnecting', () => {
    const { conn, sockets, last } = setup();
    conn.start();
    last().open();
    last().deliver(stateMsg(MATCH_A, 7));
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
    last().deliver(stateMsg(MATCH_A, 6));
    expect(conn.current().data).toMatchObject({ version: 7 });
    last().deliver(stateMsg(MATCH_A, 8));
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
      socket.deliver(stateMsg(MATCH_A, 2));
      socket.deliver(stateMsg(MATCH_A, 1));
    });
    expect(result.current.status).toBe('live');
    expect(result.current.data).toMatchObject({ kind: 'state', version: 2 });
    act(() => socket.serverClose(CLOSE_LINK_INVALID));
    expect(result.current.status).toBe('invalid');
    unmount();
    expect(sockets).toHaveLength(1);
  });
});

describe('LiveConnection: patches, resync and gzip', () => {
  it('applies patches and asks resync once when a step is missing', () => {
    const { conn, last } = setup();
    conn.start();
    last().open();
    last().deliver(stateMsg(MATCH_A, 1, 0));
    last().deliver(patchMsg(MATCH_A, 1, 2, 1));
    expect(conn.current().data).toMatchObject({ version: 2 });
    last().deliver(patchMsg(MATCH_A, 3, 4, 5));
    last().deliver(patchMsg(MATCH_A, 4, 5, 6));
    expect(last().outgoing).toEqual([{ type: 'resync' }]);
    expect(conn.current().data).toMatchObject({ version: 2 });
    last().deliver(stateMsg(MATCH_A, 5, 6));
    last().deliver(patchMsg(MATCH_A, 5, 6, 7));
    const data = conn.current().data;
    expect(data).toMatchObject({ version: 6 });
    expect(data?.kind === 'state' && data.state.live.homeScore).toBe(7);
    expect(last().outgoing).toHaveLength(1);
    conn.stop();
  });

  it('marks as live only the updates: not the first state of a socket nor the answer to a resync', () => {
    const { conn, last } = setup();
    conn.start();
    last().open();
    const live = (): boolean | undefined => {
      const data = conn.current().data;
      return data?.kind === 'state' ? data.live : undefined;
    };
    last().deliver(stateMsg(MATCH_A, 1, 0));
    expect(live()).toBeUndefined();
    last().deliver(patchMsg(MATCH_A, 1, 2, 1));
    expect(live()).toBe(true);
    // a full state sent instead of a patch (too big) is an update too
    last().deliver(stateMsg(MATCH_A, 3, 2));
    expect(live()).toBe(true);
    // missing step: the full state of the resync only brings the match up to date
    last().deliver(patchMsg(MATCH_A, 5, 6, 9));
    last().deliver(stateMsg(MATCH_A, 6, 9));
    expect(live()).toBeUndefined();
    // a new socket (reconnection): its first state is not live
    last().serverClose(1006);
    vi.advanceTimersByTime(10_000);
    last().open();
    last().deliver(stateMsg(MATCH_A, 7, 10));
    expect(live()).toBeUndefined();
    last().deliver(patchMsg(MATCH_A, 7, 8, 11));
    expect(live()).toBe(true);
    conn.stop();
  });

  it('sends resync again when its full state does not arrive, and stops once it does', () => {
    const { conn, last } = setup();
    conn.start();
    last().open();
    last().deliver(stateMsg(MATCH_A, 1, 0));
    last().deliver(patchMsg(MATCH_A, 3, 4, 5));
    expect(last().outgoing).toHaveLength(1);
    vi.advanceTimersByTime(7999);
    expect(last().outgoing).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(last().outgoing).toEqual([{ type: 'resync' }, { type: 'resync' }]);
    last().deliver(stateMsg(MATCH_A, 4, 5));
    vi.advanceTimersByTime(60_000);
    expect(last().outgoing).toHaveLength(2);
    expect(conn.current().data).toMatchObject({ version: 4 });
    conn.stop();
  });

  it('asks gzip frames and handles binary and text frames in order', async () => {
    const { conn, last } = setup(undefined, { gzip: true });
    conn.start();
    expect(last().url).toBe('ws://test/ws/public/abc?enc=gzip');
    expect(last().binaryType).toBe('arraybuffer');
    last().open();
    last().deliverGzip(stateMsg(MATCH_A, 1, 0));
    last().deliverGzip(patchMsg(MATCH_A, 1, 2, 1));
    // A text frame right after the binary ones waits for them.
    last().deliver({ type: 'error', message: 'avviso' });
    expect(conn.current().data).toBeNull();
    await vi.waitFor(() => expect(conn.current().error).toBe('avviso'));
    expect(conn.current().data).toMatchObject({ version: 2 });
    conn.stop();
  });

  it('does not ask gzip when told not to', () => {
    const { conn, last } = setup();
    conn.start();
    expect(last().url).toBe('ws://test/ws/public/abc');
    conn.stop();
  });

  it('spreads the reconnections after a server restart', () => {
    const { conn, sockets, last } = setup(undefined, { restartSpreadMs: 10_000 });
    conn.start();
    last().open();
    last().serverClose(1001);
    vi.advanceTimersByTime(4999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    conn.stop();
  });

  it('waits the Retry-After (plus up to half of it) when the server is full', async () => {
    const probe = vi.fn<() => Promise<ProbeResult>>().mockResolvedValue({ retryAfterMs: 20_000 });
    const { conn, sockets, last } = setup(probe);
    conn.start();
    last().serverClose(1006);
    // Lets the probe answer without moving the fake clock (vi.waitFor would advance it).
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.current()).toMatchObject({ status: 'reconnecting', serverFull: true });
    vi.advanceTimersByTime(24_999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(conn.current().serverFull).toBe(false);
    conn.stop();
  });
});

describe('config signal of the graphics', () => {
  it('calls onConfig on config and after a reconnection, never touching the match on screen', () => {
    const sockets: FakeSocket[] = [];
    const onConfig = vi.fn();
    const conn = new LiveConnection({
      url: 'ws://test/ws/public/abc',
      onChange: vi.fn(),
      createSocket: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
      baseDelayMs: 1000,
      random: () => 0.5,
      gzip: false,
      restartSpreadMs: 0,
      onConfig,
    });
    conn.start();
    const first = sockets.at(-1) as FakeSocket;
    first.open();
    first.deliver(stateMsg(MATCH_A, 3));
    expect(onConfig).not.toHaveBeenCalled();
    const before = conn.current();
    first.deliver({ type: 'config' });
    expect(onConfig).toHaveBeenCalledWith('changed');
    expect(conn.current()).toBe(before);
    first.serverClose(1006);
    vi.advanceTimersByTime(10_000);
    (sockets.at(-1) as FakeSocket).open();
    expect(onConfig).toHaveBeenLastCalledWith('reconnected');
    expect(onConfig).toHaveBeenCalledTimes(2);
    conn.stop();
  });

  it('useLiveSocket reads the graphics again (fresh) when config arrives, keeping the state', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);
    const sockets: FakeSocket[] = [];
    const createSocket = (url: string): FakeSocket => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    };
    const { result, unmount } = renderHook(() => useLiveSocket('ws://test/ws/public/abc', { createSocket }));
    const socket = sockets.at(-1) as FakeSocket;
    act(() => {
      socket.open();
      socket.deliver(stateMsg(MATCH_A, 2));
      socket.deliver({ type: 'config' });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/public/tenant', expect.objectContaining({ cache: 'no-cache' }));
    expect(result.current.data).toMatchObject({ kind: 'state', matchId: MATCH_A, version: 2 });
    expect(sockets).toHaveLength(1);
    unmount();
    vi.unstubAllGlobals();
  });
});
