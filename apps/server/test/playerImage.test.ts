import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { DisplayConfigFile } from '@arenalive/shared';
import {
  DisplayConfigFileSchema,
  DisplayImageTicketSchema,
  DisplaySummarySchema,
  PLAYER_IMAGE_SLOT_SIZE,
  PlayerImageInfoSchema,
} from '@arenalive/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { displays } from '../src/db/index.js';
import { DisplayImageTickets } from '../src/displayImageTickets.js';
import { configSlot } from '../src/playerImage.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, startServer, VIEWER } from './helpers.js';

let server: TestServer;
let admin: string;
let otherAdmin: string;
let viewer: string;
let adminB: string;
let dir: string;
const HOST_B = 'b.immagine.test';
const WIFI_PASSWORD = 'password-wifi-segreta';

/** The old `.img.xz` (format 1). */
const xz = randomBytes(200_000);
const xzSha = createHash('sha256').update(xz).digest('hex');

/** A small image (64 KiB) with the slot (filled with a placeholder) at a known offset. */
const SLOT_OFFSET = 16 * 1024;
const image = randomBytes(64 * 1024);
image.fill('#'.charCodeAt(0), SLOT_OFFSET, SLOT_OFFSET + PLAYER_IMAGE_SLOT_SIZE);
const PART_NAMES = ['arenalive-player-image-1.gz', 'arenalive-player-image-2.gz', 'arenalive-player-image-3.gz'];
const parts = [
  gzipSync(image.subarray(0, SLOT_OFFSET)),
  gzipSync(image.subarray(SLOT_OFFSET, SLOT_OFFSET + PLAYER_IMAGE_SLOT_SIZE)),
  gzipSync(image.subarray(SLOT_OFFSET + PLAYER_IMAGE_SLOT_SIZE)),
];
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const MANIFEST = 'arenalive-player-image.json';

const get = (url: string, cookie?: string) => server.app.inject({ url, ...(cookie ? { headers: { cookie } } : {}) });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sir-player-img-'));
  server = await startServer({}, { PLAYER_DOWNLOAD_DIR: dir });
  admin = await login(server.app, ADMIN);
  viewer = await login(server.app, VIEWER);
  const OTHER = { email: 'altro-admin@immagine.test', password: 'password-altro-admin' };
  await createUser(server, OTHER, 'admin', server.tenantId);
  otherAdmin = await login(server.app, OTHER);
  const tenantB = await createTenant(server, 'immagine-b', [HOST_B]);
  const ADMIN_B = { email: 'admin-b@immagine.test', password: 'password-admin-b' };
  await createUser(server, ADMIN_B, 'admin', tenantB);
  adminB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  server.setNow(null);
  for (const f of ['arenalive-player.img.xz', MANIFEST, ...PART_NAMES]) await rm(join(dir, f), { force: true });
});

async function publishLegacy(manifestSha = xzSha): Promise<void> {
  await writeFile(join(dir, 'arenalive-player.img.xz'), xz);
  await writeFile(
    join(dir, MANIFEST),
    JSON.stringify({ version: '0.1.0', builtAt: '2026-10-26T10:00:00.000Z', sha256: manifestSha, size: xz.length }),
  );
}

const manifestOf = (over: Record<string, unknown> = {}) => ({
  format: 2,
  version: '0.2.0',
  builtAt: '2026-10-27T10:00:00.000Z',
  imageSize: image.length,
  imageSha256: sha(image),
  slotOffset: SLOT_OFFSET,
  slotSize: PLAYER_IMAGE_SLOT_SIZE,
  parts: parts.map((p, i) => ({ file: PART_NAMES[i], size: p.length, sha256: sha(p) })),
  ...over,
});

async function publishParts(manifest: Record<string, unknown> = manifestOf()): Promise<void> {
  for (const [i, p] of parts.entries()) await writeFile(join(dir, PART_NAMES[i] ?? ''), p);
  await writeFile(join(dir, MANIFEST), JSON.stringify(manifest));
}

const info = async (cookie = admin) =>
  PlayerImageInfoSchema.parse((await get('/api/admin/player/image/info', cookie)).json());

async function newDisplay(name: string, cookie = admin, host?: string): Promise<string> {
  const res = await server.app.inject({
    method: 'POST',
    url: '/api/admin/displays',
    headers: { cookie, ...(host ? { host } : {}) },
    payload: { name },
  });
  expect(res.statusCode).toBe(201);
  return DisplaySummarySchema.parse(res.json()).id;
}

const prepare = (id: string, cookie = admin, payload: Record<string, unknown> = {}, host?: string) =>
  server.app.inject({
    method: 'POST',
    url: `/api/admin/displays/${id}/image`,
    headers: { cookie, ...(host ? { host } : {}) },
    payload,
  });

