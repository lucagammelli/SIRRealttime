import { MeResponseSchema, TENANT_REQUIRED_MESSAGE } from '@sir/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiCommand, apiRequest, errorText } from './api.ts';

const ME = { id: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', email: 'a@b.it', role: 'admin', tenant: null };
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('apiRequest', () => {
  it('sends JSON with the cookie and validates the answer', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(200, ME));
    const me = await apiRequest('/api/auth/login', MeResponseSchema, {
      method: 'POST',
      body: { email: 'a', password: 'b' },
      fetch,
    });
    expect(me.role).toBe('admin');
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(init?.body).toBe('{"email":"a","password":"b"}');
  });

  it('turns HTTP and network failures into Italian messages', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(401, { error: 'Non autorizzato' }));
    await expect(apiRequest('/api/auth/me', MeResponseSchema, { fetch })).rejects.toMatchObject({ status: 401 });
    fetch.mockResolvedValueOnce(json(200, { id: 'x' }));
    await expect(apiRequest('/api/auth/me', MeResponseSchema, { fetch })).rejects.toThrow(
      'Risposta del server non valida.',
    );
    fetch.mockResolvedValueOnce(json(409, { error: 'Utente già esistente' }));
    await expect(apiCommand('/api/admin/users', { method: 'POST', fetch })).rejects.toThrow('Utente già esistente.');
    fetch.mockRejectedValueOnce(new TypeError('failed'));
    const err = await apiCommand('/api/admin/users', { fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(errorText(err)).toContain('Server non raggiungibile');
  });

  it('sends PATCH with a JSON body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await apiCommand('/api/admin/tenants/x', { method: 'PATCH', body: { name: 'A' }, fetch });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(init?.body).toBe('{"name":"A"}');
  });

  it('shows «Scegli prima un cliente» (409) as it is, never the server text of a 400', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(409, { error: TENANT_REQUIRED_MESSAGE }));
    await expect(apiCommand('/api/admin/matches', { fetch })).rejects.toThrow('Scegli prima un cliente.');
    fetch.mockResolvedValueOnce(json(400, { error: 'Richiesta non valida: name' }));
    await expect(apiCommand('/api/admin/agents', { fetch })).rejects.toThrow('Dati non validi: controlla i campi.');
  });

  it('sends DELETE without a body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await apiCommand('/api/admin/agents/1', { method: 'DELETE', fetch });
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.body).toBeUndefined();
    expect(init?.headers).not.toHaveProperty('content-type');
  });
});
