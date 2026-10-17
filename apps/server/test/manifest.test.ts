import type { AssetSummary, WebManifest } from '@sir/shared';
import { DEFAULT_MANIFEST_ICONS } from '@sir/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer } from './helpers.js';
import { png } from './imageFixtures.js';

const HOST = 'manifest.test';
const HOST_SIR = 'manifest-sir.test';
const ADMIN_M = { email: 'admin-manifest@sir.test', password: 'password-admin-mf' };
const ADMIN_S = { email: 'admin-manifest-sir@sir.test', password: 'password-admin-ms' };

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

const manifest = async (host?: string) => {
  const res = await server.app.inject({
    url: '/api/public/manifest.webmanifest',
    ...(host ? { headers: { host } } : {}),
  });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('application/manifest+json');
  return res.json<WebManifest>();
};

describe('manifest of the installable app', () => {
  it('is the one of the portal for a client without graphics, without start_url', async () => {
    const body = await manifest();
    expect(body).toMatchObject({ name: 'SIRRealtime', display: 'fullscreen', theme_color: '#1d4ed8' });
    expect(body.icons).toEqual(DEFAULT_MANIFEST_ICONS);
    expect('start_url' in body).toBe(false);
  });

  it('has the name, the colours and the square logo of the client of the hostname', async () => {
    const tenantId = await createTenant(server, 'manifest', [HOST]);
    await createUser(server, ADMIN_M, 'admin', tenantId);
    const cookie = await login(server.app, ADMIN_M, HOST);
    const call = (method: 'POST' | 'PUT', url: string, payload: unknown) =>
      server.app.inject({ method, url, payload: payload as object, headers: { cookie, host: HOST } });
    const logo = (
      await call('POST', '/api/admin/assets', { kind: 'logo', data: png(256, 256).toString('base64') })
    ).json<AssetSummary>();
    const saved = await call('PUT', '/api/admin/branding', {
      displayName: 'Sir Susa Scai Perugia',
      colors: { primary: '#c8102e', background: '#ffffff' },
      logoMark: logo.id,
    });
    expect(saved.statusCode).toBe(200);
    const body = await manifest(HOST);
    expect(body).toMatchObject({
      name: 'Sir Susa Scai Perugia',
      short_name: 'Sir Susa Sca',
      theme_color: '#c8102e',
      background_color: '#ffffff',
    });
    expect(body.icons[0]).toEqual({ src: logo.url, sizes: '256x256', type: 'image/png', purpose: 'any' });
    // Another client keeps its own.
    expect((await manifest()).name).toBe('SIRRealtime');
  });

  it('uses the colours of the template where the client has chosen none (SIR VOLLEY: dark and red)', async () => {
    const tenantId = await createTenant(server, 'manifest-sir', [HOST_SIR]);
    await createUser(server, ADMIN_S, 'admin', tenantId);
    const cookie = await login(server.app, ADMIN_S, HOST_SIR);
    const put = (payload: object) =>
      server.app.inject({ method: 'PUT', url: '/api/admin/branding', payload, headers: { cookie, host: HOST_SIR } });
    expect((await put({ template: 'sir-volley', colors: {} })).statusCode).toBe(200);
    expect(await manifest(HOST_SIR)).toMatchObject({ theme_color: '#e30613', background_color: '#0b0b0d' });
    // A colour of the client goes over the template, the others stay those of the template.
    expect((await put({ template: 'sir-volley', colors: { primary: '#b00010' } })).statusCode).toBe(200);
    expect(await manifest(HOST_SIR)).toMatchObject({ theme_color: '#b00010', background_color: '#0b0b0d' });
  });
});
