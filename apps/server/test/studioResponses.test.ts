import type { Sponsor } from '@sir/shared';
import {
  AssetListResponseSchema,
  BrandingResponseSchema,
  ClubResponseSchema,
  IntermissionsResponseSchema,
  LayoutResponseSchema,
  OverlaysResponseSchema,
  SponsorListResponseSchema,
} from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenants } from '../src/db/index.js';
import type { TestServer } from './helpers.js';
import { createTenant, login, startServer, SUPERADMIN } from './helpers.js';
import { png } from './imageFixtures.js';

let server: TestServer;
let cookie: string;

const call = (url: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>) =>
  server.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

/** Sponsor slide as saved before the field `enabled` of the slides (documents of a client of the test stack). */
const sponsorSlide = (sponsors: string[], seconds: number) => ({
  id: 'sponsor',
  type: 'sponsor',
  options: { images: [], seconds: 8, sponsors },
  seconds,
});

beforeAll(async () => {
  server = await startServer();
  const id = await createTenant(server, 'studio-dati-reali', []);
  cookie = await login(server.app, SUPERADMIN);
  expect((await call('/api/admin/active-tenant', 'POST', { tenantId: id })).statusCode).toBe(200);
  const istante = (
    await call('/api/admin/sponsors', 'POST', { name: 'Istante', website: 'https://istante.info/' })
  ).json<Sponsor>();
  // A sponsor without images.
  const pcs = (
    await call('/api/admin/sponsors', 'POST', { name: 'PCS Group', website: 'HTTPS://PCSgroup.solutions' })
  ).json<Sponsor>();
  const image = { kind: 'sponsor', sponsorId: istante.id, data: png(80, 45).toString('base64') };
  expect((await call('/api/admin/assets', 'POST', image)).statusCode).toBe(201);
  // Documents as stored by a client: empty layout, pauses without `enabled` on the slides, some overlays off.
  await server.database.db
    .update(tenants)
    .set({
      layout: {},
      branding: { version: 1, template: 'standard', colors: { accent: '#8b3c1d', primary: '#a13089' } },
      intermissions: {
        version: 1,
        timeout: { slides: [sponsorSlide([], 10)], enabled: true, delaySeconds: 0 },
        setBreak: {
          slides: [
            sponsorSlide([pcs.id, istante.id], 12),
            { id: 'setScorers', type: 'setScorers', options: { limit: 5, period: 'set' }, seconds: 8 },
          ],
        },
        milestone: { every: 8, slides: [sponsorSlide([], 8)], stopBeforeEnd: 5 },
        setBreakBySet: {},
      },
      overlays: { version: 1, position: 'top', size: 'medium', ace: { enabled: false } },
    })
    .where(eq(tenants.id, id));
});
afterAll(() => server.close());

describe('answers of the routes of the Studio, read with the schemas of the portal', () => {
  const routes: [string, z.ZodType][] = [
    ['/api/admin/sponsors', SponsorListResponseSchema],
    ['/api/admin/assets', AssetListResponseSchema],
    ['/api/admin/branding', BrandingResponseSchema],
    ['/api/admin/layout', LayoutResponseSchema],
    ['/api/admin/intermissions', IntermissionsResponseSchema],
    ['/api/admin/overlays', OverlaysResponseSchema],
    ['/api/admin/club', ClubResponseSchema],
  ];
  it.each(routes)('%s', async (url, schema) => {
    const res = await call(url);
    expect(res.statusCode).toBe(200);
    const parsed = schema.safeParse(res.json());
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });
});
