import type { OverlaysResponse, PublicTenantResponse } from '@arenalive/shared';
import { defaultOverlays } from '@arenalive/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';

const HOST_A = 'oa.sir.test';
const HOST_B = 'ob.sir.test';
const ADMIN_A = { email: 'avvisi-a@sir.test', password: 'password-avvisi-a' };
const VIEWER_A = { email: 'avvisi-viewer-a@sir.test', password: 'password-avvisi-v' };
const ADMIN_B = { email: 'avvisi-b@sir.test', password: 'password-avvisi-b' };
const URL = '/api/admin/overlays';

let server: TestServer;
let tenantA: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;

const call = (host: string, cookie: string | null, options: InjectOptions) =>
  server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });

const putOverlays = (host: string, cookie: string, payload: unknown) =>
  call(host, cookie, { method: 'PUT', url: URL, payload: payload as Record<string, unknown> });

const publicOverlays = async (host: string) =>
  (await call(host, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>().overlays;

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'avvisi-a', [HOST_A]);
  const tenantB = await createTenant(server, 'avvisi-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());

describe('overlays of the public page', () => {
  it('starts from the defaults, in the admin area and in the public graphics', async () => {
    const res = await call(HOST_A, cookieA, { url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json<OverlaysResponse>()).toEqual({ tenantName: 'AVVISI-A', overlays: defaultOverlays() });
    expect(await publicOverlays(HOST_A)).toEqual(defaultOverlays());
  });

  it('saves the overlays and the public page sees them at once (cache emptied)', async () => {
    expect((await publicOverlays(HOST_A)).ace.enabled).toBe(true);
    const res = await putOverlays(HOST_A, cookieA, {
      ace: { enabled: false },
      matchPoint: { text: 'Match point per {squadra} ({punteggio})', seconds: 7, priority: 10 },
      block: { devices: { phone: false } },
    });
    expect(res.statusCode).toBe(200);
    const saved = res.json<OverlaysResponse>().overlays;
    expect(saved.ace.enabled).toBe(false);
    expect(saved.matchPoint).toMatchObject({
      text: 'Match point per {squadra} ({punteggio})',
      seconds: 7,
      priority: 10,
    });
    expect(saved.block.devices).toEqual({ tv: true, tablet: true, phone: false });
    expect(saved.run).toEqual(defaultOverlays().run);
    expect(await publicOverlays(HOST_A)).toEqual(saved);
    expect((await call(HOST_A, cookieA, { url: URL })).json<OverlaysResponse>().overlays).toEqual(saved);
  });

  it('refuses unknown placeholders, HTML, bad durations, priorities and devices, unknown fields', async () => {
    for (const bad of [
      { ace: { text: 'ACE {nome}' } },
      { ace: { text: '<b>ACE</b>' } },
      { ace: { text: 'ACE {giocatore' } },
      { ace: { text: '' } },
      { ace: { seconds: 1 } },
      { ace: { seconds: 9 } },
      { ace: { priority: 0 } },
      { ace: { devices: { watch: true } } },
      { ace: { html: true } },
      { goal: {} },
      { version: 2 },
    ]) {
      expect((await putOverlays(HOST_A, cookieA, bad)).statusCode).toBe(400);
    }
  });

  it('keeps the clients apart: B never sees nor changes the overlays of A', async () => {
    expect((await putOverlays(HOST_B, cookieB, { tie: { enabled: false } })).statusCode).toBe(200);
    expect((await publicOverlays(HOST_B)).tie.enabled).toBe(false);
    expect((await publicOverlays(HOST_A)).tie.enabled).toBe(true);
    expect((await publicOverlays(HOST_B)).ace.enabled).toBe(true);
    // On the hostname of B the cookie of A still works on A, never on B.
    expect((await call(HOST_B, cookieA, { url: URL })).json<OverlaysResponse>().tenantName).toBe('AVVISI-A');
  });

  it('is read-only for a viewer; a superadmin works on its active client', async () => {
    expect((await call(HOST_A, cookieViewerA, { url: URL })).statusCode).toBe(200);
    expect((await putOverlays(HOST_A, cookieViewerA, {})).statusCode).toBe(403);
    expect((await call(HOST_A, null, { url: URL })).statusCode).toBe(401);
    expect((await putOverlays(HOST_A, '', {})).statusCode).toBe(401);
    const superCookie = await login(server.app, SUPERADMIN, 'console.sir.test');
    const choose = await call('console.sir.test', superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantA },
    });
    expect(choose.statusCode).toBe(200);
    const res = await putOverlays('console.sir.test', superCookie, { run: { seconds: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json<OverlaysResponse>().tenantName).toBe('AVVISI-A');
    expect((await publicOverlays(HOST_A)).run.seconds).toBe(3);
    expect((await publicOverlays(HOST_B)).run.seconds).toBe(4);
  });
});
