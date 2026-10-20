import type {
  AssetListResponse,
  AssetSummary,
  GraphicsExport,
  LayoutResponse,
  PublicTenantResponse,
  Sponsor,
  SponsorListResponse,
} from '@arenalive/shared';
import { publicAssetPath, SPONSOR_IMAGES_MAX } from '@arenalive/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer } from './helpers.js';
import { png } from './imageFixtures.js';

const HOST_A = 'sp-a.sir.test';
const HOST_B = 'sp-b.sir.test';
const ADMIN_A = { email: 'admin-sp-a@sir.test', password: 'password-admin-a' };
const VIEWER_A = { email: 'viewer-sp-a@sir.test', password: 'password-viewer-a' };
const ADMIN_B = { email: 'admin-sp-b@sir.test', password: 'password-admin-b' };

let server: TestServer;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;

const call = (host: string, cookie: string | null, options: InjectOptions) =>
  server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });

const list = async (host = HOST_A, cookie = cookieA): Promise<Sponsor[]> =>
  (await call(host, cookie, { url: '/api/admin/sponsors' })).json<SponsorListResponse>().sponsors;

const create = (payload: Record<string, unknown>, host = HOST_A, cookie = cookieA) =>
  call(host, cookie, { method: 'POST', url: '/api/admin/sponsors', payload });

const upload = (width: number, extra: Record<string, unknown> = {}, host = HOST_A, cookie = cookieA) =>
  call(host, cookie, {
    method: 'POST',
    url: '/api/admin/assets',
    payload: { kind: 'sponsor', data: png(width, width).toString('base64'), ...extra },
  });

const sponsorBlock = (sponsors: string[], images: string[] = []) => ({
  tv: [
    { id: 'tabellone', type: 'scoreboard' },
    { id: 'sp', type: 'sponsor', width: 4, options: { sponsors, images, seconds: 5 } },
  ],
});

const putLayout = (payload: unknown, host = HOST_A, cookie = cookieA) =>
  call(host, cookie, { method: 'PUT', url: '/api/admin/layout', payload: payload as Record<string, unknown> });

const putPauses = (sponsors: string[], host = HOST_A, cookie = cookieA) =>
  call(host, cookie, {
    method: 'PUT',
    url: '/api/admin/intermissions',
    payload: {
      setBreakBySet: {
        '2': { slides: [{ id: 'sp', type: 'sponsor', seconds: 6, options: { sponsors, seconds: 4 } }] },
      },
    },
  });

const assetsOf = async (host = HOST_A, cookie = cookieA): Promise<AssetSummary[]> =>
  (await call(host, cookie, { url: '/api/admin/assets' })).json<AssetListResponse>().assets;

