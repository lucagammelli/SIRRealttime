import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetListResponse, AssetSummary, BrandingResponse, PublicTenantResponse } from '@arenalive/shared';
import {
  adminAssetPath,
  ASSET_MAX_BYTES,
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  publicAssetPath,
  resolveLayout,
} from '@arenalive/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';
import { jpeg, png, svg, webp } from './imageFixtures.js';

const HOST_A = 'a.sir.test';
const HOST_B = 'b.sir.test';
const ADMIN_A = { email: 'admin-a@sir.test', password: 'password-admin-a' };
const VIEWER_A = { email: 'viewer-a@sir.test', password: 'password-viewer-a' };
const ADMIN_B = { email: 'admin-b@sir.test', password: 'password-admin-b' };
const MISSING = '00000000-0000-4000-8000-000000000000';

let server: TestServer;
let tenantA: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;

function call(server: TestServer, host: string, cookie: string | null, options: InjectOptions) {
  return server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });
}

const upload = (host: string, cookie: string, data: Buffer, extra: Record<string, unknown> = {}, on = server) =>
  call(on, host, cookie, {
    method: 'POST',
    url: '/api/admin/assets',
    payload: { kind: 'logo', data: data.toString('base64'), ...extra },
  });

const publicTenant = (host: string) => call(server, host, null, { url: '/api/public/tenant' });

