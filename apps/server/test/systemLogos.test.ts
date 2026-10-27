import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SystemLogos } from '@arenalive/shared';
import { NO_SYSTEM_LOGOS, SystemLogosSchema } from '@arenalive/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { systemLogoFilePath } from '../src/assetStore.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';
import { png, svg } from './imageFixtures.js';

const HOST_A = 'loghi-a.sir.test';
const HOST_B = 'loghi-b.sir.test';
const ADMIN_A = { email: 'admin-loghi-a@sir.test', password: 'password-admin-a' };

let server: TestServer;
let superCookie: string;
let adminCookie: string;
let adminACookie: string;

const call = (cookie: string | null, options: InjectOptions, host = HOST_A) =>
  server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });

const put = (slot: string, data: Buffer, cookie = superCookie, variant = 'positive') =>
  call(cookie, {
    method: 'PUT',
    url: `/api/admin/system-logos/${slot}/${variant}`,
    payload: { data: data.toString('base64') },
  });

const remove = (slot: string, cookie = superCookie, variant = 'positive') =>
  call(cookie, { method: 'DELETE', url: `/api/admin/system-logos/${slot}/${variant}` });

const list = async (host = HOST_A): Promise<SystemLogos> =>
  SystemLogosSchema.parse((await call(null, { url: '/api/public/system-logos' }, host)).json());

const fileName = (url: string): string => url.split('/').at(-1) ?? '';

