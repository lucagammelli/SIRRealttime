import { createHash } from 'node:crypto';
import type { LeagueDetailResponse, LeagueListResponse, LeagueSummary } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fixtures, leagues, leagueTeams, teamLogos } from '../src/db/index.js';
import type { FetchLike } from '../src/leagues/fetcher.js';
import { LeagueFetcher } from '../src/leagues/fetcher.js';
import { dueSyncs, LeagueScheduler } from '../src/leagues/scheduler.js';
import { LeagueService, teamNameKey } from '../src/leagues/sync.js';
import type { TestServer } from './helpers.js';
import { ADMIN, login, startServer, SUPERADMIN } from './helpers.js';
import { fixture, logoBytes, placeholderLogoBytes } from './leagueFixtures.js';

/** Team of the season 2025/26 whose logo the fake site serves broken, and one without logo (placeholder). */
const BROKEN_LOGO_TEAM = 6713;
const NO_LOGO_TEAM = 6704;

/** www.legavolley.it as seen on 2026-10-16 for the SuperLega 2025/26 (IdCampionato 974), from the saved pages. */
function fakeSite() {
  const pages = new Map<string, () => Response>([
    // Without IdFase the site shows its current phase (Ritorno, the last one of the season).
    ['/calendario/?Anno=2025&IdCampionato=974', () => html(fixture('calendario-974-2025-ritorno.html'))],
    [
      '/calendario/?Anno=2025&IdCampionato=974&IdFase=1&IdSquadra=0',
      () => html(fixture('calendario-974-2025-andata.html')),
    ],
    [
      '/calendario/?Anno=2025&IdCampionato=974&IdFase=2&IdSquadra=0',
      () => html(fixture('calendario-974-2025-ritorno.html')),
    ],
    ['/classifica/?Anno=2025&IdCampionato=974', () => html(fixture('classifica-974-2025.html'))],
    // IdCampionato 999 is the SuperLega 2026/27: asked as 2025 the site still shows 2026.
    ['/calendario/?Anno=2025&IdCampionato=999', () => html(fixture('calendario-999-2026-andata.html'))],
  ]);
  const calls: string[] = [];
  let gate: Promise<void> | null = null;
  const notModified = { count: 0 };
  /** Answer with an ETag of its content; 304 when the request already has it. */
  const conditional = async (init: RequestInit, response: Response): Promise<Response> => {
    if (response.status !== 200) return response;
    const body = Buffer.from(await response.arrayBuffer());
    const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;
    if ((init.headers as Record<string, string>)['if-none-match'] === etag) {
      notModified.count++;
      return new Response(null, { status: 304, headers: { etag } });
    }
    const headers = new Headers(response.headers);
    headers.set('etag', etag);
    return new Response(body, { status: 200, headers });
  };
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (gate) await gate;
    const page = pages.get(u.pathname + u.search);
    if (page) return conditional(init, page());
    if (/^\/team\/\d+$/.test(u.pathname)) return conditional(init, html(fixture('squadra-6865.html')));
    if (u.pathname === '/GetLogo.aspx') {
      const key = u.searchParams.get('Key');
      const bytes =
        key === String(BROKEN_LOGO_TEAM)
          ? Buffer.from('<html>non è un logo</html>')
          : key === String(NO_LOGO_TEAM)
            ? placeholderLogoBytes()
            : logoBytes();
      return conditional(
        init,
        new Response(bytes, {
          headers: { 'content-type': 'image/png' },
        }),
      );
    }
    return new Response('non trovato', { status: 404 });
  };
  return {
    fetch,
    pages,
    calls,
    notModified,
    hold(): () => void {
      let open: () => void = () => undefined;
      gate = new Promise<void>((resolve) => {
        open = () => {
          gate = null;
          resolve();
        };
      });
      return open;
    },
  };
}

const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=UTF-8' } });

let site: ReturnType<typeof fakeSite>;
let server: TestServer;
let superCookie: string;
let adminCookie: string;

const call = (options: InjectOptions, cookie: string | null = superCookie) =>
  server.app.inject({ ...options, headers: { ...(cookie ? { cookie } : {}), ...options.headers } });

const create = (payload: Record<string, unknown>, cookie: string | null = superCookie) =>
  call({ method: 'POST', url: '/api/admin/leagues', payload }, cookie);

const startSync = (id: string) => call({ method: 'POST', url: `/api/admin/leagues/${id}/sync`, payload: {} });