const putBranding = (host: string, cookie: string, payload: unknown) =>
  call(server, host, cookie, {
    method: 'PUT',
    url: '/api/admin/branding',
    payload: payload as Record<string, unknown>,
  });

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'club-a', [HOST_A]);
  const tenantB = await createTenant(server, 'club-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());

describe('public graphics of the client of the hostname', () => {
  it('starts from the defaults, with a short cache', async () => {
    const res = await publicTenant(HOST_A);
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(res.json<PublicTenantResponse>()).toEqual({
      name: 'CLUB-A',
      branding: defaultBranding(),
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
      layout: defaultLayout(),
      intermissions: defaultIntermissions(),
      overlays: defaultOverlays(),
      sponsors: [],
      players: [],
    });
  });

  it('names the default client after the portal until it has a display name', async () => {
    const res = await publicTenant('sconosciuto.test');
    expect(res.json<PublicTenantResponse>().name).toBe('ArenaLive');
  });

  it('is 404 for an unknown hostname without default client', async () => {
    const strict = await startServer({}, { DEFAULT_TENANT_SLUG: '' });
    try {
      const res = await call(strict, 'nessuno.test', null, { url: '/api/public/tenant' });
      expect(res.statusCode).toBe(404);
    } finally {
      await strict.close();
    }
  });
});

describe('uploads', () => {
  it('stores a PNG named after its sha256, type and size from the bytes; the same file again is the same image', async () => {
    const file = png(200, 50);
    const res = await upload(HOST_A, cookieA, file);
    expect(res.statusCode).toBe(201);
    const asset = res.json<AssetSummary>();
    expect(asset).toMatchObject({ kind: 'logo', mime: 'image/png', width: 200, height: 50, bytes: file.length });
    expect(asset.url).toBe(`/api/admin/assets/${asset.id}/file`);
    expect(existsSync(join(server.assetsDir, tenantA, asset.sha256))).toBe(true);
    const again = await upload(HOST_A, cookieA, file);
    expect(again.statusCode).toBe(200);
    expect(again.json<AssetSummary>().id).toBe(asset.id);
  });

  it('accepts JPEG, WebP and a clean SVG', async () => {
    for (const [file, mime] of [
      [jpeg(10, 10), 'image/jpeg'],
      [webp(10, 10), 'image/webp'],
      [svg('<rect width="10" height="10" fill="#003399"/>'), 'image/svg+xml'],
    ] as const) {
      const res = await upload(HOST_A, cookieA, file);
      expect(res.statusCode).toBe(201);
      expect(res.json<AssetSummary>().mime).toBe(mime);
    }
  });

  it('never takes a name or a declared type: extra fields are refused, the type comes from the bytes', async () => {
    const withMime = await upload(HOST_A, cookieA, png(5, 5), { mime: 'image/svg+xml' });
    expect(withMime.statusCode).toBe(400);
    const withName = await upload(HOST_A, cookieA, png(5, 5), { filename: '../../evil.svg' });
    expect(withName.statusCode).toBe(400);
  });

  it('refuses fake images (422), polyglots and dangerous SVG', async () => {
    const bad = [
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.concat([png(5, 5), Buffer.from('<script>alert(1)</script>')]),
      Buffer.concat([jpeg(5, 5), Buffer.from('<?php echo 1; ?>')]),
      svg('<script>alert(1)</script>'),
      svg('<rect width="1" height="1" onload="alert(1)"/>'),
      svg('<foreignObject><div>x</div></foreignObject>'),
      svg('<use href="javascript:alert(1)"/>'),
      Buffer.from(
        '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&x;</text></svg>',
      ),
      Buffer.from('GIF89a'),
    ];
    for (const file of bad) {
      const res = await upload(HOST_A, cookieA, file);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ error: string }>().error).not.toMatch(/stack|at /);
    }
  });

  it('refuses an image over 2 MB (413) and a body over its limit', async () => {
    const big = await upload(HOST_A, cookieA, png(10, 10, ASSET_MAX_BYTES));
    expect(big.statusCode).toBe(413);
    const huge = await call(server, HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'logo', data: 'A'.repeat(4 * 1024 * 1024) },
    });
    expect(huge.statusCode).toBe(413);
  });

  it('applies the quota of the client (409)', async () => {
    const small = await startServer({}, { ASSETS_QUOTA_MB: '1' });
    try {
      const id = await createTenant(small, 'club-q', ['q.sir.test']);
      const who = { email: 'q@sir.test', password: 'password-quota-1' };
      await createUser(small, who, 'admin', id);
      const cookie = await login(small.app, who, 'q.sir.test');
      expect((await upload('q.sir.test', cookie, png(10, 10, 600_000), {}, small)).statusCode).toBe(201);
      const over = await upload('q.sir.test', cookie, png(11, 10, 600_000), {}, small);
      expect(over.statusCode).toBe(409);
      expect(over.json<{ error: string }>().error).toContain('Spazio per i file esaurito');
      const list = await call(small, 'q.sir.test', cookie, { url: '/api/admin/assets' });
      expect(list.json<AssetListResponse>()).toMatchObject({ quotaBytes: 1024 * 1024 });
      expect(list.json<AssetListResponse>().assets).toHaveLength(1);
    } finally {
      await small.close();
    }
  });

  it('is for admins only, as JSON from an allowed origin', async () => {
    expect((await upload(HOST_A, cookieViewerA, png(5, 5))).statusCode).toBe(403);
    const anonymous = await call(server, HOST_A, null, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'logo', data: png(5, 5).toString('base64') },
    });
    expect(anonymous.statusCode).toBe(401);
    const binary = await call(server, HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/assets',
      headers: { 'content-type': 'image/png' },
      payload: png(5, 5),
    });
    expect(binary.statusCode).toBe(415);
    const foreign = await call(server, HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/assets',
      headers: { origin: 'https://evil.example' },
      payload: { kind: 'logo', data: png(5, 5).toString('base64') },
    });
    expect(foreign.statusCode).toBe(403);
  });
});

