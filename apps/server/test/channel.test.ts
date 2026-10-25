import { generateMatch } from '@arenalive/dvw-simulator';
import type { CreateShareTokenResponse, ServerMessage } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shareTokens } from '../src/db/index.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import { insertShareToken } from '../src/shareCodes.js';
import { clubLookOf } from '../src/club.js';
import { channelChoice, CHANNEL_STALE_MS, pickNextFixture } from '../src/state.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createAgent, fileAt, ingest, login, requestFor, startServer } from './helpers.js';

const HOUR = 3_600_000;

describe('channelChoice', () => {
  const now = new Date('2026-10-12T18:00:00Z');
  const next = { startsAt: new Date('2026-10-19T16:00:00Z') };
  it('shows the match being played, otherwise the next one, and after a match the finished one until its day', () => {
    const playing = { live: true, finished: false, updatedAt: new Date(now.getTime() - 60_000) };
    expect(channelChoice({ latest: playing, next, now })).toBe('latest');
    const finished = { ...playing, finished: true };
    expect(channelChoice({ latest: finished, next, now })).toBe('latest');
    // From 00:00 in Rome of the day of the next match (22:00 UTC of the day before, summer time).
    expect(channelChoice({ latest: finished, next, now: new Date('2026-10-18T21:59:00Z') })).toBe('latest');
    expect(channelChoice({ latest: finished, next, now: new Date('2026-10-18T22:00:00Z') })).toBe('next');
    expect(channelChoice({ latest: null, next, now })).toBe('next');
    expect(channelChoice({ latest: finished, next: null, now })).toBe('latest');
    expect(channelChoice({ latest: null, next: null, now })).toBe('none');
    // An agent left on with a match never finished does not hold the channel for ever.
    const stale = { ...playing, updatedAt: new Date(now.getTime() - CHANNEL_STALE_MS) };
    expect(channelChoice({ latest: stale, next: { startsAt: new Date(now.getTime() + HOUR) }, now })).toBe('next');
  });
});

describe('channelChoice after the end of a match', () => {
  const finishedAt = new Date('2026-10-25T15:00:00Z');
  const latest = { live: false, finished: true, updatedAt: finishedAt, finishedAt };
  const after = (minutes: number) => new Date(finishedAt.getTime() + minutes * 60_000);
  const withPhoto = { image: 'a'.repeat(32), delayMinutes: 30 };
  const noPhoto = { image: null, delayMinutes: 30 };
  // A match of the same day, later: its day has already started.
  const next = { startsAt: new Date('2026-10-25T18:00:00Z') };

  it('keeps the finished match for delayMinutes even when the next match is today', () => {
    expect(channelChoice({ latest, next, now: after(1), afterMatch: noPhoto })).toBe('latest');
    expect(channelChoice({ latest, next, now: after(29), afterMatch: noPhoto })).toBe('latest');
    expect(channelChoice({ latest, next, now: after(30), afterMatch: noPhoto })).toBe('next');
    // Without the screen configured nothing is waited (as before).
    expect(channelChoice({ latest, next, now: after(1), afterMatch: null })).toBe('next');
  });

  it('with a photo keeps the finished match (photo and countdown) until the next match starts', () => {
    expect(channelChoice({ latest, next, now: after(31), afterMatch: withPhoto })).toBe('latest');
    expect(channelChoice({ latest, next, now: next.startsAt, afterMatch: withPhoto })).toBe('next');
  });

  it('ignores a calendar match that started before the end: it is the match just finished', () => {
    const same = { startsAt: new Date('2026-10-25T13:00:00Z') };
    expect(channelChoice({ latest, next: same, now: after(1), afterMatch: withPhoto })).toBe('latest');
    expect(channelChoice({ latest, next: same, now: after(120), afterMatch: noPhoto })).toBe('latest');
  });
});

describe('clubLookOf afterMatch', () => {
  it('waits delayMinutes only when «Dopo la partita» is on', () => {
    const image = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
    const base = { branding: {}, clubProfile: {} };
    expect(clubLookOf({ ...base, intermissions: { afterMatch: { enabled: false } } }).afterMatch.delayMinutes).toBe(0);
    expect(clubLookOf({ ...base, intermissions: { afterMatch: { enabled: true, image } } }).afterMatch).toEqual({
      image,
      delayMinutes: 30,
    });
    expect(clubLookOf(base).afterMatch).toEqual({ image: null, delayMinutes: 0 });
  });
});