const detail = async (id: string): Promise<LeagueDetailResponse> =>
  (await call({ url: `/api/admin/leagues/${id}` })).json<LeagueDetailResponse>();

/** Waits for the end of the background update of a championship. */
async function settled(id: string): Promise<LeagueDetailResponse> {
  for (let k = 0; k < 500; k++) {
    const d = await detail(id);
    if (!d.league.sync.running) return d;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('update never ended');
}

async function syncNow(id: string): Promise<LeagueDetailResponse> {
  const res = await startSync(id);
  expect(res.statusCode).toBe(202);
  return settled(id);
}

beforeAll(async () => {
  site = fakeSite();
  server = await startServer({}, {}, { leagueFetcher: { fetch: site.fetch } });
  superCookie = await login(server.app, SUPERADMIN);
  adminCookie = await login(server.app, ADMIN);
});
afterAll(() => server.close());
afterEach(() => {
  site.calls.length = 0;
  site.notModified.count = 0;
});

describe('permissions and validation', () => {
  it('is for the superadmin only', async () => {
    expect((await call({ url: '/api/admin/leagues' }, null)).statusCode).toBe(401);
    expect((await call({ url: '/api/admin/leagues' }, adminCookie)).statusCode).toBe(403);
    expect((await create({ provider: 'legavolley', externalId: 1, season: 2025 }, adminCookie)).statusCode).toBe(403);
    const res = await call({ url: '/api/admin/leagues' });
    expect(res.statusCode).toBe(200);
    expect(res.json<LeagueListResponse>()).toEqual({ leagues: [] });
  });

  it('validates provider, IdCampionato and season', async () => {
    for (const bad of [
      { provider: 'fipav', externalId: 974, season: 2025 },
      { provider: 'legavolley', externalId: -1, season: 2025 },
      { provider: 'legavolley', externalId: 974.5, season: 2025 },
      { provider: 'legavolley', externalId: 974, season: 1900 },
      { provider: 'legavolley', externalId: 974, season: 2025, url: 'https://evil.test' },
    ])
      expect((await create(bad)).statusCode).toBe(400);
    expect((await call({ url: '/api/admin/leagues/non-uuid' })).statusCode).toBe(400);
    expect((await call({ url: '/api/admin/leagues/00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });
});

describe('update of a championship', () => {
  let leagueId: string;

  it('adds a championship (once)', async () => {
    const res = await create({ provider: 'legavolley', externalId: 974, season: 2025 });
    expect(res.statusCode).toBe(201);
    const league = res.json<LeagueSummary>();
    expect(league).toMatchObject({
      externalId: 974,
      season: 2025,
      name: null,
      teamCount: 0,
      sync: { status: 'never', running: false },
    });
    leagueId = league.id;
    expect((await create({ provider: 'legavolley', externalId: 974, season: 2025 })).statusCode).toBe(409);
  });

  it('downloads calendar, standings, teams and logos', async () => {
    const d = await syncNow(leagueId);
    expect(d.league).toMatchObject({
      name: 'Regular Season SuperLega Credem Banca',
      phases: [
        { id: 1, name: 'Andata' },
        { id: 2, name: 'Ritorno' },
      ],
      teamCount: 12,
      fixtureCount: 132,
      sync: {
        status: 'ok',
        message: 'Aggiornato con avvisi: 1 loghi non validi o non scaricati, 1 loghi assenti sul sito',
        running: false,
      },
    });
    expect(new Set(d.fixtures.map((f) => `${f.phase} ${f.roundLabel}`)).size).toBe(22);
    expect(d.standings).toHaveLength(12);
    const perugia = d.teams.find((t) => t.externalId === 6710);
    expect(perugia).toMatchObject({ name: 'Sir Susa Scai Perugia', venue: 'Pala Barton Energy', city: 'Perugia (PG)' });
    expect(d.standings[0]).toMatchObject({ position: 1, teamId: perugia?.id, points: 58, setRatio: 3.15 });
    expect(d.standings.every((s) => s.teamId !== null)).toBe(true);
    expect(d.fixtures.find((f) => f.number === 67)).toMatchObject({
      home: { teamId: perugia?.id, name: 'Sir Susa Scai Perugia' },
      status: 'played',
      result: { homeSets: 3, awaySets: 1, sets: null },
      startsAt: '2025-11-26T19:30:00.000Z',
    });
    // The broken logo and the placeholder are not stored; the others are one file (the fake site serves one image).
    expect(d.teams.filter((t) => t.logoUrl !== null)).toHaveLength(10);
    expect(d.teams.find((t) => t.externalId === BROKEN_LOGO_TEAM)?.logoUrl).toBeNull();
    expect(d.teams.find((t) => t.externalId === NO_LOGO_TEAM)?.logoUrl).toBeNull();
    expect(await server.database.db.select().from(teamLogos)).toHaveLength(1);
    // Default page (phases), the other phase, standings, 12 team pages, 12 logos: nothing else, only allowed paths.
    expect(site.calls).toHaveLength(27);
    expect(site.calls.every((c) => /^\/(calendario|classifica|team|GetLogo\.aspx)/.test(c))).toBe(true);
  });

  it('serves the logo with a fixed type, nosniff and a long cache', async () => {
    const d = await detail(leagueId);
    const url = d.teams.find((t) => t.logoUrl)?.logoUrl ?? '';
    const res = await server.app.inject({ url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.rawPayload.equals(logoBytes())).toBe(true);
    expect(
      (await server.app.inject({ url: '/api/public/team-logos/00000000-0000-4000-8000-000000000000' })).statusCode,
    ).toBe(404);
    expect((await server.app.inject({ url: '/api/public/team-logos/..%2F..%2Fetc' })).statusCode).toBe(404);
  });

  it('is idempotent: same rows, unchanged matches untouched, team pages not downloaded again', async () => {
    const before = await server.database.db.select().from(fixtures).where(eq(fixtures.leagueId, leagueId));
    const d = await syncNow(leagueId);
    expect(d.league).toMatchObject({ teamCount: 12, fixtureCount: 132, sync: { status: 'ok' } });
    const after = await server.database.db.select().from(fixtures).where(eq(fixtures.leagueId, leagueId));
    expect(after.map((f) => [f.id, f.updatedAt.getTime()]).sort()).toEqual(
      before.map((f) => [f.id, f.updatedAt.getTime()]).sort(),
    );
    // Both phases by IdFase, then the standings: andata and standings answered 304 to the saved ETag (the ritorno
    // came first from the page without IdFase, whose ETag is not kept).
    expect(site.notModified.count).toBe(2);
    expect(site.calls).toEqual([
      '/calendario/?Anno=2025&IdCampionato=974&IdFase=1&IdSquadra=0',
      '/calendario/?Anno=2025&IdCampionato=974&IdFase=2&IdSquadra=0',
      '/classifica/?Anno=2025&IdCampionato=974',
    ]);
  });

  it('keeps the good data when a page changes format, and says why', async () => {
    const good = site.pages.get('/calendario/?Anno=2025&IdCampionato=974&IdFase=2&IdSquadra=0');
    site.pages.set('/calendario/?Anno=2025&IdCampionato=974&IdFase=2&IdSquadra=0', () =>
      html(fixture('calendario-974-2025-ritorno.html').replaceAll('<th>Ospite</th>', '<th>Trasferta</th>')),
    );
    try {
      const d = await syncNow(leagueId);
      expect(d.league.sync).toMatchObject({
        status: 'error',
        message: expect.stringContaining('colonne attese') as string,
      });
      expect(d.league.sync.lastSuccessAt).not.toBeNull();
      expect(d.fixtures).toHaveLength(132);
      expect(d.standings).toHaveLength(12);
    } finally {
      if (good) site.pages.set('/calendario/?Anno=2025&IdCampionato=974&IdFase=2&IdSquadra=0', good);
    }
  });

  it('keeps the good data when the site is unreachable', async () => {
    const good = site.pages.get('/classifica/?Anno=2025&IdCampionato=974');
    site.pages.set('/classifica/?Anno=2025&IdCampionato=974', () => new Response('errore', { status: 500 }));
    try {
      const d = await syncNow(leagueId);
      expect(d.league.sync).toMatchObject({ status: 'error', message: 'Il sito ha risposto 500' });
      expect(d.standings).toHaveLength(12);
    } finally {
      if (good) site.pages.set('/classifica/?Anno=2025&IdCampionato=974', good);
    }
    expect((await syncNow(leagueId)).league.sync).toMatchObject({ status: 'ok' });
  });

  it('runs one update at a time per championship (409 while one is running)', async () => {
    const open = site.hold();
    try {
      expect((await startSync(leagueId)).statusCode).toBe(202);
      const second = await startSync(leagueId);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: 'Aggiornamento già in corso' });
    } finally {
      open();
    }
    await settled(leagueId);
  });

  it('downloads team pages and logos again after a week', async () => {
    server.setNow(new Date(Date.now() + 8 * 24 * 3_600_000));
    try {
      // The session of the test has expired by then (and the login removes it): a new one, valid from now on.
      superCookie = await login(server.app, SUPERADMIN);
      await syncNow(leagueId);
      expect(site.calls.filter((c) => c.startsWith('/team/'))).toHaveLength(12);
      expect(site.calls.filter((c) => c.startsWith('/GetLogo.aspx'))).toHaveLength(12);
    } finally {
      server.setNow(null);
    }
  });

  it('refuses a page of another season or championship', async () => {
    const res = await create({ provider: 'legavolley', externalId: 999, season: 2025 });
    const id = res.json<LeagueSummary>().id;
    const d = await syncNow(id);
    expect(d.league.sync).toMatchObject({
      status: 'error',
      message: expect.stringContaining('stagione 2026/2027') as string,
    });
    expect(d.league.sync.message).toMatch(/controlla IdCampionato e stagione/);
    expect(d.fixtures).toHaveLength(0);
    const [row] = await server.database.db.select().from(leagues).where(eq(leagues.id, id));
    expect(row?.syncStartedAt).toBeNull();
  });
});

describe('lease and failures of the teams (service used directly)', () => {
  let own: TestServer;
  let clock: Date;
  let leagueId: string;
  /** Called at every request of the fake site, before the answer. */
  let onCall: (n: number) => Promise<void> = () => Promise.resolve();
  let calls = 0;

  const service = (assetsDir = own.assetsDir) => {
    const local = fakeSite();
    return new LeagueService({
      db: own.database.db,
      fetcher: new LeagueFetcher({
        userAgent: 'SIRRealtime/test',
        minIntervalMs: 0,
        fetch: async (url, init) => {
          await onCall(++calls);
          return local.fetch(url, init);
        },
      }),
      assetsDir,
      now: () => clock,
      log: own.app.log,
    });
  };
  const row = async () => (await own.database.db.select().from(leagues).where(eq(leagues.id, leagueId)))[0];

  beforeAll(async () => {
    own = await startServer();
    const [l] = await own.database.db
      .insert(leagues)
      .values({ provider: 'legavolley', externalId: 974, season: 2025 })
      .returning({ id: leagues.id });
    if (!l) throw new Error('league not inserted');
    leagueId = l.id;
  });
  afterAll(() => own.close());
  afterEach(() => {
    onCall = () => Promise.resolve();
    calls = 0;
  });

  it('gives a warning, not an error, when teams fail unexpectedly after calendar and standings are stored', async () => {
    clock = new Date('2026-10-16T10:00:00Z');
    // ASSETS_DIR is a file: writing a logo fails with an error of the file system.
    const result = await service(new URL('./leagueFixtures.ts', import.meta.url).pathname).syncLeague(leagueId);
    expect(result).toEqual({
      status: 'ok',
      message: 'Aggiornato con avvisi: squadre e loghi non aggiornati (errore interno)',
    });
    expect(await row()).toMatchObject({ lastStatus: 'ok', syncStartedAt: null });
    expect((await own.database.db.select().from(fixtures).where(eq(fixtures.leagueId, leagueId))).length).toBe(132);
  });

  it('renews the lease during a long update', async () => {
    clock = new Date('2026-10-20T10:00:00Z');
    const seen: (Date | null)[] = [];
    onCall = async (n) => {
      if (n === 1) clock = new Date(clock.getTime() + 5 * 60_000);
      if (n === 3) seen.push((await row())?.syncStartedAt ?? null);
    };
    expect(await service().syncLeague(leagueId)).toMatchObject({ status: 'ok' });
    expect(seen[0]?.toISOString()).toBe('2026-10-20T10:05:00.000Z');
    expect(await row()).toMatchObject({ syncStartedAt: null, lastStatus: 'ok' });
  });

  it('leaves alone a lease taken over by another process', async () => {
    clock = new Date('2026-10-21T10:00:00Z');
    const other = new Date('2026-10-21T10:20:00Z');
    const before = await row();
    onCall = async (n) => {
      if (n !== 1) return;
      // The other process took over (as with a lease older than 15 minutes) and the clock moved on.
      await own.database.db.update(leagues).set({ syncStartedAt: other }).where(eq(leagues.id, leagueId));
      clock = new Date('2026-10-21T10:21:00Z');
    };
    expect(await service().syncLeague(leagueId)).toEqual({
      status: 'error',
      message: 'Aggiornamento ripreso da un altro processo',
    });
    const after = await row();
    expect(after?.syncStartedAt?.toISOString()).toBe(other.toISOString());
    expect(after?.lastSyncAt?.getTime()).toBe(before?.lastSyncAt?.getTime());
  });
});

describe('rate limit of «Aggiorna ora»', () => {
  it('answers 429 past the limit', async () => {
    const limited = await startServer({ leagueSync: 2 }, {}, { leagueFetcher: { fetch: site.fetch } });
    try {
      const cookie = await login(limited.app, SUPERADMIN);
      const created = await limited.app.inject({
        method: 'POST',
        url: '/api/admin/leagues',
        headers: { cookie },
        payload: { provider: 'legavolley', externalId: 974, season: 2025 },
      });
      const id = created.json<LeagueSummary>().id;
      const codes: number[] = [];
      for (let k = 0; k < 3; k++) {
        const res = await limited.app.inject({
          method: 'POST',
          url: `/api/admin/leagues/${id}/sync`,
          headers: { cookie },
          payload: {},
        });
        codes.push(res.statusCode);
      }
      expect(codes[2]).toBe(429);
      expect(codes.slice(0, 2).every((c) => c === 202 || c === 409)).toBe(true);
    } finally {
      await limited.close();
    }
  });
});

describe('scheduler', () => {
  const at = (iso: string) => new Date(iso);

  it('updates every championship once a night after 04:00 (Rome)', () => {
    const night = at('2026-10-16T02:30:00Z'); // 04:30 in Rome
    expect(dueSyncs(night, [{ id: 'a', lastSyncAt: null, matchToday: false }])).toEqual([
      { id: 'a', standings: 'always' },
    ]);
    expect(dueSyncs(night, [{ id: 'a', lastSyncAt: at('2026-10-16T02:05:00Z'), matchToday: false }])).toEqual([]);
    expect(dueSyncs(at('2026-10-16T01:30:00Z'), [{ id: 'a', lastSyncAt: null, matchToday: false }])).toEqual([]);
  });

  it('updates every 10 minutes a championship with a match today, standings only after a new result', () => {
    const now = at('2026-10-17T17:00:00Z');
    const last = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
    expect(dueSyncs(now, [{ id: 'a', lastSyncAt: last(11), matchToday: true }])).toEqual([
      { id: 'a', standings: 'ifChanged' },
    ]);
    expect(dueSyncs(now, [{ id: 'a', lastSyncAt: last(5), matchToday: true }])).toEqual([]);
    expect(dueSyncs(now, [{ id: 'a', lastSyncAt: last(11), matchToday: false }])).toEqual([]);
  });

  it('finds the championships with a match today and runs their updates one after the other', async () => {
    const [league] = await server.database.db
      .select({ id: leagues.id })
      .from(leagues)
      .where(eq(leagues.externalId, 974));
    if (!league) throw new Error('league missing');
    const [match] = await server.database.db
      .select({ startsAt: fixtures.startsAt })
      .from(fixtures)
      .where(eq(fixtures.externalId, 'n67'));
    const startsAt = match?.startsAt ?? new Date();
    const syncLeague = vi.fn<LeagueService['syncLeague']>(() => Promise.resolve({ status: 'ok', message: null }));
    const scheduler = new LeagueScheduler({
      db: server.database.db,
      leagues: { syncLeague } as unknown as LeagueService,
      // Two hours before the match (Rome day of the match), long after the update of the tests.
      now: () => new Date(startsAt.getTime() - 2 * 3_600_000),
      log: server.app.log,
    });
    await server.database.db
      .update(leagues)
      .set({ lastSyncAt: new Date(startsAt.getTime() - 3 * 3_600_000) })
      .where(eq(leagues.id, league.id));
    await scheduler.tick();
    expect(syncLeague).toHaveBeenCalledWith(league.id, { standings: 'ifChanged' });
    await scheduler.stop();
  });
});

describe('helpers of the update', () => {
  it('compares team names ignoring case, accents and punctuation', () => {
    expect(teamNameKey("Acqua Sant'Anna  Cuneo")).toBe(teamNameKey('acqua sant anna cuneo'));
    expect(teamNameKey('Città')).toBe('citta');
  });

  it('stores the teams of a championship once', async () => {
    const rows = await server.database.db.select().from(leagueTeams);
    expect(new Set(rows.map((r) => `${r.leagueId}:${r.externalId}`)).size).toBe(rows.length);
  });
});
