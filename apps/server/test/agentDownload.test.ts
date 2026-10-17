import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import type { AgentDownloadInfo, AssetSummary } from '@sir/shared';
import { AgentBrandingSchema, AgentDownloadInfoSchema } from '@sir/shared';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dosDateTime, isSafeEntryName, zipLayout, zipStream } from '../src/lib/zip.js';
import { readmeText } from '../src/routes/agentDownload.js';
import type { TestServer } from './helpers.js';
import { ADMIN, createTenant, createUser, login, startServer, SUPERADMIN } from './helpers.js';
import { jpeg, png, svg, webp } from './imageFixtures.js';

const HOST_A = 'a.sir.test';
const HOST_B = 'b.sir.test';
const HOST_LAN = '192.168.1.20';
const ADMIN_A = { email: 'admin-a@agente.test', password: 'password-admin-a' };
const VIEWER_A = { email: 'viewer-a@agente.test', password: 'password-viewer-a' };
const ADMIN_B = { email: 'admin-b@agente.test', password: 'password-admin-b' };

interface ZipItem {
  name: string;
  data: Buffer;
  crc: number;
  method: number;
}

/**
 * Independent reader of the test: end record → central directory → local headers, checking signatures, sizes and
 * CRC of every entry (throws on any inconsistency).
 */
function readZip(zip: Buffer): ZipItem[] {
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('end record missing');
  const count = zip.readUInt16LE(end + 10);
  const centralSize = zip.readUInt32LE(end + 12);
  let at = zip.readUInt32LE(end + 16);
  if (at + centralSize !== end) throw new Error('central directory size');
  const items: ZipItem[] = [];
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error('central header');
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const size = zip.readUInt32LE(at + 20);
    if (zip.readUInt32LE(at + 24) !== size) throw new Error('stored sizes differ');
    const nameLength = zip.readUInt16LE(at + 28);
    const extra = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extra;
    if (zip.readUInt32LE(offset) !== 0x04034b50) throw new Error('local header');
    const localName = zip.toString('utf8', offset + 30, offset + 30 + zip.readUInt16LE(offset + 26));
    if (localName !== name || zip.readUInt32LE(offset + 14) !== crc || zip.readUInt32LE(offset + 18) !== size) {
      throw new Error(`local header of ${name} differs`);
    }
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const data = zip.subarray(start, start + size);
    if (crc32(data) >>> 0 !== crc) throw new Error(`crc of ${name}`);
    items.push({ name, data, crc, method });
  }
  return items;
}

