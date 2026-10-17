import type { MeResponse, TenantSummary } from '@sir/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AdminApp } from './AdminApp.tsx';
import { parseHostnames } from './TenantsPage.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const A = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const B = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const AT = '2026-10-15T10:00:00.000Z';

const tenant = (id: string, slug: string, name: string, hostnames: string[]): TenantSummary => ({
  id,
  slug,
  name,
  hostnames,
  createdAt: AT,
  agentQuota: 1,
  userCount: 0,
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

class SilentSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  close(): void {}
}

/** Fake server for a user of `role`; the superadmin starts on client A. */
function mockServer(role: MeResponse['role']): { calls: Call[] } {
  let tenants = [tenant(A, 'club-a', 'Club A', ['a.sir.it']), tenant(B, 'club-b', 'Club B', [])];
  let active: string = A;
  const calls: Call[] = [];
  const me = (): MeResponse => {
    const t = tenants.find((x) => x.id === active);
    return { id: USER_ID, email: 'super@sir.it', role, tenant: t ? { id: t.id, slug: t.slug, name: t.name } : null };
  };
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/auth/me') return json(me());
      if (url === '/api/admin/tenants' && method === 'GET') return json(tenants);
      if (url === '/api/admin/tenants' && method === 'POST') {
        const b = body as { slug: string; name: string; hostnames: string[] };
        if (tenants.some((t) => t.slug === b.slug))
          return json({ error: 'Esiste già un cliente con questo identificativo' }, 409);
        const created = tenant('5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a', b.slug, b.name, b.hostnames);
        tenants = [...tenants, created];
        return json(created, 201);
      }
      const patch = /^\/api\/admin\/tenants\/([^/]+)$/.exec(url);
      if (patch && method === 'PATCH') {
        const b = body as { name: string; hostnames: string[] };
        tenants = tenants.map((t) => (t.id === patch[1] ? { ...t, ...b } : t));
        return json(tenants.find((t) => t.id === patch[1]));
      }
      if (url === '/api/admin/active-tenant') {
        active = (body as { tenantId: string }).tenantId;
        return json(me());
      }
      return json([]);
    }),
  );
  return { calls };
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseHostnames', () => {
  it('splits lines, spaces and commas and drops empty entries', () => {
    expect(parseHostnames(' a.it\n\nb.it, c.it  d.it\n')).toEqual(['a.it', 'b.it', 'c.it', 'd.it']);
    expect(parseHostnames('   ')).toEqual([]);
  });
});

