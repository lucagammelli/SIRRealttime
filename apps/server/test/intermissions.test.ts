import type { AssetSummary, IntermissionsResponse, PublicTenantResponse } from '@sir/shared';
import { defaultIntermissions } from '@sir/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';
import { png } from './imageFixtures.js';

const HOST_A = 'pa.sir.test';
const HOST_B = 'pb.sir.test';
const ADMIN_A = { email: 'pause-a@sir.test', password: 'password-pause-a' };
const VIEWER_A = { email: 'pause-viewer-a@sir.test', password: 'password-pause-v' };
const ADMIN_B = { email: 'pause-b@sir.test', password: 'password-pause-b' };
const MISSING = '00000000-0000-4000-8000-000000000000';
const URL = '/api/admin/intermissions';

let server: TestServer;
let tenantA: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;

const call = (host: string, cookie: string | null, options: InjectOptions) =>
  server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });

const putPauses = (host: string, cookie: string, payload: unknown) =>
  call(host, cookie, { method: 'PUT', url: URL, payload: payload as Record<string, unknown> });

const publicPauses = async (host: string) =>
  (await call(host, null, { url: '/api/public/tenant' })).json<PublicTenantResponse>().intermissions;

const uploadSponsor = async (host: string, cookie: string, w: number) =>
  (
    await call(host, cookie, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'sponsor', data: png(w, 30).toString('base64') },
    })
  ).json<AssetSummary>();

/** End of the 2nd set with its own pause: the sponsor images given. */
const sponsorPauses = (images: string[]) => ({
  setBreakBySet: { '2': { slides: [{ id: 'sp', type: 'sponsor', seconds: 6, options: { images, seconds: 4 } }] } },
});