describe('pickNextFixture', () => {
  const at = (id: string, iso: string) => ({ id, startsAt: new Date(iso), overrideStartsAt: null });
  const played = at('played', '2026-10-25T16:00:00Z');
  const following = at('following', '2026-11-01T16:00:00Z');
  const endedAt = new Date('2026-10-25T18:30:00Z');

  it('skips the match just played (already begun) and picks the real next one', () => {
    expect(pickNextFixture([played, following], new Set(), endedAt)?.id).toBe('following');
  });

  it('is null when there is no later match', () => {
    expect(pickNextFixture([played], new Set(), endedAt)).toBeNull();
    expect(pickNextFixture([], new Set(), endedAt)).toBeNull();
  });

  it('is unchanged without a finished match: the first one not live', () => {
    expect(pickNextFixture([played, following], new Set(), null)?.id).toBe('played');
    expect(pickNextFixture([played, following], new Set(['played']), null)?.id).toBe('following');
  });
});

let server: TestServer;
let cookie: string;
let agent: string;
const call = (options: InjectOptions, who: string | null = cookie) =>
  server.app.inject({ ...options, headers: { ...(who ? { cookie: who } : {}), ...options.headers } });
const state = async (token: string): Promise<ServerMessage> =>
  (await call({ url: `/api/public/${token}/state` }, null)).json<ServerMessage>();
const at = async (iso: string) => {
  server.setNow(new Date(iso));
  cookie = await login(server.app, ADMIN);
};
const addMatch = (startsAt: string, opponent: string, ourSide = 'home') =>
  call({
    method: 'POST',
    url: '/api/admin/calendar/fixtures',
    payload: { kind: 'friendly', startsAt, opponent, opponentLogo: null, ourSide, venue: null, venueCity: null },
  });

beforeAll(async () => {
  server = await startServer();
  await at('2026-10-10T10:00:00Z');
  agent = await createAgent(server);
  // «Nostra squadra» of the friendly matches (no championship: matches added by hand only).
  const club = await call({ url: '/api/admin/club' });
  const body = club.json<{ ourTeam: unknown; profile: unknown }>();
  await call({
    method: 'PUT',
    url: '/api/admin/club/profile',
    payload: {
      displayName: 'Sir Perugia',
      logoMark: null,
      ourTeam: { code: null, name: 'Perugia' },
      profile: body.profile,
    },
  });
});
afterAll(() => server.close());

