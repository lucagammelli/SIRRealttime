import { generateMatch } from '@arenalive/dvw-simulator';
import type { AgentQuotaResponse, AgentSummary, CreateRegistrationResponse, TenantSummary } from '@arenalive/shared';
import {
  AGENT_EXPIRED_ERROR,
  CreateRegistrationResponseSchema,
  RegistrationStatusResponseSchema,
} from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { agentRegistrations, agents, tenants } from '../src/db/index.js';
import type { TestServer } from './helpers.js';
import {
  ADMIN,
  createTenant,
  createUser,
  fileAt,
  ingest,
  login,
  requestFor,
  startServer,
  SUPERADMIN,
  VIEWER,
} from './helpers.js';

const HOST_B = 'quota-b.test';
const ADMIN_B = { email: 'admin-quota-b@sir.test', password: 'password-admin-qb' };
const BASE_TIME = new Date('2026-10-15T10:00:00.000Z');
const DAY_MS = 86_400_000;

let server: TestServer;
let cookie: string;
let cookieB: string;
let viewerCookie: string;
let superCookie: string;
let tenantB: string;

const call = (options: InjectOptions, who: string | null = cookie, host?: string) =>
  server.app.inject({
    ...options,
    headers: { ...(who ? { cookie: who } : {}), ...(host ? { host } : {}), ...options.headers },
  });

async function register(host?: string): Promise<CreateRegistrationResponse> {
  const res = await call(
    { method: 'POST', url: '/api/agents/registrations', payload: { name: 'PC scout' } },
    null,
    host,
  );
  expect(res.statusCode).toBe(201);
  return CreateRegistrationResponseSchema.parse(res.json());
}

const approve = (id: string, payload: Record<string, unknown> = {}, who = cookie, host?: string) =>
  call({ method: 'POST', url: `/api/admin/agent-registrations/${id}/approve`, payload }, who, host);

/** The token of an approved request, collected as the agent does. */
async function collect(secret: string, host?: string): Promise<string> {
  const res = await call(
    {
      method: 'POST',
      url: '/api/agents/registrations/status',
      headers: { authorization: `Bearer ${secret}` },
      payload: {},
    },
    null,
    host,
  );
  const body = RegistrationStatusResponseSchema.parse(res.json());
  if (body.status !== 'approved') throw new Error(`not approved: ${body.status}`);
  return body.token;
}

const setQuota = (tenantId: string, quota: number) =>
  server.database.db.update(tenants).set({ agentQuota: quota }).where(eq(tenants.id, tenantId));

let seq = 0;
async function send(token: string): Promise<{ status: number; error: string | null }> {
  const match = generateMatch({ seed: 3 });
  seq++;
  const res = await ingest(server.app, token, await requestFor('quota-match', seq, [], fileAt(match, 10)));
  return { status: res.statusCode, error: res.statusCode === 200 ? null : res.json<{ error: string }>().error };
}

beforeAll(async () => {
  server = await startServer();
  server.setNow(BASE_TIME);
  cookie = await login(server.app, ADMIN);
  viewerCookie = await login(server.app, VIEWER);
  superCookie = await login(server.app, SUPERADMIN);
  tenantB = await createTenant(server, 'quota-b', [HOST_B]);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());
beforeEach(async () => {
  server.setNow(BASE_TIME);
  cookie = await login(server.app, ADMIN);
  await server.database.db.delete(agentRegistrations);
  await server.database.db.delete(agents);
  await setQuota(server.tenantId, 1);
  await setQuota(tenantB, 1);
});

describe('quota of agents of a client', () => {
  it('refuses to enable a registration past the quota, with a clear message, also through the API', async () => {
    const first = await register();
    expect((await approve(first.registrationId)).statusCode).toBe(200);
    const quota = (await call({ url: '/api/admin/agent-quota' })).json<AgentQuotaResponse>();
    expect(quota).toEqual({ quota: 1, used: 1 });
    const second = await register();
    const refused = await approve(second.registrationId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: string }>().error).toContain('Limite di agenti raggiunto');
    // A token created by hand counts the same.
    const manual = await call({ method: 'POST', url: '/api/admin/agents', payload: { name: 'a mano' } });
    expect(manual.statusCode).toBe(409);
    // The approved request becomes the agent and keeps its place.
    await collect(first.secret);
    expect((await call({ url: '/api/admin/agent-quota' })).json<AgentQuotaResponse>()).toEqual({ quota: 1, used: 1 });
    expect((await approve(second.registrationId)).statusCode).toBe(409);
  });

  it('counts each client on its own: another client with a free place enables its own agent', async () => {
    const mine = await register();
    expect((await approve(mine.registrationId)).statusCode).toBe(200);
    const theirs = await register(HOST_B);
    expect((await approve(theirs.registrationId, {}, cookieB, HOST_B)).statusCode).toBe(200);
    // Neither admin sees or decides the request of the other client.
    const other = await register(HOST_B);
    expect((await approve(other.registrationId)).statusCode).toBe(404);
  });

  it('is set by the superadmin only; a revoked or expired agent frees its place', async () => {
    const tenantsList = (await call({ url: '/api/admin/tenants' }, superCookie)).json<TenantSummary[]>();
    expect(tenantsList.find((t) => t.id === server.tenantId)?.agentQuota).toBe(1);
    const denied = await call({
      method: 'PATCH',
      url: `/api/admin/tenants/${server.tenantId}`,
      payload: { agentQuota: 5 },
    });
    expect(denied.statusCode).toBe(403);
    const raised = await call(
      { method: 'PATCH', url: `/api/admin/tenants/${server.tenantId}`, payload: { agentQuota: 2 } },
      superCookie,
    );
    expect(raised.json<TenantSummary>().agentQuota).toBe(2);
    const a = (await call({ method: 'POST', url: '/api/admin/agents', payload: { name: 'a' } })).json<AgentSummary>();
    const b = await call({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { name: 'b' },
    });
    expect(b.statusCode).toBe(201);
    expect((await call({ method: 'POST', url: '/api/admin/agents', payload: { name: 'c' } })).statusCode).toBe(409);
    expect((await call({ method: 'DELETE', url: `/api/admin/agents/${a.id}` })).statusCode).toBe(204);
    expect((await call({ method: 'POST', url: '/api/admin/agents', payload: { name: 'c' } })).statusCode).toBe(201);
    const created = await call(
      { method: 'POST', url: '/api/admin/tenants', payload: { slug: 'nuovo-q', name: 'Nuovo', hostnames: [] } },
      superCookie,
    );
    expect(created.json<TenantSummary>().agentQuota).toBe(1);
  });
});

