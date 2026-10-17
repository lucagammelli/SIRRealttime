import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { ADMIN, login, startServer, VIEWER } from './helpers.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Routes of the superadmin only: an admin of a client gets 403 too. */
const SUPERADMIN_ONLY = [/^\/api\/admin\/tenants/, /^\/api\/admin\/leagues/, /^\/api\/admin\/active-tenant$/];

let server: TestServer;
let viewer: string;
let admin: string;
const routes: { method: string; url: string }[] = [];

/** Every route of the reserved area that changes something, as registered by the server. */
const writeRoutes = () =>
  routes.filter((r) => WRITE_METHODS.has(r.method) && r.url.startsWith('/api/admin/')).map((r) => ({ ...r }));

/** The path with every parameter replaced by an id that exists nowhere. */
const concrete = (url: string): string => url.replace(/:[A-Za-z]+/g, () => randomUUID());

beforeAll(async () => {
  server = await startServer({}, {}, { onRoute: (route) => routes.push(route) });
  viewer = await login(server.app, VIEWER);
  admin = await login(server.app, ADMIN);
});
afterAll(() => server.close());

describe('roles of the reserved area', () => {
  it('lists the admin routes that write (the test covers the new ones by itself)', () => {
    const urls = writeRoutes().map((r) => `${r.method} ${r.url}`);
    expect(urls).toEqual(
      expect.arrayContaining([
        'POST /api/admin/agent-registrations/:id/approve',
        'PATCH /api/admin/agents/:id',
        'PUT /api/admin/club/profile',
        'POST /api/admin/calendar/fixtures',
        'PUT /api/admin/calendar/fixtures/:id',
        'DELETE /api/admin/calendar/fixtures/:id',
        'PATCH /api/admin/calendar/fixtures/:id/settings',
        'PUT /api/admin/branding',
        'DELETE /api/admin/share-tokens/:id',
      ]),
    );
    expect(urls.length).toBeGreaterThan(25);
  });

  it('refuses every route that writes to a viewer (403), before reading the body', async () => {
    const refused: string[] = [];
    for (const route of writeRoutes()) {
      const res = await server.app.inject({
        method: route.method as 'POST',
        url: concrete(route.url),
        headers: { cookie: viewer },
        ...(route.method === 'DELETE' ? {} : { payload: {} }),
      });
      if (res.statusCode !== 403) refused.push(`${route.method} ${route.url} → ${res.statusCode}`);
    }
    expect(refused).toEqual([]);
  });

  it('refuses the routes of the superadmin to an admin of a client (403)', async () => {
    const wrong: string[] = [];
    for (const route of writeRoutes().filter((r) => SUPERADMIN_ONLY.some((p) => p.test(r.url)))) {
      const res = await server.app.inject({
        method: route.method as 'POST',
        url: concrete(route.url),
        headers: { cookie: admin },
        ...(route.method === 'DELETE' ? {} : { payload: {} }),
      });
      if (res.statusCode !== 403) wrong.push(`${route.method} ${route.url} → ${res.statusCode}`);
    }
    expect(wrong).toEqual([]);
  });

  it('lets a viewer read the pages of the client, never the users nor the addresses of the registrations', async () => {
    const read = async (url: string) => (await server.app.inject({ url, headers: { cookie: viewer } })).statusCode;
    for (const url of [
      '/api/admin/club',
      '/api/admin/calendar',
      '/api/admin/agents',
      '/api/admin/agent-quota',
      '/api/admin/share-tokens',
      '/api/admin/branding',
      '/api/admin/assets',
    ])
      expect(await read(url)).toBe(200);
    for (const url of ['/api/admin/users', '/api/admin/agent-registrations', '/api/admin/leagues'])
      expect(await read(url)).toBe(403);
  });
});
