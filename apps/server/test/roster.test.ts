import type {
  AssetSummary,
  ImportRosterResponse,
  Player,
  PublicTenantResponse,
  RosterResponse,
} from '@arenalive/shared';
import { PLAYERS_MAX, VIDEO_UPLOAD_PATH } from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { assets, leagues, leagueTeams, playerMedia, players, tenantLeagues, tenants } from '../src/db/index.js';
import type { FetchLike } from '../src/leagues/fetcher.js';
import { parseRoster, playerPhotoUrl, rejectedUrlReason, splitPlayerName } from '../src/leagues/legavolley.js';
import type { ExistingPlayer } from '../src/roster.js';
import { mergeRoster } from '../src/roster.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, startServer, VIEWER } from './helpers.js';
import { png } from './imageFixtures.js';
import { NO_PLAYER_PHOTO, playerPhotoBytes, rosterPage } from './leagueFixtures.js';
import { mp4 } from './videoFixtures.js';

// --- Connector ----------------------------------------------------------------------------------------------

describe('roster of the team page of the league', () => {
  it('reads every player of the table «Roster» of Perugia, never the staff', () => {
    const roster = parseRoster(rosterPage());
    expect(roster).toHaveLength(14);
    expect(roster[0]).toEqual({
      key: 'HEN-MAT-05',
      number: 4,
      firstName: 'Mathis',
      lastName: 'Henno',
      role: 'outside',
      birthYear: 2005,
      heightCm: 195,
      birthplace: 'FRA',
      nationality: 'FRA',
    });
    expect(roster.find((p) => p.key === 'SOL-SEB-91')).toMatchObject({
      lastName: 'Solé',
      role: 'middle',
      nationality: 'ITA',
    });
    expect(roster.find((p) => p.number === 21)).toMatchObject({ firstName: 'Seyed Matin', lastName: 'Hosseini' });
    expect(roster.map((p) => p.lastName)).not.toContain('Lorenzetti');
  });

  it('fails clearly without the table, skips rows without a valid key or number, keeps each key once', () => {
    expect(() => parseRoster('<html><body><p>Manutenzione</p></body></html>')).toThrow(/tabella «Roster»/);
    const row = (key: string, number: string, name: string) =>
      `<tr><td class="num-maglia">${number}</td><td class="nome"><a href="/player/${key}">${name}</a></td><td class="ruolo desk">Libero</td></tr>`;
    const html = `<table id="roster"><tbody>${row('ROS-MAR-01', '1', 'ROSSI Mario')}${row('ROS-MAR-01', '2', 'ROSSI Mario')}${row(
      '../x',
      '3',
      'X Y',
    )}${row('BIA-LUC-02', '?', 'BIANCHI Luca')}${row('DEC-LUC-03', '5', "D'AMICO DE CECCO Luciano")}</tbody></table>`;
    expect(parseRoster(html).map((p) => [p.key, p.number, p.lastName, p.firstName, p.role])).toEqual([
      ['ROS-MAR-01', 1, 'Rossi', 'Mario', 'libero'],
      ['DEC-LUC-03', 5, "D'Amico De Cecco", 'Luciano', 'libero'],
    ]);
    const many = Array.from({ length: PLAYERS_MAX + 5 }, (_, i) =>
      row(`AAA-BBB-${i}`, String(i % 100), `N${i} Nome`),
    ).join('');
    expect(parseRoster(`<table id="roster">${many}</table>`)).toHaveLength(PLAYERS_MAX);
  });

  it('splits the names as the site writes them (surname in capitals first)', () => {
    expect(splitPlayerName('HENNO Mathis')).toEqual({ firstName: 'Mathis', lastName: 'Henno' });
    expect(splitPlayerName('FLAVIO')).toEqual({ firstName: 'Flavio', lastName: 'Flavio' });
    expect(splitPlayerName('Mario Rossi')).toEqual({ firstName: 'Mario', lastName: 'Rossi' });
    expect(splitPlayerName('  ')).toBeNull();
  });

  it('builds the address of a photo only for a valid key, on an allowed path', () => {
    const url = playerPhotoUrl('HEN-MAT-05', 6865);
    expect(url.toString()).toBe('https://www.legavolley.it/Foto.aspx?Key=HEN-MAT-05&sqid=6865&heightImg=600');
    expect(rejectedUrlReason(url)).toBeNull();
    for (const bad of ['hen-mat-05', 'HEN', '../HEN-MAT', 'HEN-MAT-05&x=1', 'A-B-C-D-E'])
      expect(() => playerPhotoUrl(bad, 6865)).toThrow();
    expect(() => playerPhotoUrl('HEN-MAT-05', 0)).toThrow();
  });
});

