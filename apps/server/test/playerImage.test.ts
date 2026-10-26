import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlayerImageInfoSchema } from '@arenalive/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TestServer } from './helpers.js';
import { ADMIN, login, startServer, VIEWER } from './helpers.js';

let server: TestServer;
let admin: string;
let viewer: string;
let dir: string;
const image = randomBytes(200_000);
const sha256 = createHash('sha256').update(image).digest('hex');

const get = (url: string, cookie?: string) => server.app.inject({ url, ...(cookie ? { headers: { cookie } } : {}) });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'sir-player-img-'));
  server = await startServer({}, { PLAYER_DOWNLOAD_DIR: dir });
  admin = await login(server.app, ADMIN);
  viewer = await login(server.app, VIEWER);
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await rm(join(dir, 'arenalive-player.img.xz'), { force: true });
  await rm(join(dir, 'arenalive-player-image.json'), { force: true });
});

async function publish(manifestSha = sha256): Promise<void> {
  await writeFile(join(dir, 'arenalive-player.img.xz'), image);
  await writeFile(
    join(dir, 'arenalive-player-image.json'),
    JSON.stringify({ version: '0.1.0', builtAt: '2026-10-26T10:00:00.000Z', sha256: manifestSha, size: image.length }),
  );
}

describe('image of the SD card of the players', () => {
  it('says it is not available until it is published, and the download is a 404', async () => {
    const info = await get('/api/admin/player/image/info', admin);
    expect(info.statusCode).toBe(200);
    expect(info.json()).toEqual({ available: false });
    const res = await get('/api/admin/player/image', admin);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Immagine non ancora pubblicata sul server' });
  });

  it('offers nothing when the manifest does not describe the file', async () => {
    await publish('f'.repeat(64));
    expect((await get('/api/admin/player/image/info', admin)).json()).toEqual({ available: false });
  });

  it('gives version, size and sha256, then the file as an attachment', async () => {
    await publish();
    const info = PlayerImageInfoSchema.parse((await get('/api/admin/player/image/info', admin)).json());
    expect(info).toEqual({
      available: true,
      version: '0.1.0',
      builtAt: '2026-10-26T10:00:00.000Z',
      bytes: image.length,
      sha256,
      fileName: 'arenalive-player-0.1.0.img.xz',
    });
    const res = await get('/api/admin/player/image', admin);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="arenalive-player-0.1.0.img.xz"');
    expect(res.headers['content-length']).toBe(String(image.length));
    expect(res.headers['content-type']).toBe('application/x-xz');
    expect(res.rawPayload.equals(image)).toBe(true);
  });

  it('is for admins only', async () => {
    await publish();
    expect((await get('/api/admin/player/image/info')).statusCode).toBe(401);
    expect((await get('/api/admin/player/image')).statusCode).toBe(401);
    expect((await get('/api/admin/player/image/info', viewer)).statusCode).toBe(403);
    expect((await get('/api/admin/player/image', viewer)).statusCode).toBe(403);
  });

  it('limits the downloads per minute as the agent', async () => {
    const limited = await startServer({ agentDownload: 1 }, { PLAYER_DOWNLOAD_DIR: dir });
    try {
      await publish();
      const cookie = await login(limited.app, ADMIN);
      const once = () => limited.app.inject({ url: '/api/admin/player/image', headers: { cookie } });
      expect((await once()).statusCode).toBe(200);
      expect((await once()).statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
