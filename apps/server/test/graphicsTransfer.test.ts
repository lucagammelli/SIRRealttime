import { existsSync } from 'node:fs';
import type {
  AssetListResponse,
  AssetSummary,
  GraphicsExport,
  GraphicsImportResponse,
  PublicTenantResponse,
} from '@sir/shared';
import { GraphicsExportSchema, graphicsImageIds, publicAssetPath } from '@sir/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { assignTemplate, createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';
import { png, svg } from './imageFixtures.js';

const HOST_A = 'ga.sir.test';
const HOST_B = 'gb.sir.test';
const HOST_C = 'gc.sir.test';
const ADMIN_A = { email: 'g-admin-a@sir.test', password: 'password-admin-a' };
const VIEWER_A = { email: 'g-viewer-a@sir.test', password: 'password-viewer-a' };
const ADMIN_B = { email: 'g-admin-b@sir.test', password: 'password-admin-b' };
const ADMIN_C = { email: 'g-admin-c@sir.test', password: 'password-admin-c' };

let server: TestServer;
let tenantA: string;
let tenantB: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;
let cookieC: string;

const call = (host: string, cookie: string | null, options: InjectOptions) =>
  server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });

const upload = async (host: string, cookie: string, kind: 'logo' | 'sponsor', data: Buffer) =>
  (
    await call(host, cookie, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind, data: data.toString('base64') },
    })
  ).json<AssetSummary>();

const exportOf = (host: string, cookie: string | null) => call(host, cookie, { url: '/api/admin/branding/export' });
const importTo = (host: string, cookie: string | null, payload: unknown) =>
  call(host, cookie, {
    method: 'POST',
    url: '/api/admin/branding/import',
    payload: payload as Record<string, unknown>,
  });