// --- Merge ------------------------------------------------------------------------------------------------------

describe('merge of the roster of the site', () => {
  const site = parseRoster(rosterPage());
  const existing = (over: Partial<ExistingPlayer>): ExistingPlayer => ({
    id: over.id ?? 'p1',
    number: 4,
    firstName: 'Mathis',
    lastName: 'Henno',
    role: 'outside',
    birthYear: 2005,
    heightCm: 195,
    birthplace: 'FRA',
    nationality: 'FRA',
    externalKey: 'HEN-MAT-05',
    source: 'league',
    editedFields: [],
    removedAt: null,
    ...over,
  });

  it('adds the new players and updates only the fields not changed by hand', () => {
    const m = mergeRoster([existing({ firstName: 'Mat', heightCm: 190, editedFields: ['firstName'] })], site);
    expect(m.inserts).toHaveLength(13);
    expect(m.updates).toEqual([{ id: 'p1', set: { heightCm: 195 }, renumbered: false }]);
    expect(m.skipped).toEqual([]);
  });

  it('never brings back a removed player, never deletes who is not on the site', () => {
    const m = mergeRoster(
      [
        existing({ removedAt: new Date() }),
        existing({ id: 'old', number: 99, externalKey: 'OLD-PLA-90', lastName: 'Vecchio' }),
      ],
      site,
    );
    expect(m.inserts.map((p) => p.key)).not.toContain('HEN-MAT-05');
    expect(m.notOnSite).toEqual([{ id: 'old', number: 99, name: 'Vecchio Mathis' }]);
  });

  it('adopts a player added by hand with the same number and surname, keeping its data', () => {
    const m = mergeRoster(
      [
        existing({
          id: 'man',
          number: 6,
          lastName: 'GIANNELLI',
          firstName: 'Simo',
          externalKey: null,
          source: 'manual',
          role: null,
          birthYear: null,
          heightCm: null,
          birthplace: null,
          nationality: null,
        }),
      ],
      site,
    );
    expect(m.inserts.map((p) => p.key)).not.toContain('GIA-SIM-96');
    const adopted = m.updates.find((u) => u.id === 'man');
    expect(adopted?.set).toMatchObject({ externalKey: 'GIA-SIM-96', source: 'league', role: 'setter', heightCm: 200 });
    expect(adopted?.set.editedFields?.sort()).toEqual(['firstName', 'lastName', 'number']);
    expect(adopted?.set.firstName).toBeUndefined();
  });

  it('skips a number already used by another player, with the reason', () => {
    const m = mergeRoster(
      [existing({ id: 'm', number: 7, lastName: 'Bianchi', firstName: 'Luca', externalKey: null, source: 'manual' })],
      site,
    );
    expect(m.skipped).toEqual([{ number: 7, name: 'Reggers Ferre', reason: 'numero 7 già usato da Bianchi Luca' }]);
    // A changed number on the site that another player has: the number stays.
    const moved = site.map((p) => (p.key === 'HEN-MAT-05' ? { ...p, number: 7 } : p));
    const m2 = mergeRoster(
      [existing({}), existing({ id: 'r', number: 7, externalKey: 'XXX-YYY-01', lastName: 'Altro' })],
      moved,
    );
    expect(m2.updates.find((u) => u.id === 'p1')?.set.number).toBeUndefined();
    expect(m2.skipped[0]?.reason).toContain('già usato da Altro');
  });
});

