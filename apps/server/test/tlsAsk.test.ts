import type { TenantSummary } from '@arenalive/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TLS_ASK_PATH } from '../src/routes/tlsAsk.js';
import type { TestServer } from './helpers.js';
import { createTenant, login, startServer, SUPERADMIN } from './helpers.js';

const HOST_CLIENT = 'demo.arenalive.test';

let server: TestServer;
let tenantId: string;
let superCookie: string;

/** Caddy's ask: plain GET on the internal network, no proxy headers. */
function ask(domain: string | null, headers: Record<string, string> = {}) {
  const query = domain === null ? '' : `?domain=${encodeURIComponent(domain)}`;
  return server.app.inject({
    method: 'GET',
    url: `${TLS_ASK_PATH}${query}`,
    headers: { host: 'server:8090', ...headers },
  });
}

beforeAll(async () => {
  server = await startServer();
  tenantId = await createTenant(server, 'demo', [HOST_CLIENT]);
  superCookie = await login(server.app, SUPERADMIN);
});

afterAll(async () => {
  await server.close();
});

describe('GET /internal/tls/ask (on-demand certificates of Caddy)', () => {
  it('allows a hostname of a client', async () => {
    const res = await ask(HOST_CLIENT);
    expect(res.statusCode).toBe(200);
  });

  it('refuses an unknown hostname, even with a default client', async () => {
    expect((await ask('sconosciuto.arenalive.test')).statusCode).toBe(404);
    expect((await ask('arenalive.test')).statusCode).toBe(404);
  });

  it('rejects a missing or malformed domain', async () => {
    for (const domain of [
      null,
      '',
      'Demo.Arenalive.Test',
      `${HOST_CLIENT}:443`,
      `${HOST_CLIENT}.`,
      '192.168.1.10',
      '[::1]',
      'https://demo.arenalive.test',
      'demo..arenalive.test',
      '-demo.arenalive.test',
      `${'a'.repeat(63)}.`.repeat(4) + 'test',
    ]) {
      expect((await ask(domain)).statusCode, String(domain)).toBe(400);
    }
    const twice = await server.app.inject({ method: 'GET', url: `${TLS_ASK_PATH}?domain=a.test&domain=b.test` });
    expect(twice.statusCode).toBe(400);
  });

  it('refuses a request forwarded by a proxy (never from Caddy on the internal network)', async () => {
    for (const header of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded']) {
      expect((await ask(HOST_CLIENT, { [header]: '203.0.113.7' })).statusCode, header).toBe(404);
    }
  });

  it('follows the hostnames changed in the admin area at once', async () => {
    const NEW_HOST = 'nuovo.arenalive.test';
    // Cached answers for both names, before the change.
    expect((await ask(NEW_HOST)).statusCode).toBe(404);
    expect((await ask(HOST_CLIENT)).statusCode).toBe(200);
    const patch = await server.app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}`,
      headers: { cookie: superCookie },
      payload: { hostnames: [NEW_HOST] },
    });
    expect(patch.json<TenantSummary>().hostnames).toEqual([NEW_HOST]);
    expect((await ask(NEW_HOST)).statusCode).toBe(200);
    expect((await ask(HOST_CLIENT)).statusCode).toBe(404);

    const created = await server.app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: { cookie: superCookie },
      payload: { slug: 'altro', name: 'Altro', hostnames: [HOST_CLIENT] },
    });
    expect(created.statusCode).toBe(201);
    expect((await ask(HOST_CLIENT)).statusCode).toBe(200);
  });

  it('is not under /api (nginx forwards only /api/ and /ws/ to the server)', () => {
    expect(TLS_ASK_PATH.startsWith('/api/')).toBe(false);
    expect(TLS_ASK_PATH.startsWith('/ws/')).toBe(false);
  });
});