async function ticketOf(id: string, payload: Record<string, unknown> = {}) {
  const res = await prepare(id, admin, payload);
  expect(res.statusCode).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return DisplayImageTicketSchema.parse(res.json());
}

const downloadUrl = (ticket: string) => `/api/admin/displays/image/${ticket}`;

/** The configuration written in the slot of a downloaded image. */
function slotOf(downloaded: Buffer): { config: DisplayConfigFile; slot: Buffer } {
  const raw = gunzipSync(downloaded);
  expect(raw.length).toBe(image.length);
  expect(raw.subarray(0, SLOT_OFFSET).equals(image.subarray(0, SLOT_OFFSET))).toBe(true);
  expect(
    raw.subarray(SLOT_OFFSET + PLAYER_IMAGE_SLOT_SIZE).equals(image.subarray(SLOT_OFFSET + PLAYER_IMAGE_SLOT_SIZE)),
  ).toBe(true);
  const slot = raw.subarray(SLOT_OFFSET, SLOT_OFFSET + PLAYER_IMAGE_SLOT_SIZE);
  const text = slot.toString('utf8');
  return { config: DisplayConfigFileSchema.parse(JSON.parse(text)), slot };
}

const heartbeat = (token: string) =>
  server.app.inject({
    method: 'POST',
    url: '/api/displays/heartbeat',
    headers: { authorization: `Bearer ${token}` },
    payload: { version: '1.0.0', uptimeS: 10 },
  });