describe('merge of the roster: numbers that move', () => {
  const sp = (key: string, number: number, lastName: string) => ({
    key,
    number,
    firstName: 'N',
    lastName,
    role: null,
    birthYear: null,
    heightCm: null,
    birthplace: null,
    nationality: null,
  });
  const ex = (id: string, key: string, number: number, lastName: string): ExistingPlayer => ({
    ...sp(key, number, lastName),
    id,
    externalKey: key,
    source: 'league',
    editedFields: [],
    removedAt: null,
  });

  it('a player that leaves its number frees it for a new one, whatever the order of the site', () => {
    const m = mergeRoster(
      [ex('a', 'AAA-AAA-01', 5, 'Alfa')],
      [sp('NEW-NEW-01', 5, 'Nuovo'), sp('AAA-AAA-01', 9, 'Alfa')],
    );
    expect(m.updates).toEqual([{ id: 'a', set: { number: 9 }, renumbered: true }]);
    expect(m.inserts.map((p) => p.number)).toEqual([5]);
    expect(m.skipped).toEqual([]);
  });

  it('two players swap their numbers; two that want the same number keep their own', () => {
    const swap = mergeRoster(
      [ex('a', 'AAA-AAA-01', 5, 'Alfa'), ex('b', 'BBB-BBB-01', 9, 'Beta')],
      [sp('AAA-AAA-01', 9, 'Alfa'), sp('BBB-BBB-01', 5, 'Beta')],
    );
    expect(swap.updates.map((u) => [u.id, u.set.number, u.renumbered])).toEqual([
      ['a', 9, true],
      ['b', 5, true],
    ]);
    const clash = mergeRoster(
      [ex('a', 'AAA-AAA-01', 5, 'Alfa'), ex('b', 'BBB-BBB-01', 9, 'Beta')],
      [sp('AAA-AAA-01', 7, 'Alfa'), sp('BBB-BBB-01', 7, 'Beta')],
    );
    expect(clash.updates).toEqual([]);
    expect(clash.skipped.map((x) => x.name)).toEqual(['Alfa N', 'Beta N']);
  });
});

// --- Routes -----------------------------------------------------------------------------------------------------

/** The site: the page of Perugia with its roster and one photo; `hold` keeps the photos waiting until released. */
function site(options: { team?: () => Promise<Response>; hold?: Promise<void> } = {}) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.pathname === '/team/6865')
      return options.team
        ? options.team()
        : new Response(rosterPage(), { headers: { 'content-type': 'text/html; charset=UTF-8' } });
    if (u.pathname === '/Foto.aspx') {
      await options.hold;
      return u.searchParams.get('Key') === 'HEN-MAT-05'
        ? new Response(playerPhotoBytes(), { headers: { 'content-type': 'image/jpg' } })
        : new Response(NO_PLAYER_PHOTO, { headers: { 'content-type': 'image/jpg' } });
    }
    return new Response('non trovato', { status: 404 });
  };
  return { fetch, calls };
}

const servers: TestServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close();
});

async function start(fetch: FetchLike, env: Record<string, string> = {}): Promise<TestServer> {
  const server = await startServer({}, env, { leagueFetcher: { fetch } });
  servers.push(server);
  return server;
}