describe('«Clienti» page', () => {
  it('lists the clients and creates a new one', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/clienti');
    expect(await screen.findByText('a.sir.it · un agente · nessun utente · creato', { exact: false })).toBeTruthy();
    const form = (await screen.findByRole('heading', { name: 'Nuovo cliente' })).closest('section');
    if (!form) throw new Error('no form');
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Club C' } });
    fireEvent.change(within(form).getByLabelText('Identificativo', { exact: false }), { target: { value: 'club-c' } });
    fireEvent.change(within(form).getByLabelText('Hostname', { exact: false }), {
      target: { value: 'Live.Club-C.it\nc2.club-c.it' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Crea cliente' }));
    expect(await screen.findByText('Cliente «Club C» creato.')).toBeTruthy();
    const post = calls.find((c) => c.url === '/api/admin/tenants' && c.method === 'POST');
    expect(post?.body).toEqual({
      slug: 'club-c',
      name: 'Club C',
      hostnames: ['live.club-c.it', 'c2.club-c.it'],
      agentQuota: 1,
    });
    // The new client is in the list and in the selector.
    const selector = screen.getByLabelText('Cliente');
    await waitFor(() => expect(within(selector).getByRole('option', { name: 'Club C' })).toBeTruthy());
  });

  it('refuses invalid hostnames before calling the server', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/clienti');
    const form = (await screen.findByRole('heading', { name: 'Nuovo cliente' })).closest('section');
    if (!form) throw new Error('no form');
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Club D' } });
    fireEvent.change(within(form).getByLabelText('Identificativo', { exact: false }), { target: { value: 'club-d' } });
    fireEvent.change(within(form).getByLabelText('Hostname', { exact: false }), {
      target: { value: 'https://d.it:443' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Crea cliente' }));
    expect(await screen.findByText(/Hostname non valido/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('changes name and hostnames of a client', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/clienti');
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica Club B' }));
    const editor = screen.getByRole('form', { name: 'Modifica Club B' });
    fireEvent.change(within(editor).getByLabelText('Nome'), { target: { value: 'Club B nuovo' } });
    fireEvent.change(within(editor).getByLabelText('Hostname', { exact: false }), { target: { value: 'b.sir.it' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Salva' }));
    expect(await screen.findByText('b.sir.it · un agente · nessun utente · creato', { exact: false })).toBeTruthy();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({
      url: `/api/admin/tenants/${B}`,
      body: { name: 'Club B nuovo', hostnames: ['b.sir.it'] },
    });
  });

  it('creates a client with its first user «Lettura e scrittura»', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/clienti');
    const form = (await screen.findByRole('heading', { name: 'Nuovo cliente' })).closest('section');
    if (!form) throw new Error('no form');
    fireEvent.change(within(form).getByLabelText('Nome'), { target: { value: 'Club E' } });
    fireEvent.change(within(form).getByLabelText('Identificativo', { exact: false }), { target: { value: 'club-e' } });
    fireEvent.change(within(form).getByLabelText('Email del primo utente'), { target: { value: 'capo@club-e.it' } });
    fireEvent.change(within(form).getByLabelText('Password del primo utente', { exact: false }), {
      target: { value: 'corta' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Crea cliente' }));
    expect(await screen.findByText(/Primo utente: la password deve avere almeno 12 caratteri/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/admin/tenants')).toBe(false);
    fireEvent.change(within(form).getByLabelText('Password del primo utente', { exact: false }), {
      target: { value: 'password-del-capo' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Crea cliente' }));
    expect(await screen.findByText('Cliente «Club E» creato con l’utente capo@club-e.it.')).toBeTruthy();
    expect(calls.find((c) => c.url === '/api/admin/tenants' && c.method === 'POST')?.body).toMatchObject({
      slug: 'club-e',
      firstUser: { email: 'capo@club-e.it', password: 'password-del-capo' },
    });
  });

  it('shows the users of each client and opens them with «Utenti»', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/clienti');
    expect(await screen.findAllByText(/nessun utente/)).toHaveLength(2);
    fireEvent.click(await screen.findByRole('button', { name: 'Utenti di Club B' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/utenti'));
    expect(calls.find((c) => c.url === '/api/admin/active-tenant')).toMatchObject({
      method: 'POST',
      body: { tenantId: B },
    });
    // The users page of Club B, also in the selector.
    expect(await screen.findByText('Cliente: Club B')).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>('Cliente').value).toBe(B);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/users')).toBe(true));
  });

  it('is not reachable by a normal admin', async () => {
    mockServer('admin');
    renderAt('/admin/clienti');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/live'));
    expect(within(nav).queryByRole('link', { name: 'Clienti' })).toBeNull();
    expect(screen.queryByLabelText('Cliente')).toBeNull();
  });
});

describe('client selector', () => {
  it('sets the client of the session and reloads the pages on it', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/partite');
    const selector = await screen.findByLabelText<HTMLSelectElement>('Cliente');
    await waitFor(() => expect(selector.value).toBe(A));
    await waitFor(() => expect(within(selector).getByRole('option', { name: 'Club B' })).toBeTruthy());
    const before = calls.filter((c) => c.url === '/api/admin/matches').length;
    fireEvent.change(selector, { target: { value: B } });
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('Cliente').value).toBe(B));
    expect(calls.find((c) => c.url === '/api/admin/active-tenant')).toMatchObject({
      method: 'POST',
      body: { tenantId: B },
    });
    // The matches page is mounted again and asks for the matches of B.
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/admin/matches').length).toBe(before + 1));
  });

  it('shows the client name, without selector, to the users of a client', async () => {
    mockServer('admin');
    renderAt('/admin/partite');
    expect(await screen.findByText('Club A')).toBeTruthy();
    expect(screen.queryByLabelText('Cliente')).toBeNull();
  });
});
