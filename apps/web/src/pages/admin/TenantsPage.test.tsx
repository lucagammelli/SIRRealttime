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

/**
 * Fake server for a user of `role`: a user of a client works on A; a superadmin starts outside any client, or in
 * `start`.
 */
function mockServer(role: MeResponse['role'], start: string | null = null): { calls: Call[] } {
  let tenants = [tenant(A, 'club-a', 'Club A', ['a.sir.it']), tenant(B, 'club-b', 'Club B', [])];
  let active: string | null = role === 'superadmin' ? start : A;
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
        active = (body as { tenantId: string | null }).tenantId;
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
    // The new client is in the list, ready to be entered.
    expect(await screen.findByRole('button', { name: 'Entra nel cliente Club C' })).toBeTruthy();
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

  it('enters a client with «Entra nel cliente»: its pages, the warning bar and the client in the tab title', async () => {
    const { calls } = mockServer('superadmin');
    renderAt('/admin/clienti');
    expect(await screen.findAllByText(/nessun utente/)).toHaveLength(2);
    expect(screen.queryByTestId('barra-cliente')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Entra nel cliente Club B' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/live'));
    expect(calls.find((c) => c.url === '/api/admin/active-tenant')).toMatchObject({
      method: 'POST',
      body: { tenantId: B },
    });
    const bar = await screen.findByTestId('barra-cliente');
    expect(bar.textContent).toContain('Stai gestendo «Club B» come superadmin');
    expect(bar.className).toContain('bg-warn');
    expect(within(bar).getByRole('button', { name: 'Esci dal cliente' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('[Club B] Partita live · Area riservata'));
    // The pages of an administrator of Club B; the pages of the superadmin only after «Esci dal cliente».
    const nav = screen.getByRole('navigation', { name: 'Area riservata' });
    expect(within(nav).getByRole('link', { name: 'Utenti' })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: 'Clienti' })).toBeNull();
    fireEvent.click(within(nav).getByRole('link', { name: 'Utenti' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/admin/users')).toBe(true));
    await waitFor(() => expect(document.title).toBe('[Club B] Utenti · Area riservata'));
  });

  it('leaves the client with «Esci dal cliente»: back to «Clienti», without bar nor prefix', async () => {
    const { calls } = mockServer('superadmin', B);
    renderAt('/admin/partite');
    const bar = await screen.findByTestId('barra-cliente');
    await waitFor(() => expect(document.title).toBe('[Club B] Partite · Area riservata'));
    fireEvent.click(within(bar).getByRole('button', { name: 'Esci dal cliente' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/clienti'));
    expect(calls.find((c) => c.url === '/api/admin/active-tenant')).toMatchObject({
      method: 'POST',
      body: { tenantId: null },
    });
    await waitFor(() => expect(screen.queryByTestId('barra-cliente')).toBeNull());
    await waitFor(() => expect(document.title).toBe('Clienti · Area riservata'));
    const nav = screen.getByRole('navigation', { name: 'Area riservata' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Clienti', 'Campionati']);
  });

  it('sends a superadmin outside any client from the pages of a client to «Clienti»', async () => {
    const { calls } = mockServer('superadmin');
    for (const path of ['/admin', '/admin/partite', '/admin/live', '/admin/utenti', '/admin/studio', '/admin/xyz']) {
      renderAt(path);
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/clienti'));
      cleanup();
    }
    expect(calls.some((c) => c.url === '/api/admin/matches' || c.url === '/api/admin/users')).toBe(false);
  });

  it('is not reachable by a normal admin', async () => {
    mockServer('admin');
    renderAt('/admin/clienti');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/admin/live'));
    expect(within(nav).queryByRole('link', { name: 'Clienti' })).toBeNull();
  });
});

describe('users of a client', () => {
  it('see the name of their client, never the bar of the superadmin nor a prefix in the title', async () => {
    for (const role of ['admin', 'viewer'] as const) {
      mockServer(role);
      renderAt('/admin/partite');
      expect(await screen.findByText('Club A')).toBeTruthy();
      expect(screen.queryByTestId('barra-cliente')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Esci dal cliente' })).toBeNull();
      await waitFor(() => expect(document.title).toBe('Partite · Area riservata'));
      cleanup();
    }
  });
});
