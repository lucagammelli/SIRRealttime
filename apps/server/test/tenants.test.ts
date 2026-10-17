import { generateMatch } from '@sir/dvw-simulator';
import type {
  AgentRegistrationSummary,
  AgentSummary,
  CreateShareTokenResponse,
  MatchSummary,
  MeResponse,
  PublicTenantResponse,
  ServerMessage,
  ShareTokenSummary,
  TenantSummary,
  UserSummary,
} from '@sir/shared';
import {
  CreateRegistrationResponseSchema,
  DEFAULT_BRAND_NAME,
  RegistrationStatusResponseSchema,
  TENANT_REQUIRED_MESSAGE,
} from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { agents, matches } from '../src/db/index.js';
import { hostnameFromHeader, publicBaseUrlFor } from '../src/tenancy.js';
import type { TestServer } from './helpers.js';
import {
  ADMIN,
  createAgent,
  createTenant,
  createUser,
  fileAt,
  ingest,
  login,
  ORIGIN,
  requestFor,
  startServer,
  SUPERADMIN,
} from './helpers.js';

const HOST_A = 'a.sir.test';
const HOST_B = 'b.sir.test';
const ADMIN_A = { email: 'admin-a@sir.test', password: 'password-admin-a' };
const VIEWER_A = { email: 'viewer-a@sir.test', password: 'password-viewer-a' };
const ADMIN_B = { email: 'admin-b@sir.test', password: 'password-admin-b' };

let server: TestServer;
let tenantA: string;
let tenantB: string;
let agentA: string;
let agentB: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;
const sentLines = new Map<string, { lines: string[]; seq: number }>();

/** Request on the hostname `host` with the session `cookie`. */
function call(host: string, cookie: string | null, options: InjectOptions) {
  return server.app.inject({
    ...options,
    headers: { host, ...(cookie ? { cookie } : {}), ...options.headers },
  });
}

/** Sends the simulated match `matchKey` with the agent `token`; returns nothing (ids are read from the DB). */
async function send(token: string, matchKey: string, seed: number, upTo: number): Promise<void> {
  const key = `${token}:${matchKey}`;
  const prev = sentLines.get(key) ?? { lines: [], seq: 0 };
  const file = fileAt(generateMatch({ seed }), upTo);
  const res = await ingest(server.app, token, await requestFor(matchKey, prev.seq, prev.lines, file));
  expect(res.json()).toMatchObject({ status: 'ok' });
  sentLines.set(key, { lines: file.scoutLines, seq: prev.seq + 1 });
}

async function matchId(tenantId: string, matchKey: string): Promise<string> {
  const rows = await server.database.db.select().from(matches).where(eq(matches.tenantId, tenantId));
  const row = rows.find((m) => m.matchKey === matchKey);
  if (!row) throw new Error(`match ${matchKey} missing`);
  return row.id;
}

async function shareOn(host: string, cookie: string, id: string | null): Promise<CreateShareTokenResponse> {
  const res = await call(host, cookie, {
    method: 'POST',
    url: '/api/admin/share-tokens',
    payload: { label: 'Tribuna', matchId: id, expiresAt: null },
  });
  expect(res.statusCode).toBe(201);
  return res.json<CreateShareTokenResponse>();
}

/** WebSocket through `injectWS`, collecting its messages from the very first one. */
function openSocket(path: string, headers: Record<string, string>, messages: ServerMessage[]): Promise<WebSocket> {
  return server.app.injectWS(
    path,
    { headers },
    {
      onInit: (ws) => {
        ws.on('message', (data: Buffer) => messages.push(JSON.parse(data.toString()) as ServerMessage));
      },
    },
  );
}

async function agentIdOf(tenantId: string): Promise<string> {
  const [row] = await server.database.db.select({ id: agents.id }).from(agents).where(eq(agents.tenantId, tenantId));
  if (!row) throw new Error('agent missing');
  return row.id;
}

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'club-a', [HOST_A]);
  tenantB = await createTenant(server, 'club-b', [HOST_B, 'live.b.test']);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  agentA = await createAgent(server, false, tenantA);
  agentB = await createAgent(server, false, tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
  // Same match key for both clients: two separate matches.
  await send(agentA, 'gara', 1, 40);
  await send(agentB, 'gara', 2, 30);
  await send(agentB, 'solo-b', 3, 20);
});
afterAll(() => server.close());