describe('generic image of the SD card (format 1, .img.xz)', () => {
  it('says it is not available until it is published, and the download is a 404', async () => {
    expect(await info()).toEqual({ available: false });
    const res = await get('/api/admin/player/image', admin);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Immagine non ancora pubblicata sul server' });
  });

  it('offers nothing when the manifest does not describe the file', async () => {
    await publishLegacy('f'.repeat(64));
    expect(await info()).toEqual({ available: false });
  });

  it('gives version, size and sha256, then the file as an attachment, and no ready image', async () => {
    await publishLegacy();
    expect(await info()).toEqual({
      available: true,
      version: '0.1.0',
      builtAt: '2026-10-26T10:00:00.000Z',
      bytes: xz.length,
      sha256: xzSha,
      sha256Of: 'file',
      fileName: 'arenalive-player-0.1.0.img.xz',
      ready: false,
    });
    const res = await get('/api/admin/player/image', admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="arenalive-player-0.1.0.img.xz"');
    expect(res.headers['content-length']).toBe(String(xz.length));
    expect(res.headers['content-type']).toBe('application/x-xz');
    expect(res.rawPayload.equals(xz)).toBe(true);
    const id = await newDisplay('Senza immagine pronta');
    const refused = await prepare(id);
    expect(refused.statusCode).toBe(404);
    expect(refused.json<{ error: string }>().error).toMatch(/immagine pronta non è disponibile/);
  });

  it('is for admins only', async () => {
    await publishLegacy();
    expect((await get('/api/admin/player/image/info')).statusCode).toBe(401);
    expect((await get('/api/admin/player/image')).statusCode).toBe(401);
    expect((await get('/api/admin/player/image/info', viewer)).statusCode).toBe(403);
    expect((await get('/api/admin/player/image', viewer)).statusCode).toBe(403);
  });

  it('limits the downloads per minute as the agent', async () => {
    const limited = await startServer({ agentDownload: 1 }, { PLAYER_DOWNLOAD_DIR: dir });
    try {
      await publishLegacy();
      const cookie = await login(limited.app, ADMIN);
      const once = () => limited.app.inject({ url: '/api/admin/player/image', headers: { cookie } });
      expect((await once()).statusCode).toBe(200);
      expect((await once()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('image in three parts (format 2)', () => {
  it('gives the three parts one after the other as the generic .img.gz', async () => {
    await publishParts();
    const bytes = parts.reduce((n, p) => n + p.length, 0);
    expect(await info()).toEqual({
      available: true,
      version: '0.2.0',
      builtAt: '2026-10-27T10:00:00.000Z',
      bytes,
      sha256: sha(image),
      sha256Of: 'image',
      fileName: 'arenalive-player-0.2.0.img.gz',
      ready: true,
    });
    const res = await get('/api/admin/player/image', admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="arenalive-player-0.2.0.img.gz"');
    expect(res.headers['content-length']).toBe(String(bytes));
    expect(res.rawPayload.equals(Buffer.concat(parts))).toBe(true);
    expect(gunzipSync(res.rawPayload).equals(image)).toBe(true);
  });

  it('refuses a manifest with other names, a wrong sha256 or size, or a second part that is not the slot', async () => {
    const good = manifestOf();
    const goodParts = good.parts;
    const withPart = (i: number, over: Record<string, unknown>) =>
      manifestOf({ parts: goodParts.map((p, j) => (j === i ? { ...p, ...over } : p)) });
    for (const bad of [
      withPart(1, { file: '../arenalive-player.img.xz' }),
      withPart(2, { file: 'arenalive-player-image-1.gz' }),
      withPart(0, { sha256: 'f'.repeat(64) }),
      withPart(2, { size: (parts[2]?.length ?? 0) + 1 }),
      manifestOf({ slotOffset: SLOT_OFFSET + 100 }),
    ]) {
      await publishParts(bad);
      expect(await info()).toEqual({ available: false });
      expect((await get('/api/admin/player/image', admin)).statusCode).toBe(404);
    }
    // A second part of another size than the slot (sha256 and size of the manifest right).
    await publishParts();
    const short = gzipSync(Buffer.alloc(100));
    await writeFile(join(dir, PART_NAMES[1] ?? ''), short);
    await writeFile(join(dir, MANIFEST), JSON.stringify(withPart(1, { size: short.length, sha256: sha(short) })));
    expect(await info()).toEqual({ available: false });
  });

  it('gives an image ready for the player: the configuration in the slot, filled with spaces', async () => {
    await publishParts();
    const id = await newDisplay('Maxischermo Tribuna');
    const wifi = { ssid: 'Palestra', password: WIFI_PASSWORD, country: 'IT' };
    const t = await ticketOf(id, { wifi });
    expect(t.fileName).toBe('arenalive-player-maxischermo-tribuna-0.2.0.img.gz');
    expect(Date.parse(t.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    const res = await get(downloadUrl(t.ticket), admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/gzip');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${t.fileName}"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-length']).toBe(String(t.size));
    expect(res.rawPayload.length).toBe(t.size);
    const { config, slot } = slotOf(res.rawPayload);
    expect(config).toMatchObject({ version: 1, serverUrl: 'http://portale.test', name: 'Maxischermo Tribuna', wifi });
    const json = `${JSON.stringify(config, null, 2)}\n`;
    expect(slot.subarray(0, json.length).toString('utf8')).toBe(json);
    expect(slot.subarray(json.length).every((b) => b === 0x20)).toBe(true);
    // The token of the image works, the Wi-Fi password never reaches the database.
    expect((await heartbeat(config.token)).statusCode).toBe(200);
    expect(JSON.stringify(await server.database.db.select().from(displays))).not.toContain(WIFI_PASSWORD);
  });

  it('replaces the token as the file of the configuration, and the previous one stops working', async () => {
    await publishParts();
    const id = await newDisplay('Rotazione');
    const first = slotOf((await get(downloadUrl((await ticketOf(id)).ticket), admin)).rawPayload).config;
    expect((await heartbeat(first.token)).statusCode).toBe(200);
    const second = slotOf((await get(downloadUrl((await ticketOf(id)).ticket), admin)).rawPayload).config;
    expect(second.token).not.toBe(first.token);
    expect((await heartbeat(first.token)).statusCode).toBe(401);
    const [row] = await server.database.db.select().from(displays).where(eq(displays.id, id));
    expect(row?.tokenHash).toBe(sha(Buffer.from(second.token)));
  });

  it('gives a ticket that works once, only for the same user of the same client, until it expires', async () => {
    await publishParts();
    const id = await newDisplay('Biglietto');
    const t = await ticketOf(id);
    expect((await get(downloadUrl(t.ticket))).statusCode).toBe(401);
    expect((await get(downloadUrl(t.ticket), viewer)).statusCode).toBe(403);
    expect((await get(downloadUrl(t.ticket), otherAdmin)).statusCode).toBe(404);
    const foreign = await server.app.inject({ url: downloadUrl(t.ticket), headers: { cookie: adminB, host: HOST_B } });
    expect(foreign.statusCode).toBe(404);
    expect((await get(downloadUrl(t.ticket), admin)).statusCode).toBe(200);
    const again = await get(downloadUrl(t.ticket), admin);
    expect(again.statusCode).toBe(404);
    expect(again.json<{ error: string }>().error).toMatch(/scaduto o già usato/);
    expect((await get(downloadUrl('x'.repeat(43)), admin)).statusCode).toBe(404);
    expect((await get(downloadUrl('non valido!'), admin)).statusCode).toBe(400);

    const late = await ticketOf(id);
    server.setNow(new Date(Date.now() + 11 * 60_000));
    expect((await get(downloadUrl(late.ticket), admin)).statusCode).toBe(404);
  });

  it('refuses the download (410) once the player is revoked or has a newer configuration', async () => {
    await publishParts();
    const id = await newDisplay('Revocato');
    const t = await ticketOf(id);
    const newer = await ticketOf(id);
    expect((await get(downloadUrl(t.ticket), admin)).statusCode).toBe(410);
    expect(
      (await server.app.inject({ method: 'DELETE', url: `/api/admin/displays/${id}`, headers: { cookie: admin } }))
        .statusCode,
    ).toBe(204);
    const gone = await get(downloadUrl(newer.ticket), admin);
    expect(gone.statusCode).toBe(410);
    expect(gone.json<{ error: string }>().error).toMatch(/revocato/);
    expect((await prepare(id)).statusCode).toBe(404);
  });

  it('is for admins of the client of the player only, JSON only', async () => {
    await publishParts();
    const id = await newDisplay('Ruoli');
    expect(
      (await server.app.inject({ method: 'POST', url: `/api/admin/displays/${id}/image`, payload: {} })).statusCode,
    ).toBe(401);
    expect((await prepare(id, viewer)).statusCode).toBe(403);
    expect((await prepare(id, adminB, {}, HOST_B)).statusCode).toBe(404);
    const form = await server.app.inject({
      method: 'POST',
      url: `/api/admin/displays/${id}/image`,
      headers: { cookie: admin, 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1',
    });
    expect(form.statusCode).toBe(415);
    expect((await prepare(id, admin, { wifi: { ssid: 'x', password: 'corta', country: 'IT' } })).statusCode).toBe(400);
  });

  it('limits the downloads of the ready image per minute as the agent', async () => {
    const limited = await startServer({ agentDownload: 1 }, { PLAYER_DOWNLOAD_DIR: dir });
    try {
      await publishParts();
      const cookie = await login(limited.app, ADMIN);
      const res = await limited.app.inject({
        method: 'POST',
        url: '/api/admin/displays',
        headers: { cookie },
        payload: { name: 'L' },
      });
      const id = DisplaySummarySchema.parse(res.json()).id;
      const ticket = async () =>
        DisplayImageTicketSchema.parse(
          (
            await limited.app.inject({
              method: 'POST',
              url: `/api/admin/displays/${id}/image`,
              headers: { cookie },
              payload: {},
            })
          ).json(),
        ).ticket;
      const once = async () => limited.app.inject({ url: downloadUrl(await ticket()), headers: { cookie } });
      expect((await once()).statusCode).toBe(200);
      expect((await once()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});

describe('slot of the configuration', () => {
  const file: DisplayConfigFile = {
    version: 1,
    serverUrl: 'https://club.example.it',
    token: 'A'.repeat(43),
    name: 'P',
  };

  it('is the JSON followed by spaces, exactly 8 KiB', () => {
    const slot = configSlot(file);
    expect(slot?.length).toBe(PLAYER_IMAGE_SLOT_SIZE);
    expect(JSON.parse(slot?.toString('utf8') ?? '')).toEqual(file);
  });

  it('refuses a configuration that does not fit', () => {
    expect(configSlot({ ...file, name: 'x'.repeat(PLAYER_IMAGE_SLOT_SIZE) })).toBeNull();
  });
});

describe('tickets of the ready images', () => {
  const grant = () => ({
    tenantId: 't',
    userId: 'u',
    displayId: 'd',
    displayName: 'n',
    tokenHash: 'h',
    slot: Buffer.from('segreto'),
  });

  it('are used once, expire, and stay for the right user only', () => {
    let now = 0;
    const tickets = new DisplayImageTickets(() => now, 10, 1000);
    const { ticket, expiresAt } = tickets.issue(grant());
    expect(expiresAt.getTime()).toBe(1000);
    expect(tickets.take(ticket, 't', 'other')).toBeNull();
    expect(tickets.take(ticket, 'other', 'u')).toBeNull();
    expect(tickets.take(ticket, 't', 'u')).toMatchObject({ displayId: 'd' });
    expect(tickets.take(ticket, 't', 'u')).toBeNull();
    const late = grant();
    const second = tickets.issue(late).ticket;
    now = 1000;
    expect(tickets.take(second, 't', 'u')).toBeNull();
    expect(tickets.size).toBe(0);
    expect(late.slot.every((b) => b === 0)).toBe(true);
  });

  it('keep at most the limit, dropping the oldest', () => {
    const tickets = new DisplayImageTickets(() => 0, 2, 1000);
    const first = tickets.issue(grant()).ticket;
    tickets.issue(grant());
    tickets.issue(grant());
    expect(tickets.size).toBe(2);
    expect(tickets.take(first, 't', 'u')).toBeNull();
  });
});