describe('serving the images', () => {
  it('serves the file with a fixed type, nosniff, inline and a long immutable cache', async () => {
    const asset = (await upload(HOST_A, cookieA, png(30, 30))).json<AssetSummary>();
    const res = await call(server, HOST_A, null, { url: publicAssetPath(asset.id) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.rawPayload.equals(png(30, 30))).toBe(true);
  });

  it('serves an SVG with a CSP that runs and loads nothing', async () => {
    const asset = (await upload(HOST_A, cookieA, svg('<circle cx="5" cy="5" r="5"/>'))).json<AssetSummary>();
    const res = await call(server, HOST_A, null, { url: publicAssetPath(asset.id) });
    expect(res.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });

  it('is 404 on the hostname of another client, for a missing id and for a malformed id', async () => {
    const asset = (await upload(HOST_A, cookieA, png(31, 31))).json<AssetSummary>();
    expect((await call(server, HOST_B, null, { url: publicAssetPath(asset.id) })).statusCode).toBe(404);
    expect((await call(server, HOST_A, null, { url: `/api/public/assets/${MISSING}` })).statusCode).toBe(404);
    expect((await call(server, HOST_A, null, { url: '/api/public/assets/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(
      404,
    );
  });

  it('serves the file to the reserved area of its client whatever the hostname (IP address of a test install)', async () => {
    const asset = (await upload(HOST_A, cookieA, png(32, 32))).json<AssetSummary>();
    const ip = '192.168.104.102:8085';
    // The IP address resolves to the default client: the public path does not find the image of club-a.
    expect((await call(server, ip, null, { url: publicAssetPath(asset.id) })).statusCode).toBe(404);
    const res = await call(server, ip, cookieA, { url: asset.url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.rawPayload.equals(png(32, 32))).toBe(true);
    expect((await call(server, ip, cookieViewerA, { url: asset.url })).statusCode).toBe(200);
  });

  it('is 401 without a session, 404 for an image of another client or a missing id, 400 for a malformed id', async () => {
    const asset = (await upload(HOST_A, cookieA, png(33, 33))).json<AssetSummary>();
    expect((await call(server, HOST_A, null, { url: adminAssetPath(asset.id) })).statusCode).toBe(401);
    expect((await call(server, HOST_B, cookieB, { url: adminAssetPath(asset.id) })).statusCode).toBe(404);
    expect((await call(server, HOST_A, cookieA, { url: adminAssetPath(MISSING) })).statusCode).toBe(404);
    expect((await call(server, HOST_A, cookieA, { url: '/api/admin/assets/..%2Fx/file' })).statusCode).toBe(400);
  });
});

describe('branding of the client', () => {
  it('saves colours and logos, and the public page sees them at once (cache emptied)', async () => {
    const logo = (await upload(HOST_A, cookieA, png(240, 60))).json<AssetSummary>();
    const mark = (await upload(HOST_A, cookieA, png(64, 64))).json<AssetSummary>();
    // The client of the hostname is now in the server cache, with the old branding.
    expect((await publicTenant(HOST_A)).json<PublicTenantResponse>().images.logoMain).toBeNull();
    const res = await putBranding(HOST_A, cookieA, {
      displayName: 'Sir Safety Perugia',
      colors: { primary: '#003399', home: '#E30613' },
      logoMain: logo.id,
      logoMark: mark.id,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<BrandingResponse>().branding.colors).toEqual({ primary: '#003399', home: '#e30613' });
    const pub = (await publicTenant(HOST_A)).json<PublicTenantResponse>();
    expect(pub.name).toBe('Sir Safety Perugia');
    expect(pub.branding.colors.home).toBe('#e30613');
    expect(pub.images).toEqual({
      logoMain: publicAssetPath(logo.id),
      logoMark: publicAssetPath(mark.id),
      sponsorLogo: null,
    });
    const admin = await call(server, HOST_A, cookieA, { url: '/api/admin/branding' });
    expect(admin.json<BrandingResponse>()).toMatchObject({ tenantName: 'CLUB-A', branding: { logoMain: logo.id } });
  });

  it('keeps the clients apart: B sees only its graphics and cannot use, delete or read the images of A', async () => {
    const logoA = (await upload(HOST_A, cookieA, png(77, 20))).json<AssetSummary>();
    const pubB = (await publicTenant(HOST_B)).json<PublicTenantResponse>();
    expect(pubB.branding.colors).toEqual({});
    expect(pubB.images.logoMain).toBeNull();
    expect((await putBranding(HOST_B, cookieB, { logoMain: logoA.id })).statusCode).toBe(400);
    expect(
      (await call(server, HOST_B, cookieB, { method: 'DELETE', url: `/api/admin/assets/${logoA.id}` })).statusCode,
    ).toBe(404);
    const listB = (await call(server, HOST_B, cookieB, { url: '/api/admin/assets' })).json<AssetListResponse>();
    expect(listB.assets.map((a) => a.id)).not.toContain(logoA.id);
    // On the hostname of B the cookie of A still works on A, never on B.
    const onB = await call(server, HOST_B, cookieA, { url: '/api/admin/branding' });
    expect(onB.json<BrandingResponse>().tenantName).toBe('CLUB-A');
    expect((await call(server, HOST_A, cookieA, { url: logoA.url })).statusCode).toBe(200);
  });

  it('refuses invalid colours, unknown fields, a missing image and an image of the wrong kind', async () => {
    expect((await putBranding(HOST_A, cookieA, { colors: { home: 'red' } })).statusCode).toBe(400);
    expect((await putBranding(HOST_A, cookieA, { colors: { home: '#000000;}' } })).statusCode).toBe(400);
    expect((await putBranding(HOST_A, cookieA, { css: 'body{}' })).statusCode).toBe(400);
    expect((await putBranding(HOST_A, cookieA, { logoMain: MISSING })).statusCode).toBe(400);
    const logo = (await upload(HOST_A, cookieA, png(12, 12))).json<AssetSummary>();
    expect((await putBranding(HOST_A, cookieA, { sponsorLogo: logo.id })).statusCode).toBe(400);
    expect((await putBranding(HOST_A, cookieViewerA, {})).statusCode).toBe(403);
  });

  it('deletes an image only when the branding does not use it', async () => {
    const logo = (await upload(HOST_A, cookieA, png(99, 33))).json<AssetSummary>();
    expect((await putBranding(HOST_A, cookieA, { logoMain: logo.id })).statusCode).toBe(200);
    const del = () => call(server, HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/assets/${logo.id}` });
    expect((await del()).statusCode).toBe(409);
    expect((await putBranding(HOST_A, cookieA, {})).statusCode).toBe(200);
    expect((await del()).statusCode).toBe(204);
    expect((await call(server, HOST_A, null, { url: publicAssetPath(logo.id) })).statusCode).toBe(404);
    expect(existsSync(join(server.assetsDir, tenantA, logo.sha256))).toBe(false);
    expect((await del()).statusCode).toBe(404);
  });

  it('works for a superadmin on its active client, and asks to choose one without', async () => {
    const superCookie = await login(server.app, SUPERADMIN, 'console.sir.test');
    const none = await putBranding('console.sir.test', superCookie, {});
    // No client entered: never the client of the hostname.
    expect(none.statusCode).toBe(409);
    const choose = await call(server, 'console.sir.test', superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantA },
    });
    expect(choose.statusCode).toBe(200);
    const res = await putBranding('console.sir.test', superCookie, { colors: { accent: '#ffcc00' } });
    expect(res.json<BrandingResponse>().tenantName).toBe('CLUB-A');
    expect((await publicTenant(HOST_A)).json<PublicTenantResponse>().branding.colors).toEqual({ accent: '#ffcc00' });
  });
});

describe('custom theme (SIR VOLLEY)', () => {
  const HOST_SIR = 'sir.sir.test';
  const ADMIN_SIR = { email: 'admin-sir@sir.test', password: 'password-admin-sir' };
  let tenantSir: string;
  let cookieSir: string;

  beforeAll(async () => {
    tenantSir = await createTenant(server, 'club-sir', [HOST_SIR]);
    await createUser(server, ADMIN_SIR, 'admin', tenantSir);
    cookieSir = await login(server.app, ADMIN_SIR, HOST_SIR);
  });

  it('is refused to a client admin, accepted from the superadmin', async () => {
    const refused = await putBranding(HOST_SIR, cookieSir, { template: 'sir-volley' });
    expect(refused.statusCode).toBe(403);
    expect((await publicTenant(HOST_SIR)).json<PublicTenantResponse>().branding.template).toBe('standard');
    // A built-in model is free.
    expect((await putBranding(HOST_SIR, cookieSir, { template: 'notte' })).statusCode).toBe(200);

    const superCookie = await login(server.app, SUPERADMIN, 'console.sir.test');
    await call(server, 'console.sir.test', superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantSir },
    });
    expect((await putBranding('console.sir.test', superCookie, { template: 'sir-volley' })).statusCode).toBe(200);
  });

  it('is kept by the client that has it, with the same page as before, and cannot be taken back after leaving it', async () => {
    const pub = (await publicTenant(HOST_SIR)).json<PublicTenantResponse>();
    expect(pub.branding.template).toBe('sir-volley');
    expect(pub.layout).toEqual(resolveLayout({}, 'sir-volley'));
    const keep = await putBranding(HOST_SIR, cookieSir, { template: 'sir-volley', colors: { accent: '#ff0000' } });
    expect(keep.statusCode).toBe(200);
    expect((await putBranding(HOST_SIR, cookieSir, { template: 'standard' })).statusCode).toBe(200);
    expect((await putBranding(HOST_SIR, cookieSir, { template: 'sir-volley' })).statusCode).toBe(403);
  });
});
