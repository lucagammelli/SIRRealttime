import type { AssetSummary, GraphicsExport, OverlaysResponse } from '@arenalive/shared';
import {
  ASSET_NAME_MAX,
  defaultOverlays,
  FILE_NAME_HEADER,
  publicAssetPath,
  VIDEO_MAX_BYTES,
  VIDEO_UPLOAD_PATH,
} from '@arenalive/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { createTenant, createUser, login, startServer } from './helpers.js';
import { png } from './imageFixtures.js';
import { mp4, webm } from './videoFixtures.js';

const HOST_A = 'a.sir.test';
const HOST_B = 'b.sir.test';
const ADMIN_A = { email: 'admin-a@sir.test', password: 'password-admin-a' };
const VIEWER_A = { email: 'viewer-a@sir.test', password: 'password-viewer-a' };
const ADMIN_B = { email: 'admin-b@sir.test', password: 'password-admin-b' };

let server: TestServer;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;

function call(on: TestServer, host: string, cookie: string | null, options: InjectOptions) {
  return on.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });
}

const uploadVideo = (
  host: string,
  cookie: string | null,
  data: Buffer,
  on = server,
  type = 'application/octet-stream',
) =>
  call(on, host, cookie, { method: 'POST', url: VIDEO_UPLOAD_PATH, headers: { 'content-type': type }, payload: data });

const uploadImage = (host: string, cookie: string, data: Buffer, kind = 'overlay') =>
  call(server, host, cookie, {
    method: 'POST',
    url: '/api/admin/assets',
    payload: { kind, data: data.toString('base64') },
  });

const putOverlays = (host: string, cookie: string, payload: unknown) =>
  call(server, host, cookie, {
    method: 'PUT',
    url: '/api/admin/overlays',
    payload: payload as Record<string, unknown>,
  });