const publicTenant = async (host: string) =>
  (await call(host, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>();

const put = (host: string, cookie: string, what: string, payload: unknown) =>
  call(host, cookie, { method: 'PUT', url: `/api/admin/${what}`, payload: payload as Record<string, unknown> });

let logoA: AssetSummary;
let sponsorA: AssetSummary;

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'graf-a', [HOST_A]);
  tenantB = await createTenant(server, 'graf-b', [HOST_B]);
  const tenantC = await createTenant(server, 'graf-c', [HOST_C]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  await createUser(server, ADMIN_C, 'admin', tenantC);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
  cookieC = await login(server.app, ADMIN_C, HOST_C);

  logoA = await upload(HOST_A, cookieA, 'logo', png(120, 40));
  sponsorA = await upload(HOST_A, cookieA, 'sponsor', svg('<rect width="10" height="10"/>'));
  expect(
    (
      await put(HOST_A, cookieA, 'branding', {
        displayName: 'Club A',
        colors: { accent: '#ffcc00' },
        logoMain: logoA.id,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await put(HOST_A, cookieA, 'layout', {
        tv: [
          { id: 'tabellone', type: 'scoreboard' },
          { id: 'sp', type: 'sponsor', width: 4, options: { images: [sponsorA.id], seconds: 5 } },
        ],
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await put(HOST_A, cookieA, 'intermissions', {
        setBreakBySet: {
          '2': { slides: [{ id: 'sp', type: 'sponsor', seconds: 6, options: { images: [sponsorA.id], seconds: 4 } }] },
        },
      })
    ).statusCode,
  ).toBe(200);
});
afterAll(() => server.close());

describe('GET /api/admin/branding/export', () => {
  it('returns a versioned package with the images used and the documents', async () => {
    const res = await exportOf(HOST_A, cookieA);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="grafica-graf-a-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    const pkg = GraphicsExportSchema.parse(res.json());
    expect(pkg.format).toBe('sirrealtime-grafica');
    expect(pkg.version).toBe(1);
    expect(pkg.sourceName).toBe('GRAF-A');
    expect(pkg.branding.displayName).toBe('Club A');
    expect(pkg.images.map((i) => i.id).sort()).toEqual([logoA.id, sponsorA.id].sort());
    expect(graphicsImageIds(pkg).sort()).toEqual([logoA.id, sponsorA.id].sort());
    expect(pkg.images.find((i) => i.id === logoA.id)).toMatchObject({ kind: 'logo', mime: 'image/png' });
  });

  it('contains nothing of other data: no hostname, user, agent, link or match', async () => {
    const text = (await exportOf(HOST_A, cookieA)).body;
    for (const forbidden of [HOST_A, ADMIN_A.email, tenantA, 'hostnames', 'password', 'token', 'agent'])
      expect(text).not.toContain(forbidden);
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(
      [
        'branding',
        'exportedAt',
        'format',
        'images',
        'intermissions',
        'layout',
        'overlays',
        'sourceName',
        'sponsors',
        'version',
      ].sort(),
    );
  });

  it('does not carry the images of another client', async () => {
    const pkg = (await exportOf(HOST_B, cookieB)).json<GraphicsExport>();
    expect(pkg.images).toEqual([]);
    expect(pkg.sourceName).toBe('GRAF-B');
  });

  it('refuses a viewer and an anonymous caller', async () => {
    expect((await exportOf(HOST_A, cookieViewerA)).statusCode).toBe(403);
    expect((await exportOf(HOST_A, null)).statusCode).toBe(401);
  });
});

describe('POST /api/admin/branding/import', () => {
  it('copies the graphics to another client, with new image ids that the public routes serve', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    const res = await importTo(HOST_B, cookieB, pkg);
    expect(res.statusCode).toBe(200);
    expect(res.json<GraphicsImportResponse>()).toEqual({ images: 2, sponsors: 0, template: 'standard' });

    const pub = await publicTenant(HOST_B);
    expect(pub.branding.displayName).toBe('Club A');
    expect(pub.branding.colors).toEqual({ accent: '#ffcc00' });
    const logoId = pub.branding.logoMain;
    expect(logoId).not.toBeNull();
    expect(logoId).not.toBe(logoA.id);
    const used = graphicsImageIds({ branding: pub.branding, layout: pub.layout, intermissions: pub.intermissions });
    expect(used).toHaveLength(2);
    expect(used).not.toContain(logoA.id);
    expect(used).not.toContain(sponsorA.id);
    const sponsorBlock = pub.layout.tv.find((b) => b.type === 'sponsor');
    expect(sponsorBlock?.type === 'sponsor' && sponsorBlock.options.images).toHaveLength(1);

    const list = (await call(HOST_B, cookieB, { url: '/api/admin/assets' })).json<AssetListResponse>();
    expect(list.assets.map((a) => a.id).sort()).toEqual([...used].sort());
    for (const a of list.assets) {
      const file = await call(HOST_B, null, { url: publicAssetPath(a.id) });
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toContain(a.mime);
      expect(existsSync(`${server.assetsDir}/${tenantB}/${a.sha256}`)).toBe(true);
      // The same id is not served for the other client.
      expect((await call(HOST_A, null, { url: publicAssetPath(a.id) })).statusCode).toBe(404);
    }
    // Same bytes: the export of B is the package of A with other ids.
    const again = (await exportOf(HOST_B, cookieB)).json<GraphicsExport>();
    expect(again.images.map((i) => i.data).sort()).toEqual(pkg.images.map((i) => i.data).sort());
    expect(again.layout.tv.length).toBe(pkg.layout.tv.length);
  });

  it('is repeatable: the same images are reused', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    expect((await importTo(HOST_B, cookieB, pkg)).statusCode).toBe(200);
    const list = (await call(HOST_B, cookieB, { url: '/api/admin/assets' })).json<AssetListResponse>();
    expect(list.assets).toHaveLength(2);
  });

  it('replaces what the client had, overlays included', async () => {
    const pkg = (await exportOf(HOST_B, cookieB)).json<GraphicsExport>();
    pkg.overlays = { ...pkg.overlays };
    const res = await importTo(HOST_C, cookieC, { ...pkg, branding: { ...pkg.branding, displayName: 'Nuovo' } });
    expect(res.statusCode).toBe(200);
    expect((await publicTenant(HOST_C)).branding.displayName).toBe('Nuovo');
    expect((await publicTenant(HOST_C)).overlays).toEqual(pkg.overlays);
  });

  it('refuses a viewer', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    expect((await importTo(HOST_A, cookieViewerA, pkg)).statusCode).toBe(403);
    expect((await importTo(HOST_A, null, pkg)).statusCode).toBe(401);
  });

  it('refuses an unknown version or format with a clear message and changes nothing', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    const before = await publicTenant(HOST_C);
    const v = await importTo(HOST_C, cookieC, { ...pkg, version: 2 });
    expect(v.statusCode).toBe(400);
    expect(v.json<{ error: string }>().error).toContain('Versione');
    const f = await importTo(HOST_C, cookieC, { ...pkg, format: 'altro' });
    expect(f.statusCode).toBe(400);
    expect(await publicTenant(HOST_C)).toEqual(before);
  });

  it('refuses an image that is not one, a mismatched type, and an SVG with a script', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    const before = await publicTenant(HOST_C);
    const withImage = (index: number, patch: Partial<GraphicsExport['images'][number]>) => ({
      ...pkg,
      images: pkg.images.map((img, i) => (i === index ? { ...img, ...patch } : img)),
    });
    const logoIndex = pkg.images.findIndex((i) => i.id === logoA.id);
    const sponsorIndex = pkg.images.findIndex((i) => i.id === sponsorA.id);
    const fake = await importTo(
      HOST_C,
      cookieC,
      withImage(logoIndex, { data: Buffer.from('non sono un PNG').toString('base64') }),
    );
    expect(fake.statusCode).toBe(422);
    const wrongMime = await importTo(HOST_C, cookieC, withImage(logoIndex, { mime: 'image/jpeg' }));
    expect(wrongMime.statusCode).toBe(422);
    const evil = svg('<script>alert(1)</script><rect width="1" height="1"/>').toString('base64');
    const script = await importTo(HOST_C, cookieC, withImage(sponsorIndex, { data: evil }));
    expect(script.statusCode).toBe(422);
    expect(await publicTenant(HOST_C)).toEqual(before);
    const list = (await call(HOST_C, cookieC, { url: '/api/admin/assets' })).json<AssetListResponse>();
    expect(list.assets.every((a) => ![logoA.id, sponsorA.id].includes(a.id))).toBe(true);
  });

  it('refuses a package whose documents use an image it does not carry', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    expect((await importTo(HOST_C, cookieC, { ...pkg, images: [] })).statusCode).toBe(400);
  });

  it('refuses extra fields (hostnames and the like)', async () => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    expect((await importTo(HOST_C, cookieC, { ...pkg, hostnames: ['evil.test'] })).statusCode).toBe(400);
  });

  it('rolls back everything when the quota runs out during the import', async () => {
    const small = await startServer({}, { ASSETS_QUOTA_MB: '1' });
    try {
      const t = await createTenant(small, 'quota', ['q.sir.test']);
      const admin = { email: 'q@sir.test', password: 'password-quota-1' };
      await createUser(small, admin, 'admin', t);
      const cookie = await login(small.app, admin, 'q.sir.test');
      const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
      const big = {
        ...pkg,
        images: pkg.images.map((i) =>
          i.id === sponsorA.id
            ? { ...i, mime: 'image/png', kind: 'sponsor', data: png(40, 40, 1_500_000).toString('base64') }
            : i,
        ),
      };
      const res = await small.app.inject({
        method: 'POST',
        url: '/api/admin/branding/import',
        payload: big as unknown as Record<string, unknown>,
        headers: { host: 'q.sir.test', cookie },
      });
      expect(res.statusCode).toBe(409);
      const list = (
        await small.app.inject({ url: '/api/admin/assets', headers: { host: 'q.sir.test', cookie } })
      ).json<AssetListResponse>();
      expect(list.assets).toHaveLength(0);
    } finally {
      await small.close();
    }
  });
});