describe('hostname resolution', () => {
  it('reads the Host header without port, in lower case, ignoring invalid values', () => {
    expect(hostnameFromHeader('A.Sir.Test:8443')).toBe('a.sir.test');
    expect(hostnameFromHeader('a.sir.test.')).toBe('a.sir.test');
    expect(hostnameFromHeader('localhost')).toBe('localhost');
    expect(hostnameFromHeader('192.168.1.10:8080')).toBe('192.168.1.10');
    for (const bad of [undefined, '', '[::1]:8090', 'a.sir.test:http', 'a_b.test', 'a.sir.test/x']) {
      expect(hostnameFromHeader(bad)).toBeNull();
    }
  });

  /** Name of the client of the hostname, as the public pages see it. */
  const publicName = async (host: string) =>
    (await call(host, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>().name;

  it('uses the client of a known hostname, also with upper case and port', async () => {
    for (const host of [HOST_A, 'A.Sir.Test', `${HOST_A}:8080`]) expect(await publicName(host)).toBe('CLUB-A');
    expect(await publicName('live.b.test')).toBe('CLUB-B');
  });

  it('uses the default client for an unknown hostname', async () => {
    expect(await publicName('sconosciuto.test')).toBe(DEFAULT_BRAND_NAME);
  });

  it('answers 404 to an unknown hostname when DEFAULT_TENANT_SLUG is empty', async () => {
    const strict = await startServer({}, { DEFAULT_TENANT_SLUG: '' });
    try {
      const tenant = await createTenant(strict, 'club-a', [HOST_A]);
      const token = await createAgent(strict, false, tenant);
      await ingest(strict.app, token, await requestFor('g', 0, [], fileAt(generateMatch({ seed: 1 }), 10)));
      const adminA = { email: 'x@sir.test', password: 'password-x-12345' };
      await createUser(strict, adminA, 'admin', tenant);
      const cookie = await login(strict.app, adminA, HOST_A);
      const link = await strict.app.inject({
        method: 'POST',
        url: '/api/admin/share-tokens',
        headers: { host: HOST_A, cookie },
        payload: { label: 'x', matchId: null, expiresAt: null },
      });
      const { token: shareToken } = link.json<CreateShareTokenResponse>();
      const known = await strict.app.inject({ url: `/api/public/${shareToken}/state`, headers: { host: HOST_A } });
      expect(known.statusCode).toBe(200);
      const unknown = await strict.app.inject({ url: `/api/public/${shareToken}/state`, headers: { host: 'x.test' } });
      expect(unknown.statusCode).toBe(404);
      const register = await strict.app.inject({
        method: 'POST',
        url: '/api/agents/registrations',
        headers: { host: 'x.test' },
        payload: { name: 'pc' },
      });
      expect(register.statusCode).toBe(404);
      // ADMIN of «Predefinito» logs in from a hostname without client too, and works on its own client.
      const allowed = await strict.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { host: 'x.test' },
        payload: ADMIN,
      });
      expect(allowed.statusCode).toBe(200);
      expect(allowed.json<MeResponse>().tenant?.slug).toBe('predefinito');
    } finally {
      await strict.close();
    }
  });

  it('builds the public URL on a hostname of the client', () => {
    expect(publicBaseUrlFor('https://portale.it', [])).toBe('https://portale.it');
    expect(publicBaseUrlFor('https://portale.it', ['x.it', 'portale.it'])).toBe('https://portale.it');
    expect(publicBaseUrlFor('https://portale.it', ['live.club.it'])).toBe('https://live.club.it');
    expect(publicBaseUrlFor('http://localhost:8080', ['sir-a.local'])).toBe('http://sir-a.local:8080');
  });
});