const python = (() => {
  try {
    execFileSync('python3', ['-I', '-c', 'import zipfile'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let server: TestServer;
let downloadDir: string;
let tenantLan: string;
let cookieA: string;
let cookieViewerA: string;
let cookieB: string;
let cookieSuper: string;
const EXE = randomBytes(600 * 1024 + 123);
const RELEASE = {
  version: '1.2.3-abc1234',
  builtAt: '2026-10-16T08:30:00.000Z',
  sha256: createHash('sha256').update(EXE).digest('hex'),
};

function call(host: string, cookie: string | null, options: InjectOptions) {
  return server.app.inject({ ...options, headers: { host, ...(cookie ? { cookie } : {}), ...options.headers } });
}

const info = async (host = HOST_A, cookie = cookieA): Promise<AgentDownloadInfo> => {
  const res = await call(host, cookie, { url: '/api/admin/agent/info' });
  expect(res.statusCode).toBe(200);
  return AgentDownloadInfoSchema.parse(res.json());
};

const download = (host = HOST_A, cookie = cookieA) => call(host, cookie, { url: '/api/admin/agent/download' });

async function downloadItems(host = HOST_A, cookie = cookieA): Promise<Map<string, ZipItem>> {
  const res = await download(host, cookie);
  expect(res.statusCode).toBe(200);
  return new Map(readZip(res.rawPayload).map((item) => [item.name, item]));
}

const jsonOf = (items: Map<string, ZipItem>, name: string): Record<string, unknown> =>
  JSON.parse(items.get(`SIRRealtime-agente/${name}`)?.data.toString('utf8') ?? 'null') as Record<string, unknown>;

async function publish(exe = EXE, release: object = RELEASE): Promise<void> {
  await writeFile(join(downloadDir, 'sir-agent.exe'), exe);
  await writeFile(join(downloadDir, 'sir-agent.json'), JSON.stringify(release));
}

async function setLogos(host: string, cookie: string, logos: { logoMain?: Buffer; logoMark?: Buffer }): Promise<void> {
  const ids: Record<string, string | null> = { logoMain: null, logoMark: null };
  for (const [slot, data] of Object.entries(logos)) {
    const res = await call(host, cookie, {
      method: 'POST',
      url: '/api/admin/assets',
      payload: { kind: 'logo', data: data.toString('base64') },
    });
    expect(res.statusCode).toBeLessThan(300);
    ids[slot] = res.json<AssetSummary>().id;
  }
  const put = await call(host, cookie, {
    method: 'PUT',
    url: '/api/admin/branding',
    payload: { displayName: 'Club A Volley', colors: { primary: '#FFEB3B' }, ...ids },
  });
  expect(put.statusCode).toBe(200);
}

beforeAll(async () => {
  downloadDir = mkdtempSync(join(tmpdir(), 'sir-downloads-'));
  server = await startServer({}, { AGENT_DOWNLOAD_DIR: downloadDir });
  const tenantA = await createTenant(server, 'club-a', [HOST_A]);
  const tenantB = await createTenant(server, 'club-b', [HOST_B]);
  tenantLan = await createTenant(server, 'palestra', [HOST_LAN]);
  await createUser(server, ADMIN_A, 'admin', tenantA);
  await createUser(server, VIEWER_A, 'viewer', tenantA);
  await createUser(server, ADMIN_B, 'admin', tenantB);
  cookieA = await login(server.app, ADMIN_A, HOST_A);
  cookieViewerA = await login(server.app, VIEWER_A, HOST_A);
  cookieB = await login(server.app, ADMIN_B, HOST_B);
  cookieSuper = await login(server.app, SUPERADMIN, HOST_A);
});
afterAll(async () => {
  await server.close();
  rmSync(downloadDir, { recursive: true, force: true });
});
beforeEach(() => {
  rmSync(join(downloadDir, 'sir-agent.exe'), { force: true });
  rmSync(join(downloadDir, 'sir-agent.json'), { force: true });
});

describe('agente scaricabile: disponibilità', () => {
  it('cartella vuota: non disponibile, il download è 404 con il messaggio', async () => {
    expect(await info()).toEqual({ available: false });
    const res = await download();
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'L’agente non è ancora stato pubblicato sul server' });
  });

  it('pubblicato: versione, data, dimensione e nome dello zip del cliente, senza cache', async () => {
    await publish();
    const res = await call(HOST_A, cookieA, { url: '/api/admin/agent/info' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      available: true,
      version: RELEASE.version,
      builtAt: RELEASE.builtAt,
      bytes: EXE.length,
      sha256: RELEASE.sha256,
      fileName: 'SIRRealtime-agente-club-a-1.2.3-abc1234.zip',
    });
  });

  it('exe diverso dallo sha256 di sir-agent.json, json non valido o solo uno dei due: non disponibile', async () => {
    await publish(Buffer.from('altro eseguibile'));
    expect(await info()).toEqual({ available: false });
    expect((await download()).statusCode).toBe(404);
    await publish(EXE, { ...RELEASE, version: '../../etc' });
    expect(await info()).toEqual({ available: false });
    await writeFile(join(downloadDir, 'sir-agent.json'), '{ rotto');
    expect(await info()).toEqual({ available: false });
    rmSync(join(downloadDir, 'sir-agent.json'));
    expect(await info()).toEqual({ available: false });
  });

  it('solo admin: viewer 403, senza sessione 401', async () => {
    await publish();
    expect((await call(HOST_A, cookieViewerA, { url: '/api/admin/agent/info' })).statusCode).toBe(403);
    expect((await download(HOST_A, cookieViewerA)).statusCode).toBe(403);
    expect((await call(HOST_A, null, { url: '/api/admin/agent/download' })).statusCode).toBe(401);
  });
});

describe('agente scaricabile: lo zip del cliente', () => {
  it('zip valido con exe, config.json, branding.json e LEGGIMI.txt; intestazioni di download', async () => {
    await publish();
    const res = await download();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="SIRRealtime-agente-club-a-1.2.3-abc1234.zip"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    const items = readZip(res.rawPayload);
    expect(items.map((i) => i.name)).toEqual([
      'SIRRealtime-agente/sir-agent.exe',
      'SIRRealtime-agente/config.json',
      'SIRRealtime-agente/branding.json',
      'SIRRealtime-agente/LEGGIMI.txt',
    ]);
    expect(items.every((i) => i.method === 0)).toBe(true);
    expect(items[0]?.data.equals(EXE)).toBe(true);
    const readme = items[3]?.data.toString('utf8') ?? '';
    expect(readme).toContain('Ulteriori informazioni');
    expect(readme).toContain('Esegui comunque');
    expect(readme.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it.skipIf(!python)('un lettore indipendente (zipfile di Python) lo trova integro', async () => {
    // Skipped only where python3 is missing: the reader of this file checks the same structure.
    await publish();
    const res = await download();
    const file = join(downloadDir, 'prova.zip');
    await writeFile(file, res.rawPayload);
    const out = execFileSync('python3', [
      '-I',
      '-c',
      'import sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))',
      file,
    ]).toString();
    rmSync(file);
    expect(out.trim().split('\n')).toEqual(['None', '4']);
  });

  it('config.json col server del cliente e senza token: A e B diversi', async () => {
    await publish();
    const a = jsonOf(await downloadItems(), 'config.json');
    const b = jsonOf(await downloadItems(HOST_B, cookieB), 'config.json');
    expect(a).toEqual({
      watchPath: 'E:\\',
      serverUrl: 'http://a.sir.test',
      dataDir: 'C:\\SIRAgent\\data',
      logDir: 'C:\\SIRAgent\\logs',
    });
    expect(b['serverUrl']).toBe('http://b.sir.test');
    for (const config of [a, b]) {
      expect(config).not.toHaveProperty('agentToken');
      expect(config).not.toHaveProperty('allowHttpPrivateNetwork');
    }
  });

  it('superadmin sul cliente attivo; http verso un IP privato: allowHttpPrivateNetwork', async () => {
    await publish();
    const select = await call(HOST_A, cookieSuper, {
      method: 'POST',
      url: '/api/admin/active-tenant',
      payload: { tenantId: tenantLan },
    });
    expect(select.statusCode).toBe(200);
    const res = await download(HOST_A, cookieSuper);
    expect(res.headers['content-disposition']).toContain('SIRRealtime-agente-palestra-');
    const items = new Map(readZip(res.rawPayload).map((i) => [i.name, i]));
    expect(jsonOf(items, 'config.json')).toMatchObject({
      serverUrl: 'http://192.168.1.20',
      allowHttpPrivateNetwork: true,
    });
    expect(jsonOf(items, 'branding.json')).toMatchObject({ name: 'PALESTRA' });
  });

  it('branding.json con il nome e i colori validati del cliente; isolamento tra clienti', async () => {
    await publish();
    await setLogos(HOST_A, cookieA, {});
    const a = AgentBrandingSchema.parse(jsonOf(await downloadItems(), 'branding.json'));
    expect(a).toMatchObject({ name: 'Club A Volley', colors: { primary: '#ffeb3b', onPrimary: '#000000' } });
    for (const color of Object.values(a.colors)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    const b = AgentBrandingSchema.parse(jsonOf(await downloadItems(HOST_B, cookieB), 'branding.json'));
    expect(b.name).toBe('CLUB-B');
    expect(b.colors.primary).not.toBe('#ffeb3b');
  });

  it('branding.json: i colori mancanti vengono dal template del cliente (SIR VOLLEY: finestra scura e rossa)', async () => {
    await publish();
    const put = await call(HOST_B, cookieB, {
      method: 'PUT',
      url: '/api/admin/branding',
      payload: { template: 'sir-volley', colors: {} },
    });
    expect(put.statusCode).toBe(200);
    const b = AgentBrandingSchema.parse(jsonOf(await downloadItems(HOST_B, cookieB), 'branding.json'));
    expect(b.colors).toMatchObject({ primary: '#e30613', background: '#0b0b0d', onBackground: '#ffffff' });
    await call(HOST_B, cookieB, { method: 'PUT', url: '/api/admin/branding', payload: {} });
  });

  it('logo: PNG o JPEG incluso col suo nome; SVG, WebP o troppo grande no', async () => {
    await publish();
    const logo = png(240, 80);
    await setLogos(HOST_A, cookieA, { logoMain: logo });
    let items = await downloadItems();
    expect(items.get('SIRRealtime-agente/logo.png')?.data.equals(logo)).toBe(true);

    const mark = jpeg(64, 64);
    await setLogos(HOST_A, cookieA, { logoMain: svg('<rect width="10" height="10"/>'), logoMark: mark });
    items = await downloadItems();
    expect(items.has('SIRRealtime-agente/logo.png')).toBe(false);
    expect(items.get('SIRRealtime-agente/logo.jpg')?.data.equals(mark)).toBe(true);

    await setLogos(HOST_A, cookieA, { logoMain: webp(64, 64), logoMark: png(1500, 20) });
    items = await downloadItems();
    expect([...items.keys()].some((name) => /logo\./.test(name))).toBe(false);
    // B never gets the logo of A.
    expect([...(await downloadItems(HOST_B, cookieB)).keys()].some((name) => /logo\./.test(name))).toBe(false);
  });
});

describe('agente scaricabile: limite dei download', () => {
  it('oltre RATE_LIMIT_AGENT_DOWNLOAD al minuto: 429 (le altre rotte admin no)', async () => {
    const limited = await startServer({ agentDownload: 2 }, { AGENT_DOWNLOAD_DIR: downloadDir });
    try {
      await publish();
      const admin = await login(limited.app, ADMIN);
      const get = (url: string) => limited.app.inject({ url, headers: { cookie: admin } });
      expect((await get('/api/admin/agent/download')).statusCode).toBe(200);
      expect((await get('/api/admin/agent/download')).statusCode).toBe(200);
      expect((await get('/api/admin/agent/download')).statusCode).toBe(429);
      expect((await get('/api/admin/agent/info')).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe('writer zip', () => {
  it('data e ora MS-DOS in UTC', () => {
    expect(dosDateTime(new Date('2026-10-16T08:30:15Z'))).toEqual({
      time: (8 << 11) | (30 << 5) | 7,
      date: ((2026 - 1980) << 9) | (10 << 5) | 16,
    });
    expect(dosDateTime(new Date('1970-01-01T00:00:00Z')).date).toBe((1 << 5) | 1);
  });

  it('rifiuta nomi pericolosi o ripetuti', () => {
    for (const name of ['', '/assoluto', 'a/../b', 'a\\b', 'a//b', './a', 'riga\na']) {
      expect(isSafeEntryName(name)).toBe(false);
    }
    expect(isSafeEntryName('SIRRealtime-agente/config.json')).toBe(true);
    const entry = { name: 'a.txt', data: Buffer.from('a') };
    expect(() => zipLayout([entry, entry], new Date())).toThrow(/nome non valido/);
    expect(() => zipLayout([{ name: '../x', data: Buffer.alloc(0) }], new Date())).toThrow();
  });

  it('dimensione annunciata uguale ai byte prodotti; file chiuso anche se lo stream è distrutto subito', async () => {
    const path = join(downloadDir, 'dati.bin');
    const content = randomBytes(300_000);
    await writeFile(path, content);
    const handle = await open(path, 'r');
    let closed = 0;
    const zip = zipStream(
      [
        { name: 'vuoto.txt', data: Buffer.alloc(0) },
        { name: 'dati.bin', file: handle, size: content.length, crc32: crc32(content) },
      ],
      new Date('2026-01-01T00:00:00Z'),
      async () => {
        closed++;
        await handle.close();
      },
    );
    const chunks: Buffer[] = [];
    for await (const chunk of zip.stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBe(zip.size);
    expect(readZip(bytes).map((i) => i.data.length)).toEqual([0, content.length]);
    expect(closed).toBe(1);

    const other = await open(path, 'r');
    let otherClosed = 0;
    const destroyed = zipStream(
      [{ name: 'dati.bin', file: other, size: content.length, crc32: crc32(content) }],
      new Date(),
      async () => {
        otherClosed++;
        await other.close();
      },
    );
    destroyed.stream.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(otherClosed).toBe(1);
    rmSync(path);
  });

  it('LEGGIMI.txt con passi, avviso SmartScreen e righe Windows', () => {
    const text = readmeText({ name: 'Club A', serverUrl: 'https://a.sir.it', release: RELEASE });
    expect(text).toContain('Cliente:  Club A');
    expect(text).toContain('C:\\SIRAgent');
    expect(text).toContain('pennina');
    expect(text.split('\r\n').length).toBeGreaterThan(10);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});