beforeAll(async () => {
  server = await startServer();
  const tenantA = await createTenant(server, 'sp-a', [HOST_A]);
  const tenantB = await createTenant(server, 'sp-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());

describe('sponsors of a client', () => {
  it('creates, changes and orders the sponsors; a viewer only reads', async () => {
    expect((await create({ name: 'Bar Centrale' }, HOST_A, cookieViewerA)).statusCode).toBe(403);
    // Normalized before the CHECK of the database (scheme in lower case): never a 500.
    const first = await create({ name: 'Bar Centrale', website: 'HTTPS://Bar.Example.IT' });
    expect(first.statusCode).toBe(201);
    expect(first.json<Sponsor>()).toMatchObject({
      name: 'Bar Centrale',
      website: 'https://bar.example.it/',
      position: 0,
      imageIds: [],
    });
    const second = (await create({ name: 'Autofficina' })).json<Sponsor>();
    expect(second).toMatchObject({ website: null, position: 1 });
    expect((await create({ name: 'Bar Centrale' })).statusCode).toBe(409);
    for (const website of ['http://bar.example.it', 'javascript:alert(1)', 'https://user:pw@bar.example.it'])
      expect((await create({ name: 'Altro', website })).statusCode).toBe(400);
    expect((await create({ name: '' })).statusCode).toBe(400);

    const patched = await call(HOST_A, cookieA, {
      method: 'PATCH',
      url: `/api/admin/sponsors/${second.id}`,
      payload: { name: 'Autofficina Rossi', website: 'https://rossi.example.it' },
    });
    expect(patched.json<Sponsor>()).toMatchObject({ name: 'Autofficina Rossi', website: 'https://rossi.example.it/' });
    const taken = await call(HOST_A, cookieA, {
      method: 'PATCH',
      url: `/api/admin/sponsors/${second.id}`,
      payload: { name: 'Bar Centrale' },
    });
    expect(taken.statusCode).toBe(409);

    const ids = (await list()).map((s) => s.id);
    const order = (ids: string[]) =>
      call(HOST_A, cookieA, { method: 'PUT', url: '/api/admin/sponsors/order', payload: { ids } });
    expect((await order([...ids].reverse())).json<SponsorListResponse>().sponsors.map((s) => s.name)).toEqual([
      'Autofficina Rossi',
      'Bar Centrale',
    ]);
    expect((await order(ids.slice(0, 1))).statusCode).toBe(400);
    expect((await list(HOST_A, cookieViewerA)).map((s) => s.name)).toEqual(['Autofficina Rossi', 'Bar Centrale']);
  });

  it('keeps the sponsors of the clients apart', async () => {
    const [sponsor] = await list();
    if (!sponsor) throw new Error('missing');
    expect(await list(HOST_B, cookieB)).toEqual([]);
    const url = `/api/admin/sponsors/${sponsor.id}`;
    expect((await call(HOST_B, cookieB, { method: 'PATCH', url, payload: { name: 'X' } })).statusCode).toBe(404);
    expect((await call(HOST_B, cookieB, { method: 'DELETE', url })).statusCode).toBe(404);
    expect((await upload(30, { sponsorId: sponsor.id }, HOST_B, cookieB)).statusCode).toBe(400);
    expect((await putLayout(sponsorBlock([sponsor.id]), HOST_B, cookieB)).statusCode).toBe(400);
    expect((await putPauses([sponsor.id], HOST_B, cookieB)).statusCode).toBe(400);
    // A sponsor of the same name in another client is fine.
    expect((await create({ name: sponsor.name }, HOST_B, cookieB)).statusCode).toBe(201);
  });

  it('gives images to a sponsor at the upload and later, only sponsor images', async () => {
    const [rossi, bar] = await list();
    if (!rossi || !bar) throw new Error('missing');
    const a = await upload(40, { sponsorId: rossi.id });
    expect(a.statusCode).toBe(201);
    expect(a.json<AssetSummary>().sponsorId).toBe(rossi.id);
    const b = (await upload(41, { sponsorId: rossi.id })).json<AssetSummary>();
    expect((await list()).find((s) => s.id === rossi.id)?.imageIds).toEqual([a.json<AssetSummary>().id, b.id]);
    // The same file for another sponsor: it is already of the first one.
    expect((await upload(41, { sponsorId: bar.id })).statusCode).toBe(409);
    const logo = await call(HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'logo', data: png(42, 42).toString('base64'), sponsorId: bar.id },
    });
    expect(logo.statusCode).toBe(400);

    const loose = (await upload(43)).json<AssetSummary>();
    expect(loose.sponsorId).toBeNull();
    const assign = (sponsorId: string | null, id = loose.id) =>
      call(HOST_A, cookieA, { method: 'PATCH', url: `/api/admin/assets/${id}`, payload: { sponsorId } });
    expect((await assign(bar.id)).json<AssetSummary>().sponsorId).toBe(bar.id);
    expect((await assets()).find((x) => x.id === loose.id)?.sponsorId).toBe(bar.id);
    expect((await assign(null)).json<AssetSummary>().sponsorId).toBeNull();
    expect((await assign(bar.id)).statusCode).toBe(200);
    const bLogo = (
      await call(HOST_B, cookieB, {
        method: 'POST',
        url: '/api/admin/assets',
        payload: { kind: 'logo', data: png(44, 44).toString('base64') },
      })
    ).json<AssetSummary>();
    // An image of another client is not found; a sponsor of another client is not accepted.
    expect((await assign(bar.id, bLogo.id)).statusCode).toBe(404);
    const bSponsor = (await list(HOST_B, cookieB))[0];
    expect((await assign(bSponsor?.id ?? null)).statusCode).toBe(400);
  });

  it(`refuses more than ${SPONSOR_IMAGES_MAX} images for one sponsor`, async () => {
    const full = (await create({ name: 'Pieno' })).json<Sponsor>();
    for (let i = 0; i < SPONSOR_IMAGES_MAX; i++)
      expect((await upload(60 + i, { sponsorId: full.id })).statusCode).toBe(201);
    expect((await upload(90, { sponsorId: full.id })).statusCode).toBe(409);
    const del = await call(HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/sponsors/${full.id}` });
    expect(del.statusCode).toBe(204);
  });

  it('shows on the public page only the sponsors chosen, in the order of the list, with their images', async () => {
    const [rossi, bar] = await list();
    if (!rossi || !bar) throw new Error('missing');
    expect((await putLayout(sponsorBlock([bar.id]))).statusCode).toBe(200);
    expect((await putPauses([rossi.id])).statusCode).toBe(200);
    const pub = (await call(HOST_A, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>();
    expect(pub.sponsors).toEqual([
      { id: rossi.id, name: rossi.name, website: rossi.website, images: rossi.imageIds.map(publicAssetPath) },
      { id: bar.id, name: bar.name, website: bar.website, images: bar.imageIds.map(publicAssetPath) },
    ]);
    const layout = (await call(HOST_A, cookieA, { url: '/api/admin/layout' })).json<LayoutResponse>().layout;
    expect(layout.tv[1]).toMatchObject({ options: { sponsors: [bar.id], images: [] } });
    // Another client sees none of them.
    expect((await call(HOST_B, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>().sponsors).toEqual([]);
  });

  it('deletes a sponsor only when not chosen, with its images not used elsewhere', async () => {
    const [rossi, bar] = await list();
    if (!rossi || !bar) throw new Error('missing');
    const del = (id: string) => call(HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/sponsors/${id}` });
    expect((await del(bar.id)).statusCode).toBe(409);
    expect((await del(rossi.id)).statusCode).toBe(409);
    // Rossi leaves the pauses; one of its images stays on the page as a single image.
    const [kept, gone] = rossi.imageIds;
    if (!kept || !gone) throw new Error('missing images');
    expect((await putPauses([])).statusCode).toBe(200);
    expect((await putLayout(sponsorBlock([bar.id], [kept]))).statusCode).toBe(200);
    expect((await del(rossi.id)).statusCode).toBe(204);
    const left = await assetsOf();
    expect(left.find((a) => a.id === kept)).toMatchObject({ sponsorId: null });
    expect(left.some((a) => a.id === gone)).toBe(false);
    expect((await list()).map((s) => s.name)).toEqual(['Bar Centrale']);
  });

  it('exports the sponsors chosen with their images and imports them into another client', async () => {
    const exported = await call(HOST_A, cookieA, { url: '/api/admin/branding/export' });
    expect(exported.statusCode).toBe(200);
    const pkg = exported.json<GraphicsExport>();
    const [bar] = await list();
    expect(pkg.sponsors).toEqual([
      { id: bar?.id, name: 'Bar Centrale', website: 'https://bar.example.it/', imageIds: bar?.imageIds },
    ]);
    const imported = await call(HOST_B, cookieB, {
      method: 'POST',
      url: '/api/admin/branding/import',
      payload: pkg,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    expect(imported.json()).toMatchObject({ sponsors: 1 });
    const inB = await list(HOST_B, cookieB);
    const barB = inB.find((s) => s.name === 'Bar Centrale');
    expect(barB).toMatchObject({ website: 'https://bar.example.it/' });
    expect(barB?.imageIds).toHaveLength(bar?.imageIds.length ?? -1);
    const layoutB = (await call(HOST_B, cookieB, { url: '/api/admin/layout' })).json<LayoutResponse>().layout;
    expect(layoutB.tv[1]).toMatchObject({ options: { sponsors: [barB?.id] } });
    // Imported again: the same sponsor, no copy.
    await call(HOST_B, cookieB, {
      method: 'POST',
      url: '/api/admin/branding/import',
      payload: pkg,
    });
    expect((await list(HOST_B, cookieB)).filter((s) => s.name === 'Bar Centrale')).toHaveLength(1);
  });
});

const assets = () => assetsOf();