describe('sessions and clients', () => {
  it('logs in a user of a client from any hostname, always on its own client', async () => {
    for (const host of [HOST_B, '192.168.104.102', 'sconosciuto.test']) {
      const res = await call(host, null, { method: 'POST', url: '/api/auth/login', payload: ADMIN_A });
      expect(res.statusCode).toBe(200);
      expect(res.json<MeResponse>().tenant).toMatchObject({ id: tenantA, slug: 'club-a' });
    }
    // A wrong password keeps the same answer on every hostname (nothing tells whether the account exists).
    const wrong = await call(HOST_B, null, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { ...ADMIN_A, password: 'password-sbagliata' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'Credenziali non valide' });
  });

  it('keeps the session of a client on its own client on the hostname of another', async () => {
    const onB = await call(HOST_B, cookieA, { url: '/api/admin/agents' });
    expect(onB.statusCode).toBe(200);
    expect(onB.json<AgentSummary[]>().map((a) => a.id)).toEqual([await agentIdOf(tenantA)]);
    const matchesOnB = (await call(HOST_B, cookieA, { url: '/api/admin/matches' })).json<MatchSummary[]>();
    expect(matchesOnB.map((m) => m.matchKey)).toEqual(['gara']);
    const idB = await matchId(tenantB, 'gara');
    expect((await call(HOST_B, cookieA, { url: `/api/admin/matches/${idB}` })).statusCode).toBe(404);
    expect((await call(HOST_B, cookieA, { url: '/api/admin/tenants' })).statusCode).toBe(403);
    const me = await call(HOST_B, cookieA, { url: '/api/auth/me' });
    expect(me.json<MeResponse>().tenant?.id).toBe(tenantA);
  });

  it('tells the user its client', async () => {
    const me = await call(HOST_A, cookieA, { url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ role: 'admin', tenant: { id: tenantA, slug: 'club-a', name: 'CLUB-A' } });
  });
});