describe('validity of the registration of an agent', () => {
  it('approves «Senza scadenza» or «Fino al», never in the past', async () => {
    const req = await register();
    const past = await approve(req.registrationId, { expiresAt: new Date(BASE_TIME.getTime() - 1000).toISOString() });
    expect(past.statusCode).toBe(400);
    const bad = await approve(req.registrationId, { expiresAt: 'domani' });
    expect(bad.statusCode).toBe(400);
    const until = new Date(BASE_TIME.getTime() + 10 * DAY_MS).toISOString();
    expect((await approve(req.registrationId, { expiresAt: until })).statusCode).toBe(200);
    await collect(req.secret);
    const list = (await call({ url: '/api/admin/agents' })).json<AgentSummary[]>();
    expect(list).toEqual([expect.objectContaining({ expiresAt: until, revoked: false })]);
  });

  it('answers 401 with «Registrazione scaduta» to an expired agent; prolong and revoke from «Agenti»', async () => {
    await setQuota(server.tenantId, 3);
    const req = await register();
    const until = new Date(BASE_TIME.getTime() + 2 * DAY_MS);
    await approve(req.registrationId, { expiresAt: until.toISOString() });
    const token = await collect(req.secret);
    expect((await send(token)).status).toBe(200);
    server.setNow(new Date(until.getTime() + 1000));
    // The sessions of the morning have expired meanwhile.
    cookie = await login(server.app, ADMIN);
    viewerCookie = await login(server.app, VIEWER);
    cookieB = await login(server.app, ADMIN_B, HOST_B);
    expect(await send(token)).toEqual({ status: 401, error: AGENT_EXPIRED_ERROR });
    // The expired agent no longer takes a place.
    expect((await call({ url: '/api/admin/agent-quota' })).json<AgentQuotaResponse>().used).toBe(0);
    const [agent] = (await call({ url: '/api/admin/agents' })).json<AgentSummary[]>();
    if (!agent) throw new Error('agent missing');
    // A viewer cannot prolong; the admin can, not into the past.
    const patch = (payload: Record<string, unknown>, who = cookie) =>
      call({ method: 'PATCH', url: `/api/admin/agents/${agent.id}`, payload }, who);
    expect((await patch({ expiresAt: null }, viewerCookie)).statusCode).toBe(403);
    expect((await patch({ expiresAt: BASE_TIME.toISOString() })).statusCode).toBe(400);
    const prolonged = await patch({ expiresAt: null });
    expect(prolonged.json<AgentSummary>().expiresAt).toBeNull();
    expect((await send(token)).status).toBe(200);
    // Another client cannot touch it; after the revocation the plain 401.
    expect(
      (await call({ method: 'PATCH', url: `/api/admin/agents/${agent.id}`, payload: {} }, cookieB, HOST_B)).statusCode,
    ).toBe(404);
    expect((await call({ method: 'DELETE', url: `/api/admin/agents/${agent.id}` })).statusCode).toBe(204);
    expect(await send(token)).toEqual({ status: 401, error: 'Non autorizzato' });
    expect((await patch({ expiresAt: null })).statusCode).toBe(404);
  });

  it('gives back the place only if the quota allows it when an expired agent is prolonged', async () => {
    const req = await register();
    await approve(req.registrationId, { expiresAt: new Date(BASE_TIME.getTime() + DAY_MS).toISOString() });
    await collect(req.secret);
    server.setNow(new Date(BASE_TIME.getTime() + 2 * DAY_MS));
    cookie = await login(server.app, ADMIN);
    // Its place is free: another agent takes it.
    expect((await call({ method: 'POST', url: '/api/admin/agents', payload: { name: 'nuovo' } })).statusCode).toBe(201);
    const expired = (await call({ url: '/api/admin/agents' })).json<AgentSummary[]>().find((a) => a.expiresAt !== null);
    if (!expired) throw new Error('expired agent missing');
    const res = await call({ method: 'PATCH', url: `/api/admin/agents/${expired.id}`, payload: { expiresAt: null } });
    expect(res.statusCode).toBe(409);
  });
});
