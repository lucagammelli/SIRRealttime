import type { AssetSummary, LayoutResponse, PublicTenantResponse } from '@sir/shared';
import { defaultLayout } from '@sir/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { assignTemplate, createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';
import { png } from './imageFixtures.js';

const HOST_A = 'la.sir.test';
const HOST_B = 'lb.sir.test';
const ADMIN_A = { email: 'layout-a@sir.test', password: 'password-layout-a' };
const VIEWER_A = { email: 'layout-viewer-a@sir.test', password: 'password-layout-v' };
const ADMIN_B = { email: 'layout-b@sir.test', password: 'password-layout-b' };
const MISSING = '00000000-0000-4000-8000-000000000000';

let server: TestServer;
let tenantA: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;

const call = (host: string, cookie: string | null, options: InjectOptions) =>
  server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });

const putLayout = (host: string, cookie: string, payload: unknown) =>
  call(host, cookie, { method: 'PUT', url: '/api/admin/layout', payload: payload as Record<string, unknown> });

const publicLayout = async (host: string) =>
  (await call(host, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>().layout;

const uploadSponsor = async (host: string, cookie: string, w: number) =>
  (
    await call(host, cookie, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'sponsor', data: png(w, 20).toString('base64') },
    })
  ).json<AssetSummary>();