describe('isolation of the admin routes', () => {
  it('lists only the matches of the client and hides the others even by id', async () => {
    const listA = (await call(HOST_A, cookieA, { url: '/api/admin/matches' })).json<MatchSummary[]>();
    expect(listA.map((m) => m.matchKey)).toEqual(['gara']);
    const idB = await matchId(tenantB, 'gara');
    expect((await call(HOST_A, cookieA, { url: `/api/admin/matches/${idB}` })).statusCode).toBe(404);
    expect((await call(HOST_A, cookieViewerA, { url: `/api/admin/matches/${idB}` })).statusCode).toBe(404);
    expect((await call(HOST_B, cookieB, { url: `/api/admin/matches/${idB}` })).statusCode).toBe(200);
  });

  it('keeps one live match per client', async () => {
    const live = await server.database.db.select().from(matches).where(eq(matches.live, true));
    expect(live.map((m) => m.tenantId).sort()).toEqual([tenantA, tenantB].sort());
  });

  it('never lists or revokes the agents of another client', async () => {
    const list = (await call(HOST_A, cookieA, { url: '/api/admin/agents' })).json<AgentSummary[]>();
    const idB = await agentIdOf(tenantB);
    expect(list.map((a) => a.id)).toEqual([await agentIdOf(tenantA)]);
    const revoke = await call(HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/agents/${idB}` });
    expect(revoke.statusCode).toBe(404);
    // The agent of B still works.
    await send(agentB, 'solo-b', 3, 25);
  });

  it('creates agents in the client of the session', async () => {
    const res = await call(HOST_A, cookieA, { method: 'POST', url: '/api/admin/agents', payload: { name: 'pc-a2' } });
    expect(res.statusCode).toBe(201);
    const [row] = await server.database.db.select().from(agents).where(eq(agents.name, 'pc-a2'));
    expect(row?.tenantId).toBe(tenantA);
  });

  it('never creates links to, lists or revokes the links of another client', async () => {
    const idB = await matchId(tenantB, 'gara');
    const cross = await call(HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/share-tokens',
      payload: { label: 'x', matchId: idB, expiresAt: null },
    });
    expect(cross.statusCode).toBe(400);
    const linkB = await shareOn(HOST_B, cookieB, idB);
    const listA = (await call(HOST_A, cookieA, { url: '/api/admin/share-tokens' })).json<ShareTokenSummary[]>();
    expect(listA.some((l) => l.id === linkB.id)).toBe(false);
    const revoke = await call(HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/share-tokens/${linkB.id}` });
    expect(revoke.statusCode).toBe(404);
    const still = await call(HOST_B, null, { url: `/api/public/${linkB.token}/state` });
    expect(still.statusCode).toBe(200);
  });

  it('gives links on a hostname of the client', async () => {
    const link = await shareOn(HOST_B, cookieB, null);
    expect(link.url).toBe(`http://${HOST_B}/live/${link.token}`);
  });

  it('never shows, approves or rejects the agent registrations of another client', async () => {
    const created = await call(HOST_B, null, {
      method: 'POST',
      url: '/api/agents/registrations',
      payload: { name: 'pc-b' },
    });
    expect(created.statusCode).toBe(201);
    const reg = CreateRegistrationResponseSchema.parse(created.json());
    const listA = (await call(HOST_A, cookieA, { url: '/api/admin/agent-registrations' })).json<
      AgentRegistrationSummary[]
    >();
    expect(listA).toEqual([]);
    for (const action of ['approve', 'reject']) {
      const res = await call(HOST_A, cookieA, {
        method: 'POST',
        url: `/api/admin/agent-registrations/${reg.registrationId}/${action}`,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    }
    const listB = (await call(HOST_B, cookieB, { url: '/api/admin/agent-registrations' })).json<
      AgentRegistrationSummary[]
    >();
    expect(listB.map((r) => r.id)).toEqual([reg.registrationId]);
    const approved = await call(HOST_B, cookieB, {
      method: 'POST',
      url: `/api/admin/agent-registrations/${reg.registrationId}/approve`,
      payload: {},
    });
    expect(approved.statusCode).toBe(200);
    const status = await server.app.inject({
      method: 'POST',
      url: '/api/agents/registrations/status',
      headers: { authorization: `Bearer ${reg.secret}` },
      payload: {},
    });
    const answer = RegistrationStatusResponseSchema.parse(status.json());
    if (answer.status !== 'approved') throw new Error('not approved');
    const [row] = await server.database.db.select().from(agents).where(eq(agents.id, answer.agentId));
    expect(row?.tenantId).toBe(tenantB);
    // The new agent writes in B.
    await send(answer.token, 'da-registrazione', 4, 10);
    await matchId(tenantB, 'da-registrazione');
  });

  it('lists and creates only the users of the client', async () => {
    const created = await call(HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/users',
      payload: { email: 'nuovo-a@sir.test', password: 'password-nuova-a', role: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    const listA = (await call(HOST_A, cookieA, { url: '/api/admin/users' })).json<UserSummary[]>();
    expect(listA.map((u) => u.email).sort()).toEqual([ADMIN_A.email, 'nuovo-a@sir.test', VIEWER_A.email].sort());
    const listB = (await call(HOST_B, cookieB, { url: '/api/admin/users' })).json<UserSummary[]>();
    expect(listB.map((u) => u.email)).toEqual([ADMIN_B.email]);
    const login = await call(HOST_A, null, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nuovo-a@sir.test', password: 'password-nuova-a' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses the clients pages and the client selector to a normal admin', async () => {
    expect((await call(HOST_A, cookieA, { url: '/api/admin/tenants' })).statusCode).toBe(403);
    const select = await call(HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantB },
    });
    expect(select.statusCode).toBe(403);
    const listA = (await call(HOST_A, cookieA, { url: '/api/admin/matches' })).json<MatchSummary[]>();
    expect(listA.map((m) => m.matchKey)).toEqual(['gara']);
  });
});

describe('isolation of the public routes', () => {
  it('serves a link only on the hostnames of its client', async () => {
    const link = await shareOn(HOST_A, cookieA, null);
    const onA = await call(HOST_A, null, { url: `/api/public/${link.token}/state` });
    expect(onA.json()).toMatchObject({ type: 'state', matchId: await matchId(tenantA, 'gara') });
    expect((await call(HOST_B, null, { url: `/api/public/${link.token}/state` })).statusCode).toBe(404);
    expect((await call('altro.test', null, { url: `/api/public/${link.token}/state` })).statusCode).toBe(404);
  });

  it('follows the live match of its own client only, also over WebSocket', async () => {
    const linkA = await shareOn(HOST_A, cookieA, null);
    const linkB = await shareOn(HOST_B, cookieB, null);
    const idA = await matchId(tenantA, 'gara');
    const messages: ServerMessage[] = [];
    const ws = await openSocket(`/ws/public/${linkA.token}`, { host: HOST_A }, messages);
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toMatchObject({ type: 'state', matchId: idA });
    // New live match of B: nothing reaches A, by HTTP or WebSocket.
    await send(agentB, 'nuova-b', 5, 15);
    const idNewB = await matchId(tenantB, 'nuova-b');
    const onB = await call(HOST_B, null, { url: `/api/public/${linkB.token}/state` });
    expect(onB.json()).toMatchObject({ matchId: idNewB });
    const onA = await call(HOST_A, null, { url: `/api/public/${linkA.token}/state` });
    expect(onA.json()).toMatchObject({ matchId: idA });
    await send(agentA, 'gara', 1, 45);
    await expect.poll(() => messages.length).toBe(2);
    // The update of A arrives as a patch of the state it already has, or in full.
    expect(messages.map((m) => (m.type === 'state' || m.type === 'patch' ? m.matchId : null))).toEqual([idA, idA]);
    ws.terminate();
  });

  it('refuses the WebSocket of a link on the hostname of another client', async () => {
    const linkA = await shareOn(HOST_A, cookieA, null);
    await expect(server.app.injectWS(`/ws/public/${linkA.token}`, { headers: { host: HOST_B } })).rejects.toThrow(
      /404/,
    );
  });

  it('gives the admin WebSocket the live match of the client of the session', async () => {
    const messages: ServerMessage[] = [];
    const ws = await openSocket('/ws/admin', { host: HOST_A, cookie: cookieA }, messages);
    await expect.poll(() => messages.length).toBe(1);
    expect(messages[0]).toMatchObject({ matchId: await matchId(tenantA, 'gara') });
    await send(agentB, 'nuova-b', 5, 20);
    await send(agentA, 'gara', 1, 50);
    await expect.poll(() => messages.length).toBe(2);
    expect(messages[1]).toMatchObject({ matchId: await matchId(tenantA, 'gara') });
    ws.terminate();
  });
});

describe('origin of the browser requests', () => {
  const post = (host: string, origin: string) =>
    call(host, cookieA, { method: 'POST', url: '/api/admin/agents', headers: { origin }, payload: { name: 'pc' } });

  it('accepts the hostnames of the client of the request and CORS_ORIGIN', async () => {
    expect((await post(HOST_A, `https://${HOST_A}`)).statusCode).toBe(201);
    expect((await post(HOST_A, `http://${HOST_A}:8080`)).statusCode).toBe(201);
    expect((await post(HOST_A, ORIGIN)).statusCode).toBe(201);
  });

  it('refuses the hostnames of another client and foreign origins', async () => {
    expect((await post(HOST_A, `https://${HOST_B}`)).statusCode).toBe(403);
    expect((await post(HOST_A, 'https://evil.test')).statusCode).toBe(403);
    expect((await post(HOST_A, 'null')).statusCode).toBe(403);
    const ws = server.app.injectWS('/ws/admin', {
      headers: { host: HOST_A, cookie: cookieA, origin: `https://${HOST_B}` },
    });
    await expect(ws).rejects.toThrow(/403/);
  });
});

describe('superadmin', () => {
  let superCookie: string;

  beforeAll(async () => {
    superCookie = await login(server.app, SUPERADMIN, HOST_A);
  });

  it('lists, creates and updates the clients', async () => {
    const list = (await call(HOST_A, superCookie, { url: '/api/admin/tenants' })).json<TenantSummary[]>();
    expect(list.map((t) => t.slug).sort()).toEqual(['club-a', 'club-b', 'predefinito']);
    const created = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/tenants',
      payload: { slug: 'club-c', name: 'Club C', hostnames: ['C.Sir.Test'] },
    });
    expect(created.statusCode).toBe(201);
    const c = created.json<TenantSummary>();
    expect(c).toMatchObject({ slug: 'club-c', name: 'Club C', hostnames: ['c.sir.test'] });
    const updated = await call(HOST_A, superCookie, {
      method: 'PATCH',
      url: `/api/admin/tenants/${c.id}`,
      payload: { name: 'Club C nuovo', hostnames: ['c.sir.test', 'c2.sir.test'] },
    });
    expect(updated.json()).toMatchObject({ name: 'Club C nuovo', hostnames: ['c.sir.test', 'c2.sir.test'] });
    // The hostname never chooses the client of the superadmin.
    const me = await call('c2.sir.test', superCookie, { url: '/api/auth/me' });
    expect(me.json<MeResponse>().tenant).toBeNull();
  });

  it('refuses duplicate slugs and hostnames of another client', async () => {
    const slug = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/tenants',
      payload: { slug: 'club-a', name: 'Doppio', hostnames: [] },
    });
    expect(slug.statusCode).toBe(409);
    const host = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/tenants',
      payload: { slug: 'club-d', name: 'D', hostnames: [HOST_B] },
    });
    expect(host.statusCode).toBe(409);
    expect(host.json()).toEqual({ error: 'Hostname già usato da un altro cliente' });
    const patch = await call(HOST_A, superCookie, {
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantA}`,
      payload: { hostnames: [HOST_A, 'live.b.test'] },
    });
    expect(patch.statusCode).toBe(409);
    // Its own hostnames again: fine.
    const same = await call(HOST_A, superCookie, {
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantA}`,
      payload: { hostnames: [HOST_A] },
    });
    expect(same.statusCode).toBe(200);
    const bad = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/tenants',
      payload: { slug: 'club-e', name: 'E', hostnames: ['https://e.test:443'] },
    });
    expect(bad.statusCode).toBe(400);
    const missing = await call(HOST_A, superCookie, {
      method: 'PATCH',
      url: '/api/admin/tenants/3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c',
      payload: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('enters a client explicitly and leaves it, never working on the client of the hostname', async () => {
    const keys = async () =>
      (await call(HOST_A, superCookie, { url: '/api/admin/matches' }))
        .json<MatchSummary[]>()
        .map((m) => m.matchKey)
        .sort();
    expect((await call(HOST_A, superCookie, { url: '/api/admin/matches' })).statusCode).toBe(409);
    const select = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantB },
    });
    expect(select.json<MeResponse>().tenant).toMatchObject({ id: tenantB, slug: 'club-b' });
    expect(await keys()).toEqual(['da-registrazione', 'gara', 'nuova-b', 'solo-b']);
    const user = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/users',
      payload: { email: 'secondo-b@sir.test', password: 'password-secondo-b', role: 'admin' },
    });
    expect(user.statusCode).toBe(201);
    const listB = (await call(HOST_B, cookieB, { url: '/api/admin/users' })).json<UserSummary[]>();
    expect(listB.map((u) => u.email)).toContain('secondo-b@sir.test');
    const unknown = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c' },
    });
    expect(unknown.statusCode).toBe(404);
    const back = await call(HOST_A, superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: null },
    });
    expect(back.json<MeResponse>().tenant).toBeNull();
    expect((await call(HOST_A, superCookie, { url: '/api/admin/matches' })).statusCode).toBe(409);
    // Entered from one hostname, the client is the same on every other.
    await call(HOST_B, superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantA },
    });
    expect(await keys()).toEqual(['gara']);
    await call(HOST_A, superCookie, { method: 'POST', url: '/api/admin/active-tenant', payload: { tenantId: null } });
  });

  it('asks to choose a client on every route with data of a client, on any hostname', async () => {
    const cookie = await login(server.app, SUPERADMIN, HOST_B);
    const me = await call(HOST_B, cookie, { url: '/api/auth/me' });
    expect(me.json<MeResponse>().tenant).toBeNull();
    for (const url of [
      '/api/admin/matches',
      '/api/admin/agents',
      '/api/admin/agent-quota',
      '/api/admin/agent-registrations',
      '/api/admin/agent/info',
      '/api/admin/share-tokens',
      '/api/admin/users',
      '/api/admin/club',
      '/api/admin/calendar',
      '/api/admin/simulation',
      '/api/admin/branding',
      '/api/admin/layout',
      '/api/admin/intermissions',
      '/api/admin/overlays',
      '/api/admin/assets',
    ]) {
      const res = await call(HOST_B, cookie, { url });
      expect({ url, status: res.statusCode, body: res.json<unknown>() }).toEqual({
        url,
        status: 409,
        body: { error: TENANT_REQUIRED_MESSAGE },
      });
    }
    const create = await call(HOST_B, cookie, { method: 'POST', url: '/api/admin/agents', payload: { name: 'pc' } });
    expect(create.statusCode).toBe(409);
    // The pages of the superadmin work without a client.
    expect((await call(HOST_B, cookie, { url: '/api/admin/tenants' })).statusCode).toBe(200);
    expect((await call(HOST_B, cookie, { url: '/api/admin/leagues' })).statusCode).toBe(200);
    // The admin WebSocket has no live match to follow: closed.
    const ws = await server.app.injectWS('/ws/admin', { headers: { host: HOST_B, cookie } });
    const code = await new Promise<number>((resolve) => ws.on('close', (c: number) => resolve(c)));
    expect(code).toBe(1008);
  });
});