describe('export limits', () => {
  const sponsorBlocks = (ids: string[]) =>
    Array.from({ length: Math.ceil(ids.length / 12) }, (_, i) => ({
      id: `sp${i}`,
      type: 'sponsor',
      width: 4,
      options: { images: ids.slice(i * 12, i * 12 + 12), seconds: 5 },
    }));

  const setup = async (count: number, size: (i: number) => Buffer) => {
    const big = await startServer({}, { ASSETS_QUOTA_MB: '200' });
    const t = await createTenant(big, 'limiti', ['l.sir.test']);
    const admin = { email: 'l@sir.test', password: 'password-limiti-1' };
    await createUser(big, admin, 'admin', t);
    const cookie = await login(big.app, admin, 'l.sir.test');
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const res = await big.app.inject({
        method: 'POST',
        url: '/api/admin/assets',
        payload: { kind: 'sponsor', data: size(i).toString('base64') },
        headers: { host: 'l.sir.test', cookie },
      });
      ids.push(res.json<AssetSummary>().id);
    }
    const blocks = sponsorBlocks(ids);
    const layout = await big.app.inject({
      method: 'PUT',
      url: '/api/admin/layout',
      payload: { tv: blocks.slice(0, 1), tablet: blocks.slice(1, 2), phone: blocks.slice(2, 3) } as never,
      headers: { host: 'l.sir.test', cookie },
    });
    expect(layout.statusCode).toBe(200);
    return { big, cookie };
  };

  it('answers 409 with a clear message when more images than a package holds are used', async () => {
    const { big, cookie } = await setup(31, (i) => png(20 + i, 20));
    try {
      const res = await big.app.inject({
        url: '/api/admin/branding/export',
        headers: { host: 'l.sir.test', cookie },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toContain('31 immagini');
    } finally {
      await big.close();
    }
  });

  it('answers 409 when the images are too heavy for one package', async () => {
    const { big, cookie } = await setup(11, (i) => png(30, 30, 1_900_000 + i));
    try {
      const res = await big.app.inject({
        url: '/api/admin/branding/export',
        headers: { host: 'l.sir.test', cookie },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: string }>().error).toContain('MB');
    } finally {
      await big.close();
    }
  });
});

describe('custom theme in the package', () => {
  const themed = async (): Promise<GraphicsExport> => {
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    return { ...pkg, branding: { ...pkg.branding, template: 'sir-volley' } };
  };

  it('is refused to a client admin with a clear message, changing nothing', async () => {
    const before = await publicTenant(HOST_C);
    const res = await importTo(HOST_C, cookieC, await themed());
    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toContain('superadmin');
    expect(await publicTenant(HOST_C)).toEqual(before);
  });

  it('is accepted from the superadmin, and kept by the client that already has the theme', async () => {
    const superCookie = await login(server.app, SUPERADMIN, 'console.sir.test');
    await call('console.sir.test', superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantB },
    });
    const res = await importTo('console.sir.test', superCookie, await themed());
    expect(res.statusCode).toBe(200);
    expect(res.json<GraphicsImportResponse>().template).toBe('sir-volley');
    expect((await publicTenant(HOST_B)).branding.template).toBe('sir-volley');
    // The admin of B now has the theme and can import a package with it.
    expect((await importTo(HOST_B, cookieB, await themed())).statusCode).toBe(200);
  });

  it('is accepted for a client assigned the theme by the superadmin', async () => {
    await assignTemplate(server, tenantA, 'sir-volley');
    const pkg = (await exportOf(HOST_A, cookieA)).json<GraphicsExport>();
    expect((await importTo(HOST_A, cookieA, pkg)).statusCode).toBe(200);
  });
});

describe('rate limit', () => {
  it('counts the export and import requests with the admin limit', async () => {
    const strict = await startServer({ admin: 3 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i++)
        codes.push(
          (await strict.app.inject({ url: '/api/admin/branding/export', headers: { host: 'x.sir.test' } })).statusCode,
        );
      expect(codes).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await strict.close();
    }
  });
});