describe('channel of the club («tutte le partite del calendario»)', () => {
  let channel: string;
  let old: string;

  it('shows the next broadcast match before any match, also on the old «live» links', async () => {
    const created = await call({
      method: 'POST',
      url: '/api/admin/share-tokens',
      payload: { label: 'Canale', matchId: null, expiresAt: null },
    });
    channel = created.json<CreateShareTokenResponse>().token;
    expect(await state(channel)).toEqual({ type: 'noMatch' });
    // A link «segue la live» created before the channels: same row, it works as a channel.
    old = generateToken();
    await insertShareToken(server.database.db, 'x'.repeat(32), {
      tenantId: server.tenantId,
      tokenHash: hashToken(old),
      matchId: null,
      label: 'Segue la live',
      expiresAt: null,
    });
    expect((await call({ method: 'POST', url: '/api/admin/calendar/fixtures', payload: {} })).statusCode).toBe(400);
    expect((await addMatch('2026-10-11T16:00:00.000Z', 'Trasferta Lontana', 'away')).statusCode).toBe(201);
    expect((await addMatch('2026-10-12T16:00:00.000Z', 'Suntory Sunbirds')).statusCode).toBe(201);
    expect((await addMatch('2026-10-19T16:00:00.000Z', 'Halkbank Ankara')).statusCode).toBe(201);
    // «Solo partite in casa»: the away match is skipped.
    const club = await call({ url: '/api/admin/club' });
    const body = club.json<{
      displayName: string | null;
      logoMark: string | null;
      ourTeam: unknown;
      profile: object;
    }>();
    const saved = await call({
      method: 'PUT',
      url: '/api/admin/club/profile',
      payload: {
        displayName: body.displayName,
        logoMark: body.logoMark,
        ourTeam: body.ourTeam,
        profile: { ...body.profile, coverage: 'homeOnly' },
      },
    });
    expect(saved.statusCode).toBe(200);
    for (const token of [channel, old])
      expect(await state(token)).toMatchObject({
        type: 'scheduled',
        fixture: { startsAt: '2026-10-12T16:00:00.000Z', away: { name: 'Suntory Sunbirds' } },
      });
    const [row] = await server.database.db.select().from(shareTokens).where(eq(shareTokens.label, 'Segue la live'));
    expect(row?.matchId).toBeNull();
  });

  it('shows the match live, then stays on it when it ends until the day of the next match', async () => {
    await at('2026-10-12T16:05:00Z');
    const match = generateMatch({
      seed: 9,
      homeName: 'Sir Perugia',
      awayName: 'Suntory Sunbirds',
      startTime: '2026-10-12T16:00:00Z',
    });
    let res = await ingest(server.app, agent, await requestFor('canale', 1, [], fileAt(match, 30)));
    expect(res.json()).toMatchObject({ status: 'ok' });
    const live = await state(channel);
    expect(live).toMatchObject({ type: 'state', state: { status: 'inProgress' } });
    const prev = fileAt(match, 30).scoutLines;
    res = await ingest(server.app, agent, await requestFor('canale', 2, prev, fileAt(match, match.lines.length)));
    expect(res.json()).toMatchObject({ status: 'ok' });
    await at('2026-10-15T10:00:00Z');
    expect(await state(channel)).toMatchObject({ type: 'state', state: { status: 'finished' } });
    await at('2026-10-18T22:30:00Z');
    expect(await state(old)).toMatchObject({
      type: 'scheduled',
      fixture: { startsAt: '2026-10-19T16:00:00.000Z', away: { name: 'Halkbank Ankara' } },
    });
  });

  it('never shows a .dvw linked to a match not broadcast, and lets go of a match that sends nothing for 6 h', async () => {
    await at('2026-10-19T16:05:00Z');
    const cal = (await call({ url: '/api/admin/calendar' })).json<{
      fixtures: { id: string; away: { name: string } }[];
    }>();
    const halkbank = cal.fixtures.find((f) => f.away.name === 'Halkbank Ankara');
    if (!halkbank) throw new Error('missing');
    const match = generateMatch({
      seed: 4,
      homeName: 'Sir Perugia',
      awayName: 'Halkbank Ankara',
      startTime: '2026-10-19T16:00:00Z',
    });
    expect(
      (await ingest(server.app, agent, await requestFor('halkbank', 1, [], fileAt(match, 20)))).json(),
    ).toMatchObject({ status: 'ok' });
    const live = await state(channel);
    expect(live).toMatchObject({ type: 'state', state: { status: 'inProgress' } });
    const liveId = live.type === 'state' ? live.matchId : '';
    // «Non trasmessa»: the channel goes back to the last broadcast match.
    await call({
      method: 'PATCH',
      url: `/api/admin/calendar/fixtures/${halkbank.id}/settings`,
      payload: { broadcast: 'off' },
    });
    const off = await state(channel);
    expect(off.type === 'state' && off.matchId).not.toBe(liveId);
    await call({
      method: 'PATCH',
      url: `/api/admin/calendar/fixtures/${halkbank.id}/settings`,
      payload: { broadcast: 'auto' },
    });
    expect(await state(channel)).toMatchObject({ type: 'state', matchId: liveId });
    // The agent stops sending: after 6 h the next match takes the channel.
    expect((await addMatch('2026-10-20T16:00:00.000Z', 'Zaksa Kedzierzyn')).statusCode).toBe(201);
    await at('2026-10-19T22:30:00Z');
    expect(await state(channel)).toMatchObject({ type: 'scheduled', fixture: { away: { name: 'Zaksa Kedzierzyn' } } });
  });
});