beforeAll(async () => {
  server = await startServer();
  const tenantA = await createTenant(server, 'club-a', [HOST_A]);
  const tenantB = await createTenant(server, 'club-b', [HOST_B]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
});
afterAll(() => server.close());

describe('upload of a video', () => {
  it('stores an MP4 and a WebM as files for the overlays; the same file again is the same video', async () => {
    const first = await uploadVideo(HOST_A, cookieA, mp4(1280, 720));
    expect(first.statusCode).toBe(201);
    expect(first.json<AssetSummary>()).toMatchObject({ kind: 'overlay', mime: 'video/mp4', width: 1280, height: 720 });
    const again = await uploadVideo(HOST_A, cookieA, mp4(1280, 720));
    expect(again.statusCode).toBe(200);
    expect(again.json<AssetSummary>().id).toBe(first.json<AssetSummary>().id);
    const other = await uploadVideo(HOST_A, cookieA, webm(640, 360));
    expect(other.statusCode).toBe(201);
    expect(other.json<AssetSummary>()).toMatchObject({ kind: 'overlay', mime: 'video/webm', width: 640, height: 360 });
  });

  it('refuses a file that is not a video (422), whatever its type, and one too large (413)', async () => {
    for (const file of [png(10, 10), Buffer.from('<html><script>alert(1)</script></html>'), mp4(10, 10, 8, ['3gp4'])]) {
      const res = await uploadVideo(HOST_A, cookieA, file);
      expect(res.statusCode).toBe(422);
      expect(res.json<{ error: string }>().error).toContain('MP4, MOV o WebM');
    }
    const big = await uploadVideo(HOST_A, cookieA, mp4(10, 10, VIDEO_MAX_BYTES));
    expect(big.statusCode).toBe(413);
    expect(big.json<{ error: string }>().error).toContain('15 MB');
  });

  it('is for admins only, as bytes from an allowed origin', async () => {
    expect((await uploadVideo(HOST_A, cookieViewerA, mp4(10, 10))).statusCode).toBe(403);
    expect((await uploadVideo(HOST_A, null, mp4(10, 10))).statusCode).toBe(401);
    expect((await uploadVideo(HOST_A, cookieA, mp4(10, 10), server, 'video/mp4')).statusCode).toBe(415);
    const json = await call(server, HOST_A, cookieA, { method: 'POST', url: VIDEO_UPLOAD_PATH, payload: { a: 1 } });
    expect(json.statusCode).toBe(415);
    const foreign = await call(server, HOST_A, cookieA, {
      method: 'POST',
      url: VIDEO_UPLOAD_PATH,
      headers: { 'content-type': 'application/octet-stream', origin: 'https://evil.example' },
      payload: mp4(10, 10),
    });
    expect(foreign.statusCode).toBe(403);
    // The other admin routes still take JSON only.
    const binary = await call(server, HOST_A, cookieA, {
      method: 'PUT',
      url: '/api/admin/overlays',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('{}'),
    });
    expect(binary.statusCode).toBe(415);
  });

  it('applies the quota of the client (409)', async () => {
    const small = await startServer({}, { ASSETS_QUOTA_MB: '1' });
    try {
      const id = await createTenant(small, 'club-q', ['q.sir.test']);
      const who = { email: 'q@sir.test', password: 'password-quota-1' };
      await createUser(small, who, 'admin', id);
      const cookie = await login(small.app, who, 'q.sir.test');
      expect((await uploadVideo('q.sir.test', cookie, mp4(10, 10, 600_000), small)).statusCode).toBe(201);
      const over = await uploadVideo('q.sir.test', cookie, mp4(20, 10, 600_000), small);
      expect(over.statusCode).toBe(409);
      expect(over.json<{ error: string }>().error).toContain(
        'Spazio per i file esaurito (1 MB): elimina quelli che non usi',
      );
    } finally {
      await small.close();
    }
  });
});

describe('names of the files', () => {
  const named = (name: string, data: Buffer, host = HOST_A, cookie = cookieA) =>
    call(server, host, cookie, {
      method: 'POST',
      url: VIDEO_UPLOAD_PATH,
      headers: { 'content-type': 'application/octet-stream', [FILE_NAME_HEADER]: name },
      payload: data,
    });
  const patch = (id: string, payload: Record<string, unknown>, cookie = cookieA) =>
    call(server, HOST_A, cookie, { method: 'PATCH', url: `/api/admin/assets/${id}`, payload });

  it('keeps the name of an uploaded video and of an image; without a name the file has none', async () => {
    const video = await named(encodeURIComponent('Sigla ACE è.mp4'), mp4(1920, 1080, 501));
    expect(video.statusCode).toBe(201);
    expect(video.json<AssetSummary>().name).toBe('Sigla ACE è.mp4');
    const image = await call(server, HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'overlay', data: png(51, 20).toString('base64'), name: 'muro.png' },
    });
    expect(image.json<AssetSummary>().name).toBe('muro.png');
    const plain = await uploadVideo(HOST_A, cookieA, mp4(1920, 1080, 502));
    expect(plain.json<AssetSummary>().name).toBeNull();
    // The same file again with a name: a file without name takes it, one with a name keeps its own.
    expect((await named('nuovo.mp4', mp4(1920, 1080, 502))).json<AssetSummary>().name).toBe('nuovo.mp4');
    expect((await named('altro.mp4', mp4(1920, 1080, 502))).json<AssetSummary>().name).toBe('nuovo.mp4');
    const list = (await call(server, HOST_A, cookieA, { url: '/api/admin/assets' })).json<{ assets: AssetSummary[] }>();
    expect(list.assets.find((a) => a.id === video.json<AssetSummary>().id)?.name).toBe('Sigla ACE è.mp4');
  });

  it('refuses a name that is a path, has control characters, is too long or cannot be decoded (400)', async () => {
    for (const bad of [
      encodeURIComponent('../../etc/passwd'),
      encodeURIComponent('a\\b.mp4'),
      encodeURIComponent('a\u0000b.mp4'),
      encodeURIComponent('x'.repeat(ASSET_NAME_MAX + 1)),
      '%E0%A4%A',
      encodeURIComponent('   '),
    ]) {
      const res = await named(bad, mp4(16, 16, 503));
      expect(res.statusCode, bad).toBe(400);
    }
    const image = await call(server, HOST_A, cookieA, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'overlay', data: png(52, 20).toString('base64'), name: 'a/b.png' },
    });
    expect(image.statusCode).toBe(400);
  });

  it('renames a file (admins only, own files), also back to no name', async () => {
    const video = (await uploadVideo(HOST_A, cookieA, mp4(800, 450, 504))).json<AssetSummary>();
    const renamed = await patch(video.id, { name: '  Video del muro  ' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<AssetSummary>()).toMatchObject({ name: 'Video del muro', sponsorId: null });
    expect((await patch(video.id, { name: null })).json<AssetSummary>().name).toBeNull();
    expect((await patch(video.id, { name: 'a/b' })).statusCode).toBe(400);
    expect((await patch(video.id, {})).statusCode).toBe(400);
    expect((await patch(video.id, { name: 'x' }, cookieViewerA)).statusCode).toBe(403);
    const other = await call(server, HOST_B, cookieB, {
      method: 'PATCH',
      url: `/api/admin/assets/${video.id}`,
      payload: { name: 'mio' },
    });
    expect(other.statusCode).toBe(404);
  });
});