beforeAll(async () => {
  server = await startServer();
  const tenantA = await createTenant(server, 'loghi-a', [HOST_A]);
  await createTenant(server, 'loghi-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  superCookie = await login(server.app, SUPERADMIN);
  adminCookie = await login(server.app, ADMIN);
  adminACookie = await login(server.app, ADMIN_A, HOST_A);
});
afterAll(() => server.close());

describe('system logos', () => {
  it('none at first: an empty list with a short cache', async () => {
    const res = await call(null, { url: '/api/public/system-logos' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=30');
    expect(res.json()).toEqual(NO_SYSTEM_LOGOS);
  });

  it('only the superadmin loads and removes them; a client admin and a visitor never', async () => {
    expect((await put('left', png(100, 40), adminCookie)).statusCode).toBe(403);
    expect((await put('left', png(100, 40), adminACookie)).statusCode).toBe(403);
    expect(
      (
        await call(null, {
          method: 'PUT',
          url: '/api/admin/system-logos/left/positive',
          payload: { data: 'iVBORw0KGgo=' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await remove('left', adminACookie)).statusCode).toBe(403);
    expect((await put('left', png(100, 40), adminACookie, 'negative')).statusCode).toBe(403);
    expect(await list()).toEqual(NO_SYSTEM_LOGOS);
  });

  it('loads a logo per side; every client and hostname sees the same ones; the file is public and immutable', async () => {
    const res = await put('left', png(180, 50));
    expect(res.statusCode).toBe(200);
    const logos = SystemLogosSchema.parse(res.json());
    expect(logos.left.positive).toMatchObject({ mime: 'image/png', width: 180, height: 50 });
    expect(logos.left.negative).toBeNull();
    expect(logos.right).toEqual({ positive: null, negative: null });
    const right = SystemLogosSchema.parse(
      (await put('right', svg('<circle cx="10" cy="10" r="10"/>', 'viewBox="0 0 120 40"'))).json(),
    ).right.positive;
    expect(right).toMatchObject({ mime: 'image/svg+xml', width: 120, height: 40 });
    expect(await list(HOST_B)).toEqual(await list(HOST_A));
    expect(await list('sconosciuto.test')).toEqual(await list(HOST_A));
    const file = await call(null, { url: logos.left.positive?.url ?? '' }, HOST_B);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(file.rawPayload.equals(png(180, 50))).toBe(true);
    const svgFile = await call(null, { url: right?.url ?? '' });
    expect(svgFile.headers['content-type']).toBe('image/svg+xml; charset=utf-8');
    expect(svgFile.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  });

  it('refuses a logo larger than 180×50 px, an unknown format, an unsafe SVG and an unknown slot', async () => {
    const before = await list();
    const wide = await put('left', png(181, 50));
    expect(wide.statusCode).toBe(422);
    expect(wide.json<{ error: string }>().error).toContain('al massimo 180×50 px, questo è 181×50 px');
    expect((await put('left', png(180, 51))).statusCode).toBe(422);
    expect((await put('right', svg('<rect width="10" height="10"/>', 'viewBox="0 0 300 100"'))).statusCode).toBe(422);
    expect((await put('left', Buffer.from('non è un’immagine'))).statusCode).toBe(422);
    expect((await put('left', svg('<script>alert(1)</script>'))).statusCode).toBe(422);
    expect((await put('center', png(10, 10))).statusCode).toBe(400);
    expect((await put('left', png(10, 10), superCookie, 'grey')).statusCode).toBe(400);
    expect(
      (
        await call(superCookie, {
          method: 'PUT',
          url: '/api/admin/system-logos/left',
          payload: { data: 'iVBORw0KGgo=' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call(superCookie, {
          method: 'PUT',
          url: '/api/admin/system-logos/left/positive',
          payload: { data: 'x', a: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(await list()).toEqual(before);
  });

  it('replacing changes the address (the old one is gone, its file too); removing leaves nothing', async () => {
    const old = (await list()).left.positive;
    const res = SystemLogosSchema.parse((await put('left', png(80, 30))).json()).left;
    expect(res.positive?.url).not.toBe(old?.url);
    expect((await call(null, { url: old?.url ?? '' })).statusCode).toBe(404);
    expect(existsSync(join(server.assetsDir, '_system'))).toBe(true);
    const removed = await remove('left');
    expect(removed.statusCode).toBe(200);
    expect(SystemLogosSchema.parse(removed.json()).left.positive).toBeNull();
    expect((await call(null, { url: res.positive?.url ?? '' })).statusCode).toBe(404);
    expect((await remove('left')).statusCode).toBe(200);
    expect((await call(null, { url: '/api/public/system-logos/non-un-id' })).statusCode).toBe(404);
    expect(fileName(res.positive?.url ?? '')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('the same file on both sides: removing one keeps the file of the other', async () => {
    const both = png(60, 20);
    await put('left', both);
    const right = SystemLogosSchema.parse((await put('right', both)).json()).right.positive;
    await remove('left');
    expect((await call(null, { url: right?.url ?? '' })).statusCode).toBe(200);
    await remove('right');
  });

  it('four places: each variant of each side on its own; replacing or removing one leaves the others', async () => {
    await put('left', png(100, 40));
    await put('left', png(101, 40), superCookie, 'negative');
    await put('right', png(102, 40), superCookie, 'negative');
    const logos = await list();
    expect(logos.left.positive).toMatchObject({ width: 100 });
    expect(logos.left.negative).toMatchObject({ width: 101 });
    expect(logos.right.positive).toBeNull();
    expect(logos.right.negative).toMatchObject({ width: 102 });
    const urls = [logos.left.positive?.url, logos.left.negative?.url, logos.right.negative?.url];
    expect(new Set(urls).size).toBe(3);
    const replaced = SystemLogosSchema.parse((await put('left', png(90, 40), superCookie, 'negative')).json());
    expect(replaced.left.positive).toEqual(logos.left.positive);
    expect(replaced.left.negative).toMatchObject({ width: 90 });
    const removed = SystemLogosSchema.parse((await remove('left', superCookie, 'negative')).json());
    expect(removed.left).toEqual({ positive: logos.left.positive, negative: null });
    expect(removed.right).toEqual(logos.right);
    await remove('left');
    await remove('right', superCookie, 'negative');
    expect(await list()).toEqual(NO_SYSTEM_LOGOS);
  });

  it('the same file in the four places: the file stays until the last one is removed', async () => {
    const same = png(70, 25);
    const file = systemLogoFilePath(server.assetsDir, createHash('sha256').update(same).digest('hex'));
    await put('left', same);
    await put('left', same, superCookie, 'negative');
    await put('right', same);
    await put('right', same, superCookie, 'negative');
    const last = (await list()).right.negative?.url ?? '';
    const places: [string, string][] = [
      ['left', 'positive'],
      ['left', 'negative'],
      ['right', 'positive'],
    ];
    for (const [slot, variant] of places) {
      await remove(slot, superCookie, variant);
      expect(existsSync(file)).toBe(true);
      expect((await call(null, { url: last })).statusCode).toBe(200);
    }
    await remove('right', superCookie, 'negative');
    expect(existsSync(file)).toBe(false);
    expect(await list()).toEqual(NO_SYSTEM_LOGOS);
  });
});
