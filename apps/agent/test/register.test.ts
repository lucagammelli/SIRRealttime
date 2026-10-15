import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PendingRegistration } from '../src/register.js';
import {
  RegistrationClient,
  RegistrationError,
  clearPendingRegistration,
  loadPendingRegistration,
  registrationFile,
  registrationStatusUrl,
  registrationsUrl,
  savePendingRegistration,
} from '../src/register.js';
import type { FetchLike } from '../src/sender.js';
import { tempDirs } from './support.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

const SECRET = 'segreto_' + 's'.repeat(35);
const TOKEN = 'tokenagente_' + 't'.repeat(31);
const CREATED = {
  registrationId: '6f1d3c1e-8a4b-4f7e-9d2a-1b2c3d4e5f60',
  secret: SECRET,
  pairingCode: 'K7MP3Q',
  expiresAt: '2026-10-16T10:00:00.000Z',
};

interface Call {
  url: string;
  init: RequestInit;
}

/** Fetch that answers with `status` and `body`, recording the requests. */
function fakeFetch(status: number, body: unknown): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status, headers: { 'content-type': 'application/json' } }));
  };
  return { fetch: fetchImpl, calls };
}

async function rejection(promise: Promise<unknown>): Promise<RegistrationError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof RegistrationError) return err;
    throw err;
  }
  throw new Error('nessun errore');
}

describe('client della registrazione', () => {
  it('URL con il percorso base di serverUrl', () => {
    expect(registrationsUrl('https://sir.example.it')).toBe('https://sir.example.it/api/agents/registrations');
    expect(registrationStatusUrl('https://sir.example.it/base/')).toBe(
      'https://sir.example.it/base/api/agents/registrations/status',
    );
  });

  it('201: risposta validata; corpo JSON con il nome ripulito, nessun Origin', async () => {
    const f = fakeFetch(201, CREATED);
    const client = new RegistrationClient({ serverUrl: 'https://sir.example.it/base', fetch: f.fetch });
    await expect(client.create('  PC campo 1 ')).resolves.toEqual(CREATED);
    const call = f.calls[0];
    expect(call?.url).toBe('https://sir.example.it/base/api/agents/registrations');
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({ 'content-type': 'application/json' });
    expect(call?.init.body).toBe('{"name":"PC campo 1"}');
  });

  it('nome non valido: errore prima di chiamare il server', async () => {
    const f = fakeFetch(201, CREATED);
    const client = new RegistrationClient({ serverUrl: 'https://sir.example.it', fetch: f.fetch });
    const err = await rejection(client.create('a\tb'));
    expect(err.code).toBe('INVALID_REQUEST');
    expect((await rejection(client.create('x'.repeat(101)))).code).toBe('INVALID_REQUEST');
    expect(f.calls).toHaveLength(0);
  });

  it.each([
    [429, {}, 'RATE_LIMITED', /Troppe richieste/],
    [401, {}, 'UNAUTHORIZED', /non riconosciuta/],
    [500, {}, 'HTTP', /HTTP 500/],
    [404, {}, 'HTTP', /404/],
    [201, { ...CREATED, pairingCode: 'O0O0O0' }, 'INVALID_RESPONSE', /non valida/],
    [201, '<html>', 'INVALID_RESPONSE', /non valida/],
  ])('creazione con risposta %i: errore %s', async (status, body, code, message) => {
    const client = new RegistrationClient({
      serverUrl: 'https://sir.example.it',
      fetch: fakeFetch(status, body).fetch,
    });
    const err = await rejection(client.create('PC'));
    expect(err.code).toBe(code);
    expect(err.message).toMatch(message);
  });

  it('errore di rete: codice NETWORK, messaggio in italiano', async () => {
    const client = new RegistrationClient({
      serverUrl: 'https://sir.example.it',
      fetch: () => Promise.reject(new Error('connect ECONNREFUSED')),
    });
    const err = await rejection(client.status(SECRET));
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/Server non raggiungibile: connect ECONNREFUSED/);
  });

  it.each([
    { status: 'pending', expiresAt: CREATED.expiresAt },
    { status: 'approved', token: TOKEN, agentId: '0b6f1d3c-8a4b-4f7e-9d2a-1b2c3d4e5f61' },
    { status: 'consumed' },
    { status: 'rejected' },
    { status: 'expired' },
  ])('stato $status: segreto solo in Authorization, corpo {}', async (body) => {
    const f = fakeFetch(200, body);
    const client = new RegistrationClient({ serverUrl: 'https://sir.example.it', fetch: f.fetch });
    await expect(client.status(SECRET)).resolves.toEqual(body);
    const call = f.calls[0];
    expect(call?.url).toBe('https://sir.example.it/api/agents/registrations/status');
    expect(call?.init.headers).toEqual({ authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' });
    expect(call?.init.body).toBe('{}');
  });

  it('stato sconosciuto o approved senza token: risposta non valida', async () => {
    for (const body of [{ status: 'boh' }, { status: 'approved', agentId: CREATED.registrationId }]) {
      const client = new RegistrationClient({ serverUrl: 'https://sir.example.it', fetch: fakeFetch(200, body).fetch });
      const err = await rejection(client.status(SECRET));
      expect(err.code).toBe('INVALID_RESPONSE');
      expect(err.message).not.toContain(SECRET);
    }
  });
});

describe('registration.json', () => {
  it('salva, rilegge e cancella; un file non valido viene cancellato', async () => {
    const dirs = tempDirs();
    cleanups.push(dirs.cleanup);
    const dataDir = join(dirs.home, 'data');
    expect(await loadPendingRegistration(dataDir)).toBeNull();
    const pending: PendingRegistration = { version: 1, ...CREATED, name: 'PC campo 1' };
    await savePendingRegistration(dataDir, pending);
    expect(await loadPendingRegistration(dataDir)).toEqual(pending);
    await clearPendingRegistration(dataDir);
    expect(await loadPendingRegistration(dataDir)).toBeNull();

    await mkdir(dataDir, { recursive: true });
    await writeFile(registrationFile(dataDir), '{"version":1,"name":"x"}');
    expect(await loadPendingRegistration(dataDir)).toBeNull();
    await expect(readFile(registrationFile(dataDir))).rejects.toThrow();
  });
});
