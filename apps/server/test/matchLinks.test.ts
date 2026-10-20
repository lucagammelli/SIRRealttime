import { generateMatch } from '@sir/dvw-simulator';
import type {
  CalendarResponse,
  ClubFixture,
  CreateShareTokenResponse,
  MeResponse,
  ScheduleResponse,
  ShareTokenSummary,
  TenantSummary,
} from '@sir/shared';
import { MATCH_LINKS_DISABLED_MESSAGE } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { matches, shareTokens } from '../src/db/index.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createAgent, fileAt, ingest, login, requestFor, startServer, SUPERADMIN } from './helpers.js';

/**
 * «Link e QR per singola partita» (`tenants.match_links_enabled`, only the superadmin changes it): off, the links of
 * one match are revoked for good and no new one is created; on again, every match of the calendar gets a new link.
 */

let server: TestServer;
let admin: string;
let superadmin: string;
let baseUrl: string;
let fixedToken: string;
let channelToken: string;
let simulationToken: string;
let fixtureCode: string;
let firstFixtureId: string;
let firstLinkId: string;

const call = (options: InjectOptions, cookie: string | null = admin) =>
  server.app.inject({ ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });

const status = async (access: string): Promise<number> =>
  (await call({ url: `/api/public/${access}/state` }, null)).statusCode;

const setOption = (matchLinksEnabled: boolean, cookie = superadmin) =>
  call({ method: 'PATCH', url: `/api/admin/tenants/${server.tenantId}`, payload: { matchLinksEnabled } }, cookie);

const calendar = async (): Promise<ClubFixture[]> =>
  (await call({ url: '/api/admin/calendar' })).json<CalendarResponse>().fixtures;