beforeAll(async () => {
  server = await startServer();
  tenantA = await createTenant(server, 'pause-a', [HOST_A]);
  const tenantB = await createTenant(server, 'pause-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());

describe('pauses of the public page', () => {
  it('starts from the defaults, in the admin area and in the public graphics', async () => {
    const res = await call(HOST_A, cookieA, { url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json<IntermissionsResponse>()).toEqual({ tenantName: 'PAUSE-A', intermissions: defaultIntermissions() });
    expect(await publicPauses(HOST_A)).toEqual(defaultIntermissions());
  });

  it('saves the pauses and the public page sees them at once (cache emptied)', async () => {
    const sponsor = await uploadSponsor(HOST_A, cookieA, 140);
    expect((await publicPauses(HOST_A)).timeout.enabled).toBe(true);
    const res = await putPauses(HOST_A, cookieA, { ...sponsorPauses([sponsor.id]), timeout: { enabled: false } });
    expect(res.statusCode).toBe(200);
    const saved = res.json<IntermissionsResponse>().intermissions;
    expect(saved.timeout.enabled).toBe(false);
    expect(saved.setBreak).toEqual(defaultIntermissions().setBreak);
    const pub = await publicPauses(HOST_A);
    expect(pub).toEqual(saved);
    expect(pub.setBreakBySet['2']?.slides[0]).toEqual({
      id: 'sp',
      type: 'sponsor',
      seconds: 6,
      options: { sponsors: [], images: [sponsor.id], seconds: 4 },
    });
    expect((await call(HOST_A, cookieA, { url: URL })).json<IntermissionsResponse>().intermissions).toEqual(saved);
  });

  it('saves the «ogni N punti» and the statistics slides; refuses an N out of its limits', async () => {
    const res = await putPauses(HOST_A, cookieA, {
      milestone: {
        every: 12,
        stopBeforeEnd: 3,
        slides: [
          { id: 'd', type: 'roleDuel', options: { role: 'libero', period: 'match' } },
          { id: 't', type: 'teamDuel', options: { rows: ['points', 'blocks'] } },
        ],
      },
      setBreak: {
        slides: [
          { id: 'a', type: 'aces' },
          { id: 'k', type: 'attack', options: { limit: 2 } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const saved = res.json<IntermissionsResponse>().intermissions;
    expect(saved.milestone).toMatchObject({ every: 12, stopBeforeEnd: 3, enabled: true });
    expect(saved.milestone.slides[0]).toEqual({
      id: 'd',
      type: 'roleDuel',
      seconds: 8,
      options: { role: 'libero', period: 'match' },
    });
    expect(saved.setBreak.slides[1]?.options).toEqual({ period: 'set', limit: 2 });
    expect(await publicPauses(HOST_A)).toEqual(saved);
    for (const bad of [
      { milestone: { every: 3 } },
      { milestone: { stopBeforeEnd: 16 } },
      { milestone: { maxTeamScore: 20 } },
      { milestone: { slides: [{ id: 'd', type: 'roleDuel', options: { role: 'allenatore' } }] } },
    ])
      expect((await putPauses(HOST_A, cookieA, bad)).statusCode).toBe(400);
  });

  it('refuses unknown slides, bad durations and delays, unknown fields', async () => {
    for (const bad of [
      { timeout: { slides: [{ id: 'x', type: 'video' }] } },
      { matchEnd: { slides: [{ id: 'm', type: 'message', options: { text: 'ciao', html: true } }] } },
      { setBreak: { slides: [{ id: 'x', type: 'mvp', seconds: 1 }] } },
      { setBreak: { delaySeconds: 600 } },
      { setBreakBySet: { '5': {} } },
      { timeout: { modes: { tv: 'popup' } } },
      { timeout: { slides: [] } },
      { script: 'alert(1)' },
      { version: 2 },
    ]) {
      expect((await putPauses(HOST_A, cookieA, bad)).statusCode).toBe(400);
    }
    // A message is plain text: what looks like HTML is stored as text, never interpreted.
    const text = await putPauses(HOST_A, cookieA, {
      matchEnd: { slides: [{ id: 'm', type: 'message', options: { text: '<b>' } }] },
    });
    expect(text.statusCode).toBe(200);
    expect(text.json<IntermissionsResponse>().intermissions.matchEnd.slides[0]).toMatchObject({
      options: { text: '<b>' },
    });
  });

  it('refuses a missing image and an image of another client; B never sees the pauses of A', async () => {
    const sponsorA = await uploadSponsor(HOST_A, cookieA, 141);
    expect((await putPauses(HOST_A, cookieA, sponsorPauses([MISSING]))).statusCode).toBe(400);
    expect((await putPauses(HOST_B, cookieB, sponsorPauses([sponsorA.id]))).statusCode).toBe(400);
    const sponsorB = await uploadSponsor(HOST_B, cookieB, 142);
    expect((await putPauses(HOST_A, cookieA, sponsorPauses([sponsorA.id, sponsorB.id]))).statusCode).toBe(400);
    expect((await putPauses(HOST_B, cookieB, sponsorPauses([sponsorB.id]))).statusCode).toBe(200);
    expect((await publicPauses(HOST_B)).setBreakBySet['2']?.slides[0]).toMatchObject({
      options: { images: [sponsorB.id] },
    });
    expect(JSON.stringify(await publicPauses(HOST_A))).not.toContain(sponsorB.id);
    // On the hostname of B the cookie of A still works on A, never on B.
    expect((await call(HOST_B, cookieA, { url: URL })).json<IntermissionsResponse>().tenantName).toBe('PAUSE-A');
  });

  it('keeps an image used by a sponsor slide from being deleted', async () => {
    const sponsor = await uploadSponsor(HOST_A, cookieA, 143);
    expect(
      (
        await putPauses(HOST_A, cookieA, {
          matchEnd: { slides: [{ id: 's', type: 'sponsor', options: { images: [sponsor.id] } }] },
        })
      ).statusCode,
    ).toBe(200);
    const del = () => call(HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/assets/${sponsor.id}` });
    const refused = await del();
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: string }>().error).toContain('pause');
    expect((await putPauses(HOST_A, cookieA, {})).statusCode).toBe(200);
    expect((await del()).statusCode).toBe(204);
  });

  it('is read-only for a viewer; a superadmin works on its active client', async () => {
    expect((await call(HOST_A, cookieViewerA, { url: URL })).statusCode).toBe(200);
    expect((await putPauses(HOST_A, cookieViewerA, {})).statusCode).toBe(403);
    expect((await call(HOST_A, null, { url: URL })).statusCode).toBe(401);
    expect((await putPauses(HOST_A, '', {})).statusCode).toBe(401);
    const superCookie = await login(server.app, SUPERADMIN, 'console.sir.test');
    const choose = await call('console.sir.test', superCookie, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantA },
    });
    expect(choose.statusCode).toBe(200);
    const res = await putPauses('console.sir.test', superCookie, { setBreak: { delaySeconds: 12 } });
    expect(res.statusCode).toBe(200);
    expect(res.json<IntermissionsResponse>().tenantName).toBe('PAUSE-A');
    expect((await publicPauses(HOST_A)).setBreak.delaySeconds).toBe(12);
    expect((await publicPauses(HOST_B)).setBreak.delaySeconds).toBe(5);
  });
});