describe('backgrounds of the overlays', () => {
  it('saves own backgrounds of the right kind; refuses a wrong kind, a file of another client or not for overlays', async () => {
    const video = (await uploadVideo(HOST_A, cookieA, webm(320, 180, 99))).json<AssetSummary>();
    const image = (await uploadImage(HOST_A, cookieA, png(40, 20))).json<AssetSummary>();
    expect(image.kind).toBe('overlay');
    const logo = (await uploadImage(HOST_A, cookieA, png(41, 20), 'logo')).json<AssetSummary>();
    const videoB = (await uploadVideo(HOST_B, cookieB, mp4(330, 180, 77))).json<AssetSummary>();
    const doc = (background: unknown, kind = 'ace') => ({
      ...defaultOverlays(),
      [kind]: { ...defaultOverlays().ace, background },
    });

    const saved = await putOverlays(HOST_A, cookieA, {
      ...doc({ kind: 'video', assetId: video.id }),
      block: { ...defaultOverlays().block, background: { kind: 'image', assetId: image.id } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<OverlaysResponse>().overlays.ace.background).toEqual({
      kind: 'video',
      assetId: video.id,
      audio: false,
      fit: 'center',
      teams: 'ours',
      duration: 'seconds',
    });
    const withOptions = await putOverlays(HOST_A, cookieA, {
      ...doc({ kind: 'video', assetId: video.id, audio: true, fit: 'fullscreen', teams: 'both' }),
      block: { ...defaultOverlays().block, background: { kind: 'image', assetId: image.id } },
    });
    expect(withOptions.json<OverlaysResponse>().overlays.ace.background).toMatchObject({
      audio: true,
      fit: 'fullscreen',
      teams: 'both',
    });
    for (const background of [
      { kind: 'image', assetId: video.id },
      { kind: 'video', assetId: image.id },
      { kind: 'video', assetId: videoB.id },
      { kind: 'image', assetId: logo.id },
      { kind: 'image', assetId: '00000000-0000-4000-8000-000000000000' },
    ]) {
      const res = await putOverlays(HOST_A, cookieA, doc(background, 'tie'));
      expect(res.statusCode).toBe(400);
    }
    // The page reads them from the public graphics; a video is not an image of a sponsor block.
    const tenant = await call(server, HOST_A, null, { url: '/api/public/tenant' });
    expect(tenant.json<{ overlays: OverlaysResponse['overlays'] }>().overlays.block.background?.assetId).toBe(image.id);

    // In use: not deleted.
    const del = await call(server, HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/assets/${video.id}` });
    expect(del.statusCode).toBe(409);
    expect(del.json<{ error: string }>().error).toContain('sfondo di un avviso');

    // The package of the graphics carries no backgrounds.
    const pkg = (await call(server, HOST_A, cookieA, { url: '/api/admin/branding/export' })).json<GraphicsExport>();
    expect(pkg.overlays.ace.background).toBeUndefined();
    expect(pkg.images).toHaveLength(0);

    await putOverlays(HOST_A, cookieA, defaultOverlays());
    expect(
      (await call(server, HOST_A, cookieA, { method: 'DELETE', url: `/api/admin/assets/${video.id}` })).statusCode,
    ).toBe(204);
  });
});

describe('serving a video', () => {
  it('sends the whole file or a byte range (206), with a fixed type, nosniff and an immutable cache', async () => {
    const file = webm(200, 100, 5000);
    const video = (await uploadVideo(HOST_A, cookieA, file)).json<AssetSummary>();
    const whole = await call(server, HOST_A, null, { url: publicAssetPath(video.id) });
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('video/webm');
    expect(whole.headers['x-content-type-options']).toBe('nosniff');
    expect(whole.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(whole.headers['accept-ranges']).toBe('bytes');
    expect(whole.rawPayload.equals(file)).toBe(true);

    const range = (value: string) =>
      call(server, HOST_A, null, { url: publicAssetPath(video.id), headers: { range: value } });
    const part = await range('bytes=0-99');
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${file.length}`);
    expect(part.rawPayload.equals(file.subarray(0, 100))).toBe(true);
    const tail = await range('bytes=-10');
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.equals(file.subarray(file.length - 10))).toBe(true);
    const open = await range(`bytes=${file.length - 5}-`);
    expect(open.headers['content-range']).toBe(`bytes ${file.length - 5}-${file.length - 1}/${file.length}`);
    const outside = await range(`bytes=${file.length}-`);
    expect(outside.statusCode).toBe(416);
    expect(outside.headers['content-range']).toBe(`bytes */${file.length}`);
    // Not understood (several ranges): the whole file.
    expect((await range('bytes=0-1,5-9')).statusCode).toBe(200);
    // Another client: never.
    expect((await call(server, HOST_B, null, { url: publicAssetPath(video.id) })).statusCode).toBe(404);
  });
});