const addFixture = async (opponent: string, startsAt: string): Promise<string> => {
  const res = await call({
    method: 'POST',
    url: '/api/admin/calendar/fixtures',
    payload: {
      kind: 'friendly',
      startsAt,
      opponent,
      opponentLogo: null,
      ourSide: 'home',
      venue: null,
      venueCity: null,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ id: string }>().id;
};

const share = (matchId: string | null) =>
  call({ method: 'POST', url: '/api/admin/share-tokens', payload: { label: 'Tribuna', matchId, expiresAt: null } });

/** Opens a public socket; resolves `closed` when the server closes it. */
async function connect(token: string) {
  const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/public/${token}`);
  const closed = new Promise<number>((resolve) => ws.addEventListener('close', (e) => resolve(e.code)));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('connection refused')));
  });
  return { ws, closed };
}

beforeAll(async () => {
  server = await startServer();
  admin = await login(server.app, ADMIN);
  superadmin = await login(server.app, SUPERADMIN);
  baseUrl = await server.app.listen({ port: 0, host: '127.0.0.1' });
  const agent = await createAgent(server);
  const file = fileAt(generateMatch({ seed: 3 }), 20);
  expect((await ingest(server.app, agent, await requestFor('gara', 0, [], file))).json()).toMatchObject({
    status: 'ok',
  });
  const [match] = await server.database.db.select().from(matches).where(eq(matches.matchKey, 'gara'));
  if (!match) throw new Error('match missing');
  fixedToken = (await share(match.id)).json<CreateShareTokenResponse>().token;
  channelToken = (await share(null)).json<CreateShareTokenResponse>().token;
  // The link of a simulation: a link of one match that the option never touches.
  const [simulated] = await server.database.db
    .insert(matches)
    .values({ tenantId: server.tenantId, matchKey: 'simulazione', simulated: true, live: false })
    .returning();
  if (!simulated) throw new Error('simulated match missing');
  simulationToken = generateToken();
  await server.database.db.insert(shareTokens).values({
    tenantId: server.tenantId,
    tokenHash: hashToken(simulationToken),
    matchId: simulated.id,
    label: 'Simulazione',
  });
  firstFixtureId = await addFixture('Suntory Sunbirds', '2026-12-12T16:00:00.000Z');
  const link = (await calendar()).find((f) => f.id === firstFixtureId)?.link;
  firstLinkId = link?.id ?? '';
  fixtureCode = link?.shortCode ?? '';
}, 30_000);
afterAll(() => server.close());

describe('links of single matches as an option of the client', () => {
  it('works on the links of the client while the option is on', async () => {
    expect(fixtureCode).not.toBe('');
    for (const access of [fixedToken, channelToken, simulationToken, fixtureCode])
      expect(await status(access)).toBe(200);
    expect((await call({ url: '/api/auth/me' })).json<MeResponse>().tenant).toMatchObject({ matchLinksEnabled: true });
  });

  it('is changed only by the superadmin', async () => {
    expect((await setOption(false, admin)).statusCode).toBe(403);
    expect(await status(fixedToken)).toBe(200);
  });

  it('switched off, revokes the links of one match for good and disconnects their spectators', async () => {
    const fixed = await connect(fixedToken);
    const channel = await connect(channelToken);
    const res = await setOption(false);
    expect(res.statusCode).toBe(200);
    expect(res.json<TenantSummary>()).toMatchObject({ matchLinksEnabled: false });
    expect(await fixed.closed).toBeGreaterThan(0);
    expect(channel.ws.readyState).toBe(WebSocket.OPEN);
    channel.ws.close();
    expect(await status(fixedToken)).toBe(404);
    expect(await status(fixtureCode)).toBe(404);
    expect(await status(channelToken)).toBe(200);
    expect(await status(simulationToken)).toBe(200);
    // The admin sees the revoked links («Mostra revocati») and its client without the option.
    const links = (await call({ url: '/api/admin/share-tokens' })).json<ShareTokenSummary[]>();
    expect(links.filter((l) => l.revoked).map((l) => l.matchId !== null || l.label !== 'Tribuna')).toEqual([
      true,
      true,
    ]);
    const valid = links.filter((l) => !l.revoked);
    expect(valid).toHaveLength(1);
    // The QR of «Prossima partita» falls back on the channel of the club.
    const schedule = (await call({ url: '/api/public/tenant/schedule' }, null)).json<ScheduleResponse>();
    expect(schedule.fixtures.map((f) => f.shortUrl)).toEqual([valid[0]?.shortUrl]);
    expect((await call({ url: '/api/auth/me' })).json<MeResponse>().tenant).toMatchObject({
      matchLinksEnabled: false,
    });
    expect((await calendar()).find((f) => f.id === firstFixtureId)?.link).toMatchObject({ revoked: true });
  });

  it('refuses «Una partita fissa» and creates no link for the matches of the calendar', async () => {
    const [match] = await server.database.db.select().from(matches).where(eq(matches.matchKey, 'gara'));
    const refused = await share(match?.id ?? null);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: MATCH_LINKS_DISABLED_MESSAGE });
    expect((await share(null)).statusCode).toBe(201);
    const second = await addFixture('Halkbank Ankara', '2026-12-19T16:00:00.000Z');
    expect((await calendar()).find((f) => f.id === second)?.link).toBeNull();
  });

  it('never serves a link of one match left valid while the option is off', async () => {
    await server.database.db.update(shareTokens).set({ revoked: false }).where(eq(shareTokens.id, firstLinkId));
    expect(await status(fixtureCode)).toBe(404);
    await server.database.db.update(shareTokens).set({ revoked: true }).where(eq(shareTokens.id, firstLinkId));
  });

  it('switched on again, gives every match a new link and leaves the old ones revoked', async () => {
    expect((await setOption(true)).statusCode).toBe(200);
    expect(await status(fixtureCode)).toBe(404);
    expect(await status(fixedToken)).toBe(404);
    const fixtures = await calendar();
    expect(fixtures).toHaveLength(2);
    for (const f of fixtures) expect(f.link?.shortCode).toBeTruthy();
    const renewed = fixtures.find((f) => f.id === firstFixtureId)?.link;
    expect(renewed?.id).not.toBe(firstLinkId);
    expect(await status(renewed?.shortCode ?? '')).toBe(200);
    const schedule = (await call({ url: '/api/public/tenant/schedule' }, null)).json<ScheduleResponse>();
    expect(schedule.fixtures[0]?.shortUrl).toBe(renewed?.shortUrl);
  });

  it('does not create again by itself a link revoked by the admin while the option is on', async () => {
    const link = (await calendar()).find((f) => f.id === firstFixtureId)?.link;
    expect((await call({ method: 'DELETE', url: `/api/admin/share-tokens/${link?.id ?? ''}` })).statusCode).toBe(204);
    const third = await addFixture('Zaksa', '2026-12-26T16:00:00.000Z');
    const fixtures = await calendar();
    expect(fixtures.find((f) => f.id === firstFixtureId)?.link).toMatchObject({ id: link?.id, revoked: true });
    expect(fixtures.find((f) => f.id === third)?.link).toMatchObject({ revoked: false });
  });
});