const sponsorLayout = (images: string[]) => ({
  tv: [
    { id: 'tabellone', type: 'scoreboard' },
    { id: 'sp', type: 'sponsor', width: 4, options: { images, seconds: 5 } },
    { id: 'msg', type: 'message', width: 8, options: { text: 'Benvenuti!' } },
  ],
});

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'layout-a', [HOST_A]);
  const tenantB = await createTenant(server, 'layout-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());

describe('layout of the public page', () => {
  it('starts from the default page, in the admin area and in the public graphics', async () => {
    const res = await call(HOST_A, cookieA, { url: '/api/admin/layout' });
    expect(res.statusCode).toBe(200);
    expect(res.json<LayoutResponse>()).toEqual({ tenantName: 'LAYOUT-A', layout: defaultLayout() });
    expect(await publicLayout(HOST_A)).toEqual(defaultLayout());
  });

  it('saves the layout and the public page sees it at once (cache emptied)', async () => {
    const sponsor = await uploadSponsor(HOST_A, cookieA, 120);
    // The client of the hostname is now in the server cache, with the old layout.
    expect((await publicLayout(HOST_A)).tv).toHaveLength(6);
    const res = await putLayout(HOST_A, cookieA, sponsorLayout([sponsor.id]));
    expect(res.statusCode).toBe(200);
    const saved = res.json<LayoutResponse>().layout;
    expect(saved.tv.map((b) => b.type)).toEqual(['scoreboard', 'sponsor', 'message']);
    expect(saved.tablet).toEqual(defaultLayout().tablet);
    const pub = await publicLayout(HOST_A);
    expect(pub.tv[1]).toEqual({
      id: 'sp',
      type: 'sponsor',
      width: 4,
      visible: true,
      collapsed: false,
      options: { images: [sponsor.id], seconds: 5 },
    });
    expect((await call(HOST_A, cookieA, { url: '/api/admin/layout' })).json<LayoutResponse>().layout).toEqual(saved);
  });

  it('refuses unknown block types, bad options and widths, unknown fields', async () => {
    for (const bad of [
      { tv: [{ id: 'x', type: 'iframe' }] },
      { tv: [{ id: 'x', type: 'message', options: { text: '<b>ciao</b>', html: true } }] },
      { tv: [{ id: 'x', type: 'players', width: 3 }] },
      { tv: [{ id: 'x', type: 'sponsor', options: { images: [MISSING], seconds: 1 } }] },
      { tv: [], css: 'body{}' },
      { version: 2 },
    ]) {
      expect((await putLayout(HOST_A, cookieA, bad)).statusCode).toBe(400);
    }
    // A message is plain text: what looks like HTML is stored as text, never interpreted.
    const text = await putLayout(HOST_A, cookieA, { phone: [{ id: 'm', type: 'message', options: { text: '<b>' } }] });
    expect(text.statusCode).toBe(200);
    expect(text.json<LayoutResponse>().layout.phone[0]).toMatchObject({ options: { text: '<b>' } });
  });

  it('refuses a missing image and an image of another client; B never sees the layout of A', async () => {
    const sponsorA = await uploadSponsor(HOST_A, cookieA, 121);
    expect((await putLayout(HOST_A, cookieA, sponsorLayout([MISSING]))).statusCode).toBe(400);
    expect((await putLayout(HOST_B, cookieB, sponsorLayout([sponsorA.id]))).statusCode).toBe(400);
    const sponsorB = await uploadSponsor(HOST_B, cookieB, 122);
    expect((await putLayout(HOST_A, cookieA, sponsorLayout([sponsorA.id, sponsorB.id]))).statusCode).toBe(400);
    expect((await putLayout(HOST_B, cookieB, sponsorLayout([sponsorB.id]))).statusCode).toBe(200);
    expect((await publicLayout(HOST_B)).tv[1]).toMatchObject({ options: { images: [sponsorB.id] } });
    expect((await publicLayout(HOST_A)).tv[1]).not.toMatchObject({ options: { images: [sponsorB.id] } });
    // On the hostname of B the cookie of A still works on A, never on B.
    const onB = await call(HOST_B, cookieA, { url: '/api/admin/layout' });
    expect(onB.json<LayoutResponse>().tenantName).toBe('LAYOUT-A');
  });

  it('keeps an image used by a sponsor block from being deleted', async () => {
    const sponsor = await uploadSponsor(HOST_A, cookieA, 123);
    expect((await putLayout(HOST_A, cookieA, sponsorLayout([sponsor.id]))).statusCode).toBe(200);
    const del = () => call(HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/assets/${sponsor.id}` });
    const refused = await del();
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: string }>().error).toContain('pagina pubblica');
    expect((await putLayout(HOST_A, cookieA, {})).statusCode).toBe(200);
    expect((await del()).statusCode).toBe(204);
  });

  it('is read-only for a viewer; a superadmin works on its active client', async () => {
    expect((await call(HOST_A, cookieViewerA, { url: '/api/admin/layout' })).statusCode).toBe(200);
    expect((await putLayout(HOST_A, cookieViewerA, {})).statusCode).toBe(403);
    expect((await call(HOST_A, null, { url: '/api/admin/layout' })).statusCode).toBe(401);
    const superCookie = await login(server.app, SUPERADMIN, 'console.sir.test');
    const choose = await call('console.sir.test', superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantA },
    });
    expect(choose.statusCode).toBe(200);
    const res = await putLayout('console.sir.test', superCookie, {
      phone: [{ id: 'q', type: 'qr', options: { caption: 'Inquadra il codice' } }],
    });
    expect(res.json<LayoutResponse>().tenantName).toBe('LAYOUT-A');
    expect((await publicLayout(HOST_A)).phone).toEqual([
      { id: 'q', type: 'qr', width: 12, visible: true, collapsed: false, options: { caption: 'Inquadra il codice' } },
    ]);
  });

  it('without a saved page uses the default page of the template of the client', async () => {
    const host = 'lc.sir.test';
    const tenant = await createTenant(server, 'layout-c', [host]);
    const admin = { email: 'layout-c@sir.test', password: 'password-layout-c' };
    await createUser(server, admin, 'admin', tenant);
    const cookie = await login(server.app, admin, host);
    await assignTemplate(server, tenant, 'sir-volley');
    const put = await call(host, cookie, {
      method: 'PUT',
      url: '/api/admin/branding',
      payload: { template: 'sir-volley', ourTeam: { code: 'PER', name: 'Perugia' } },
    });
    expect(put.statusCode).toBe(200);
    expect((await call(host, cookie, { url: '/api/admin/layout' })).json<LayoutResponse>().layout).toEqual(
      defaultLayout('sir-volley'),
    );
    const pub = (await call(host, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>();
    expect(pub.layout).toEqual(defaultLayout('sir-volley'));
    expect(pub.branding.template).toBe('sir-volley');
    expect(pub.branding.ourTeam).toEqual({ code: 'PER', name: 'Perugia' });
    // A device saved by the client wins over the template.
    const saved = await putLayout(host, cookie, {
      ...defaultLayout('sir-volley'),
      phone: [{ id: 's', type: 'scoreboard' }],
    });
    expect(saved.json<LayoutResponse>().layout.phone.map((b) => b.id)).toEqual(['s']);
    expect(saved.json<LayoutResponse>().layout.tablet).toEqual(defaultLayout('sir-volley').tablet);
  });
});