/** The test client plays the SuperLega 2026 with Perugia (6865). */
async function clubOfPerugia(server: TestServer, tenantId = server.tenantId) {
  const [league] = await server.database.db
    .insert(leagues)
    .values({
      provider: 'legavolley',
      externalId: 999,
      season: 2026,
      name: 'SuperLega',
      lastStatus: 'ok',
      lastSuccessAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  const row = league ?? (await server.database.db.select().from(leagues).where(eq(leagues.externalId, 999)))[0];
  if (!row) throw new Error('no league');
  const [team] = await server.database.db
    .insert(leagueTeams)
    .values({ leagueId: row.id, externalId: 6865, name: 'Sir Susa Scai Perugia' })
    .onConflictDoNothing()
    .returning();
  const teamRow =
    team ?? (await server.database.db.select().from(leagueTeams).where(eq(leagueTeams.externalId, 6865)))[0];
  await server.database.db
    .insert(tenantLeagues)
    .values({ tenantId, leagueId: row.id, leagueTeamId: teamRow?.id ?? null });
  await server.database.db
    .update(tenants)
    .set({
      clubProfile: { series: 'SuperLega', gender: 'M', seriesId: 'superlega', leagueId: row.id, leagueIds: [row.id] },
    })
    .where(eq(tenants.id, tenantId));
}

const caller = async (server: TestServer, who = ADMIN, host?: string) => {
  const cookie = await login(server.app, who, host);
  return (options: InjectOptions) =>
    server.app.inject({ ...options, headers: { cookie, ...(host ? { host } : {}), ...options.headers } });
};

async function waitPhotos(call: Awaited<ReturnType<typeof caller>>): Promise<RosterResponse> {
  for (let i = 0; i < 200; i++) {
    const r = (await call({ url: '/api/admin/roster' })).json<RosterResponse>();
    if (!r.import.running) return r;
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error('photos never ended');
}

const byNumber = (r: RosterResponse, n: number) => {
  const p = r.players.find((x) => x.number === n);
  if (!p) throw new Error(`no player ${n}`);
  return p;
};

describe('roster of the club', () => {
  it('imports the roster of the site with the photos in the background, then keeps what the club changed', async () => {
    const fake = site();
    const server = await start(fake.fetch);
    await clubOfPerugia(server);
    const call = await caller(server);
    const empty = (await call({ url: '/api/admin/roster' })).json<RosterResponse>();
    expect(empty).toMatchObject({
      season: 2026,
      seasons: [2026],
      team: { name: 'Sir Susa Scai Perugia' },
      players: [],
    });
    expect(empty.import).toMatchObject({ running: false, photosDone: 0, lastAt: null });

    const first = await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
    expect(first.statusCode).toBe(200);
    expect(first.json<ImportRosterResponse>()).toMatchObject({ season: 2026, added: 14, updated: 0, photosQueued: 14 });
    let roster = await waitPhotos(call);
    expect(roster.players).toHaveLength(14);
    expect(roster.import).toMatchObject({ running: false, photosDone: 14, photosTotal: 14, lastError: null });
    const henno = byNumber(roster, 4);
    expect(henno).toMatchObject({ source: 'league', externalKey: 'HEN-MAT-05', role: 'outside', removed: false });
    expect(henno.photo?.name).toBe('Henno Mathis.jpg');
    // Only Henno has a photo on the site: the others are left without one.
    expect(roster.players.filter((p) => p.photo !== null)).toHaveLength(1);
    const [stored] = await server.database.db.select().from(assets).where(eq(assets.kind, 'player'));
    expect(stored).toMatchObject({ mime: 'image/jpeg', width: 90, height: 120, name: 'Henno Mathis.jpg' });

    // Changed by hand, removed, added by hand.
    const patched = await call({
      method: 'PATCH',
      url: `/api/admin/roster/players/${henno.id}`,
      payload: { firstName: 'Mat' },
    });
    expect(patched.json<Player>()).toMatchObject({ firstName: 'Mat', editedFields: ['firstName'] });
    const giannelli = byNumber(roster, 6);
    expect((await call({ method: 'DELETE', url: `/api/admin/roster/players/${giannelli.id}` })).statusCode).toBe(204);
    const manual = await call({
      method: 'POST',
      url: '/api/admin/roster/players',
      payload: { number: 99, firstName: 'Mario', lastName: 'Rossi', role: 'libero' },
    });
    expect(manual.statusCode).toBe(201);
    expect(manual.json<Player>()).toMatchObject({ source: 'manual', externalKey: null, number: 99 });
    const taken = await call({
      method: 'POST',
      url: '/api/admin/roster/players',
      payload: { number: 4, firstName: 'A', lastName: 'B' },
    });
    expect(taken.statusCode).toBe(409);

    const again = (
      await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} })
    ).json<ImportRosterResponse>();
    // Photos asked again only for the players without one and still in the roster.
    expect(again).toMatchObject({ added: 0, updated: 0, photosQueued: 12 });
    roster = await waitPhotos(call);
    expect(byNumber(roster, 4).firstName).toBe('Mat');
    expect(roster.players.find((p) => p.id === giannelli.id)?.removed).toBe(true);
    expect(roster.players.filter((p) => !p.removed)).toHaveLength(14);
    // The removed one comes back by hand; the manual one is deleted.
    const back = await call({
      method: 'PATCH',
      url: `/api/admin/roster/players/${giannelli.id}`,
      payload: { removed: false },
    });
    expect(back.json<Player>().removed).toBe(false);
    const manualId = manual.json<Player>().id;
    expect((await call({ method: 'DELETE', url: `/api/admin/roster/players/${manualId}` })).statusCode).toBe(204);
    expect(await server.database.db.select().from(players).where(eq(players.id, manualId))).toEqual([]);
  });

  it('is read by a viewer, changed only by an admin, and only for its own client', async () => {
    const server = await start(site().fetch);
    await clubOfPerugia(server);
    const call = await caller(server);
    await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
    const roster = await waitPhotos(call);
    const id = byNumber(roster, 4).id;
    const viewer = await caller(server, VIEWER);
    expect((await viewer({ url: '/api/admin/roster' })).json<RosterResponse>().players).toHaveLength(14);
    for (const options of [
      { method: 'POST', url: '/api/admin/roster/import', payload: {} },
      { method: 'POST', url: '/api/admin/roster/players', payload: { number: 1, firstName: 'a', lastName: 'b' } },
      { method: 'PATCH', url: `/api/admin/roster/players/${id}`, payload: { firstName: 'x' } },
      { method: 'DELETE', url: `/api/admin/roster/players/${id}` },
      { method: 'PUT', url: `/api/admin/roster/players/${id}/media`, payload: { photoAssetId: null, mediaIds: [] } },
    ] as InjectOptions[])
      expect((await viewer(options)).statusCode, JSON.stringify(options.url)).toBe(403);
    expect((await server.app.inject({ url: '/api/admin/roster' })).statusCode).toBe(401);
    const other = await createTenant(server, 'altro', ['altro.test']);
    const adminB = { email: 'b@altro.test', password: 'password-altro-1' };
    await createUser(server, adminB, 'admin', other);
    const callB = await caller(server, adminB, 'altro.test');
    expect(
      (await callB({ method: 'PATCH', url: `/api/admin/roster/players/${id}`, payload: { firstName: 'x' } }))
        .statusCode,
    ).toBe(404);
    expect((await callB({ method: 'DELETE', url: `/api/admin/roster/players/${id}` })).statusCode).toBe(404);
    expect((await callB({ url: '/api/admin/roster' })).json<RosterResponse>()).toMatchObject({
      season: null,
      players: [],
    });
    // Without the team of the club: nothing to import, nowhere to add.
    expect((await callB({ method: 'POST', url: '/api/admin/roster/import', payload: {} })).statusCode).toBe(409);
    expect(
      (
        await callB({
          method: 'POST',
          url: '/api/admin/roster/players',
          payload: { number: 1, firstName: 'a', lastName: 'b' },
        })
      ).statusCode,
    ).toBe(409);
    expect((await call({ url: '/api/admin/roster?season=abc' })).statusCode).toBe(400);
  });

  it('refuses a second import while the photos are coming, and answers 502 when the site fails', async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    const server = await start(site({ hold }).fetch);
    await clubOfPerugia(server);
    const call = await caller(server);
    expect((await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} })).statusCode).toBe(200);
    const busy = await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
    expect(busy.statusCode).toBe(409);
    expect((await call({ url: '/api/admin/roster' })).json<RosterResponse>().import.running).toBe(true);
    release();
    await waitPhotos(call);

    for (const team of [
      () => Promise.resolve(new Response('errore', { status: 500 })),
      () =>
        Promise.resolve(
          new Response('<html><body>Manutenzione</body></html>', { headers: { 'content-type': 'text/html' } }),
        ),
    ]) {
      const failing = await start(site({ team }).fetch);
      await clubOfPerugia(failing);
      const res = await (await caller(failing))({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
      expect(res.statusCode).toBe(502);
    }
  });

  it('stops the photos at the quota of the client and says why', async () => {
    const server = await start(site().fetch, { ASSETS_QUOTA_MB: '1' });
    await clubOfPerugia(server);
    const call = await caller(server);
    const big = await call({
      method: 'POST',
      url: VIDEO_UPLOAD_PATH,
      headers: { 'content-type': 'application/octet-stream' },
      payload: mp4(10, 10, 1024 * 1024 - 2000),
    });
    expect(big.statusCode).toBe(201);
    await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
    const roster = await waitPhotos(call);
    expect(roster.import.lastError).toContain('Spazio per i file esaurito');
    expect(roster.players.every((p) => p.photo === null)).toBe(true);
  });

  it('applies the numbers moved on the site before the new players, also a swap', async () => {
    const server = await start(site().fetch);
    await clubOfPerugia(server);
    // As before: Loser had the 4 (now 8, the 4 goes to the new Henno), Giannelli and Cappadona the 9 and the 6 (swapped).
    const row = (key: string, number: number, lastName: string) => ({
      tenantId: server.tenantId,
      season: 2026,
      number,
      firstName: 'N',
      lastName,
      externalKey: key,
      source: 'league' as const,
    });
    await server.database.db
      .insert(players)
      .values([row('LOS-AGU-97', 4, 'Loser'), row('GIA-SIM-96', 9, 'Giannelli'), row('CAP-STE-05', 6, 'Cappadona')]);
    const call = await caller(server);
    const res = await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json<ImportRosterResponse>()).toMatchObject({ added: 11, updated: 3, skipped: [] });
    const roster = await waitPhotos(call);
    const numberOf = (key: string) => roster.players.find((p) => p.externalKey === key)?.number;
    expect([numberOf('LOS-AGU-97'), numberOf('HEN-MAT-05'), numberOf('GIA-SIM-96'), numberOf('CAP-STE-05')]).toEqual([
      8, 4, 6, 9,
    ]);
    expect(roster.players.every((p) => !p.removed)).toBe(true);
  });

  it('imports the team of the series, also with a cup chosen before it', async () => {
    const fake = site();
    const server = await start(fake.fetch);
    const [cup] = await server.database.db
      .insert(leagues)
      .values({
        provider: 'legavolley',
        externalId: 988,
        season: 2025,
        name: 'Coppa Italia',
        lastStatus: 'ok',
        lastSuccessAt: new Date(),
      })
      .returning();
    if (!cup) throw new Error('no cup');
    const [cupTeam] = await server.database.db
      .insert(leagueTeams)
      .values({ leagueId: cup.id, externalId: 7777, name: 'Squadra della coppa' })
      .returning();
    await server.database.db.insert(tenantLeagues).values({
      tenantId: server.tenantId,
      leagueId: cup.id,
      leagueTeamId: cupTeam?.id ?? null,
      createdAt: new Date('2025-01-01'),
    });
    await clubOfPerugia(server);
    const call = await caller(server);
    const roster = (await call({ url: '/api/admin/roster' })).json<RosterResponse>();
    expect(roster).toMatchObject({ season: 2026, team: { name: 'Sir Susa Scai Perugia' } });
    const res = await call({ method: 'POST', url: '/api/admin/roster/import', payload: {} });
    expect(res.statusCode).toBe(200);
    expect(fake.calls).toContain('/team/6865');
    expect(fake.calls.some((c) => c.startsWith('/team/7777'))).toBe(false);
    await waitPhotos(call);
  });

  it('photos and videos of a player from the library: checked, protected from deletion, on the public page', async () => {
    const server = await start(site().fetch);
    await clubOfPerugia(server);
    const call = await caller(server);
    const added = await call({
      method: 'POST',
      url: '/api/admin/roster/players',
      payload: { number: 4, firstName: 'Mathis', lastName: 'Henno' },
    });
    const id = added.json<Player>().id;
    const image = (
      await call({
        method: 'POST',
        url: '/api/admin/assets',
        payload: { kind: 'player', data: png(30, 40).toString('base64') },
      })
    ).json<AssetSummary>();
    const video = (key: number) =>
      call({
        method: 'POST',
        url: `${VIDEO_UPLOAD_PATH}?kind=player`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: mp4(64, 36, 100 + key),
      });
    const v = await Promise.all([1, 2, 3, 4].map(async (k) => (await video(k)).json<AssetSummary>()));
    expect(v.every((x) => x.kind === 'player')).toBe(true);
    const overlay = (
      await call({
        method: 'POST',
        url: '/api/admin/assets',
        payload: { kind: 'overlay', data: png(31, 40).toString('base64') },
      })
    ).json<AssetSummary>();
    expect(
      (
        await call({
          method: 'POST',
          url: `${VIDEO_UPLOAD_PATH}?kind=logo`,
          headers: { 'content-type': 'application/octet-stream' },
          payload: mp4(64, 36, 999),
        })
      ).statusCode,
    ).toBe(400);

    const put = (payload: unknown) =>
      call({
        method: 'PUT',
        url: `/api/admin/roster/players/${id}/media`,
        payload: payload as Record<string, unknown>,
      });
    const ok = await put({ photoAssetId: image.id, mediaIds: [v[0]?.id, v[1]?.id] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Player>()).toMatchObject({ photo: { assetId: image.id, video: false }, editedFields: ['photo'] });
    expect(ok.json<Player>().media.map((m) => [m.assetId, m.video])).toEqual([
      [v[0]?.id, true],
      [v[1]?.id, true],
    ]);
    for (const bad of [
      { photoAssetId: v[0]?.id, mediaIds: [] },
      { photoAssetId: null, mediaIds: v.map((x) => x.id) },
      { photoAssetId: overlay.id, mediaIds: [] },
      { photoAssetId: '00000000-0000-4000-8000-000000000000', mediaIds: [] },
    ])
      expect((await put(bad)).statusCode).toBe(400);

    const del = await call({ method: 'DELETE', url: `/api/admin/assets/${v[0]?.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json<{ error: string }>().error).toContain('Henno Mathis della rosa');
    expect((await call({ method: 'DELETE', url: `/api/admin/assets/${image.id}` })).statusCode).toBe(409);
    expect((await call({ method: 'DELETE', url: `/api/admin/assets/${v[3]?.id}` })).statusCode).toBe(204);

    const pub = (await server.app.inject({ url: '/api/public/tenant' })).json<PublicTenantResponse>();
    // Only the main photo: the other files are not chosen for an overlay.
    expect(pub.players).toEqual([{ number: 4, photo: image.id, events: {}, images: [], videos: [] }]);
    // Removed from the roster: no longer on the public page.
    await call({ method: 'DELETE', url: `/api/admin/roster/players/${id}` });
    expect((await server.app.inject({ url: '/api/public/tenant' })).json<PublicTenantResponse>().players).toEqual([]);
  });

  it('photo and video of each overlay of a player: its files only, of the right type, kept, protected, public', async () => {
    const server = await start(site().fetch);
    await clubOfPerugia(server);
    const call = await caller(server);
    const added = await call({
      method: 'POST',
      url: '/api/admin/roster/players',
      payload: { number: 4, firstName: 'Mathis', lastName: 'Henno' },
    });
    const id = added.json<Player>().id;
    expect(added.json<Player>().events).toEqual({
      ace: { photoAssetId: null, videoAssetId: null },
      block: { photoAssetId: null, videoAssetId: null },
      substitution: { photoAssetId: null, videoAssetId: null },
    });
    const upload = async (kind: string, w: number) =>
      (
        await call({ method: 'POST', url: '/api/admin/assets', payload: { kind, data: png(w, 40).toString('base64') } })
      ).json<AssetSummary>();
    const main = await upload('player', 30);
    const photo = await upload('player', 32);
    const spare = await upload('player', 34);
    const video = (
      await call({
        method: 'POST',
        url: `${VIDEO_UPLOAD_PATH}?kind=player`,
        headers: { 'content-type': 'application/octet-stream' },
        payload: mp4(64, 36, 501),
      })
    ).json<AssetSummary>();
    const put = (payload: unknown) =>
      call({
        method: 'PUT',
        url: `/api/admin/roster/players/${id}/media`,
        payload: payload as Record<string, unknown>,
      });
    const mediaIds = [photo.id, spare.id, video.id];
    const ok = await put({
      photoAssetId: main.id,
      mediaIds,
      events: { ace: { photoAssetId: photo.id, videoAssetId: video.id }, substitution: { videoAssetId: video.id } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<Player>().events).toEqual({
      ace: { photoAssetId: photo.id, videoAssetId: video.id },
      block: { photoAssetId: null, videoAssetId: null },
      substitution: { photoAssetId: null, videoAssetId: video.id },
    });
    // Wrong type, a file not of the player (also the main photo), a file of another client: refused, nothing changes.
    const other = await createTenant(server, 'altro', ['altro.test']);
    const adminB = { email: 'b@altro.test', password: 'password-altro-1' };
    await createUser(server, adminB, 'admin', other);
    const callB = await caller(server, adminB, 'altro.test');
    const foreign = (
      await callB({
        method: 'POST',
        url: '/api/admin/assets',
        payload: { kind: 'player', data: png(36, 40).toString('base64') },
      })
    ).json<AssetSummary>();
    for (const bad of [
      { photoAssetId: null, mediaIds, events: { ace: { photoAssetId: video.id } } },
      { photoAssetId: null, mediaIds, events: { block: { videoAssetId: photo.id } } },
      { photoAssetId: main.id, mediaIds, events: { ace: { photoAssetId: main.id } } },
      { photoAssetId: null, mediaIds: [photo.id], events: { ace: { photoAssetId: spare.id } } },
      { photoAssetId: null, mediaIds: [...mediaIds, foreign.id], events: { ace: { photoAssetId: foreign.id } } },
      { photoAssetId: null, mediaIds, events: { tie: { photoAssetId: photo.id } } },
    ])
      expect((await put(bad)).statusCode, JSON.stringify(bad.events)).toBe(400);
    // Another client never touches this player.
    expect(
      (
        await callB({
          method: 'PUT',
          url: `/api/admin/roster/players/${id}/media`,
          payload: { photoAssetId: null, mediaIds: [foreign.id], events: { ace: { photoAssetId: foreign.id } } },
        })
      ).statusCode,
    ).toBe(404);

    const pub = () =>
      server.app.inject({ url: '/api/public/tenant' }).then((r) => r.json<PublicTenantResponse>().players);
    expect(await pub()).toEqual([
      {
        number: 4,
        photo: main.id,
        events: { ace: { photo: photo.id, video: video.id }, substitution: { photo: null, video: video.id } },
        images: [photo.id],
        videos: [video.id],
      },
    ]);
    // A page opened before this release (old schema, `images` and `videos` required) still reads the tenant.
    const OldPublicPlayerMedia = z.object({
      number: z.int().min(0).max(99),
      photo: z.uuid().nullable(),
      images: z.array(z.uuid()),
      videos: z.array(z.uuid()),
    });
    expect(z.array(OldPublicPlayerMedia).parse(await pub())).toEqual([
      { number: 4, photo: main.id, images: [photo.id], videos: [video.id] },
    ]);
    // A malformed jsonb of the choices reads as none: no error.
    await server.database.db.update(playerMedia).set({ events: { ace: true } as unknown as string[] });
    expect((await call({ url: '/api/admin/roster' })).statusCode).toBe(200);
    expect(await pub()).toEqual([{ number: 4, photo: main.id, events: {}, images: [], videos: [] }]);
    expect((await call({ method: 'DELETE', url: `/api/admin/assets/${spare.id}` })).statusCode).toBe(409);
    await put({
      photoAssetId: main.id,
      mediaIds,
      events: { ace: { photoAssetId: photo.id, videoAssetId: video.id }, substitution: { videoAssetId: video.id } },
    });

    // In use for an overlay: not deleted, and the reason names the overlay.
    const del = await call({ method: 'DELETE', url: `/api/admin/assets/${video.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json<{ error: string }>().error).toContain('«Ace», «Cambio»');

    // Without `events` the choices of the files that stay are kept; a file taken away takes its choices with it.
    const kept = await put({ photoAssetId: main.id, mediaIds: [spare.id, photo.id] });
    expect(kept.json<Player>().events.ace).toEqual({ photoAssetId: photo.id, videoAssetId: null });
    expect(kept.json<Player>().events.substitution).toEqual({ photoAssetId: null, videoAssetId: null });
    // Back to none: the public page has the main photo only.
    await put({ photoAssetId: main.id, mediaIds: [spare.id, photo.id], events: {} });
    expect(await pub()).toEqual([{ number: 4, photo: main.id, events: {}, images: [], videos: [] }]);
    // No main photo and nothing chosen: not on the public page.
    await put({ photoAssetId: null, mediaIds: [spare.id, photo.id], events: {} });
    expect(await pub()).toEqual([]);
    await put({ photoAssetId: null, mediaIds: [photo.id], events: { block: { photoAssetId: photo.id } } });
    expect(await pub()).toEqual([
      { number: 4, photo: null, events: { block: { photo: photo.id, video: null } }, images: [photo.id], videos: [] },
    ]);
  });
});
