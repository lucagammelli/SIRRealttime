import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { AdminApp } from './AdminApp.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT_ID = '0c2a4b6d-8e0f-4a1b-9c3d-5e7f9a1b3c5d';

/** Socket that never opens: the live page stays on «Connessione…». */
class SilentSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  close(): void {}
}

/** Fake server; a superadmin is inside the client «Sir Safety» unless `outside`. */
function mockServer(role: 'superadmin' | 'admin' | 'viewer', outside = false): void {
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = input;
      const tenant = { id: TENANT_ID, slug: 'sir', name: 'Sir Safety' };
      const body =
        url === '/api/auth/me'
          ? { id: USER_ID, email: 'a@b.it', role, tenant: role === 'superadmin' && !outside ? tenant : null }
          : url === '/api/admin/tenants'
            ? [{ ...tenant, hostnames: [], createdAt: '2026-01-01T00:00:00.000Z' }]
            : [];
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
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

const where = (): string => screen.getByTestId('where').textContent ?? '';

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin navigation', () => {
  it('goes to the right page from every menu item, always with absolute paths', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    const pages: [string, string, string][] = [
      ['Partite', '/admin/partite', 'Partite'],
      ['Link pubblici', '/admin/link', 'Nuovo link pubblico'],
      ['Agenti', '/admin/agenti', 'Nuovo agente'],
      ['Utenti', '/admin/utenti', 'Nuovo utente'],
      ['Partita live', '/admin/live', 'Connessione alla partita'],
      ['Partite', '/admin/partite', 'Partite'],
    ];
    for (const [label, path, heading] of pages) {
      fireEvent.click(within(nav).getByRole('link', { name: label }));
      expect(where()).toBe(path);
      expect(await within(screen.getByRole('main')).findByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('keeps «Partite» active on the detail of a match', async () => {
    mockServer('admin');
    renderAt(`/admin/partite/${USER_ID}`);
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    expect(within(nav).getByRole('link', { name: 'Partite' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Partita live' }).getAttribute('aria-current')).toBeNull();
  });

  it('sends an unknown address to /admin/live without loops', async () => {
    mockServer('admin');
    renderAt('/admin/xyz/abc');
    await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(where()).toBe('/admin/live'));
    expect(await screen.findByRole('heading', { name: 'Connessione alla partita' })).toBeTruthy();
  });

  it('sends a viewer away from the admin-only pages (Studio, users, clients, championships)', async () => {
    for (const path of [
      '/admin/studio/colori',
      '/admin/utenti',
      '/admin/clienti',
      '/admin/campionati',
      '/admin/simulazione',
    ]) {
      mockServer('viewer');
      renderAt(path);
      const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
      await waitFor(() => expect(where()).toBe('/admin/live'));
      expect(within(nav).queryByRole('link', { name: 'Studio grafico' })).toBeNull();
      cleanup();
    }
  });

  it('opens calendar, links, club and agents to a viewer (read-only pages)', async () => {
    mockServer('viewer');
    renderAt('/admin/agenti');
    await screen.findByRole('navigation', { name: 'Area riservata' });
    expect(await screen.findByText(/Sola lettura/)).toBeTruthy();
    expect(where()).toBe('/admin/agenti');
  });

  it('groups the side menu: matches, club, public page, devices, administration (admin, no clients)', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    const groups = within(nav).getAllByRole('region');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Partite',
      'Club',
      'Pagina pubblica',
      'Dispositivi',
      'Amministrazione',
    ]);
    const names = (name: string): string[] =>
      within(within(nav).getByRole('region', { name }))
        .getAllByRole('link')
        .map((l) => l.textContent ?? '');
    expect(names('Partite')).toEqual(['Partita live', 'Partite', 'Calendario']);
    expect(names('Club')).toEqual(['Club']);
    expect(names('Pagina pubblica')).toEqual(['Studio grafico', 'Link pubblici', 'Simulazione']);
    expect(names('Dispositivi')).toEqual(['Agenti']);
    expect(names('Amministrazione')).toEqual(['Utenti']);
    expect(within(nav).queryByRole('link', { name: 'Clienti' })).toBeNull();
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    // The active item has the colours of the active menu item (red in «SIR VOLLEY»).
    const active = within(nav).getByRole('link', { name: 'Partita live' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.className).toContain('bg-nav-active');
    expect(within(nav).getByRole('link', { name: 'Partite' }).className).not.toContain('bg-nav-active');
  });

  it('gives the superadmin outside any client only its pages, starting from «Clienti», without the bar', async () => {
    mockServer('superadmin', true);
    renderAt('/admin');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(where()).toBe('/admin/clienti'));
    expect(
      within(nav)
        .getAllByRole('region')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Amministrazione']);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Clienti', 'Campionati']);
    expect(within(nav).getByRole('link', { name: 'Clienti' }).getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Campionati' }).getAttribute('href')).toBe('/admin/campionati');
    expect(screen.queryByTestId('barra-cliente')).toBeNull();
    expect(screen.queryByLabelText('Cliente')).toBeNull();
    // Nothing leads to the pages of a client, not even the logo.
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/admin/live')).toEqual([]);
  });

  it('gives the superadmin inside a client the pages of an administrator, under the bar of the client', async () => {
    mockServer('superadmin');
    renderAt('/admin/live');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    expect(
      within(nav)
        .getAllByRole('region')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Partite', 'Club', 'Pagina pubblica', 'Dispositivi', 'Amministrazione']);
    expect(
      within(within(nav).getByRole('region', { name: 'Amministrazione' }))
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Utenti']);
    const bar = screen.getByRole('region', { name: 'Cliente gestito dal superadmin' });
    expect(bar.textContent).toContain('Stai gestendo «Sir Safety» come superadmin');
    expect(within(bar).getByRole('button', { name: 'Esci dal cliente' })).toBeTruthy();
    // The bar is at the top of the page, before the menu, and stays in view (sticky container).
    expect(bar.parentElement?.className).toContain('sticky');
    expect(bar.parentElement?.className).toContain('top-0');
    expect(screen.queryByLabelText('Cliente')).toBeNull();
  });

  it('gives a viewer the pages to read, without Studio, users, clients and championships', async () => {
    mockServer('viewer');
    renderAt('/admin/live');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    expect(
      within(nav)
        .getAllByRole('region')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Partite', 'Club', 'Pagina pubblica', 'Dispositivi']);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Partita live', 'Partite', 'Calendario', 'Club', 'Link pubblici', 'Agenti']);
  });

  it('opens «Campionati» for the superadmin only', async () => {
    mockServer('superadmin');
    renderAt('/admin/campionati');
    expect(await screen.findByRole('heading', { name: 'Nuovo campionato della Lega' })).toBeTruthy();
    expect(where()).toBe('/admin/campionati');
    cleanup();
    mockServer('admin');
    renderAt('/admin/campionati');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    await waitFor(() => expect(where()).toBe('/admin/live'));
    expect(within(nav).queryByRole('link', { name: 'Campionati' })).toBeNull();
  });

  it('has the account and «Esci» at the bottom of the menu, and no «Powered by» credit', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    const menu = await screen.findByRole('complementary', { name: 'Menu dell’area riservata' });
    expect(within(menu).getByText('a@b.it')).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Esci' })).toBeTruthy();
    expect(screen.queryByRole('contentinfo')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Powered by|Istante/);
  });

  it('reduces the menu to the icons on the tablet at first, and expands or reduces it on request', async () => {
    // jsdom: a 1024 px window, a tablet in landscape.
    mockServer('admin');
    renderAt('/admin/live');
    const menu = await screen.findByRole('complementary', { name: 'Menu dell’area riservata' });
    expect(menu.className).toContain('md:w-[4.5rem]');
    const expand = within(menu).getByRole('button', { name: 'Espandi il menu' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    // The name of every item stays for screen readers (hidden only from 768 px) and as a tooltip.
    const item = within(menu).getByRole('link', { name: 'Partite' });
    expect(item.getAttribute('title')).toBe('Partite');
    expect(within(item).getByText('Partite').className).toContain('md:sr-only');
    fireEvent.click(expand);
    expect(menu.className).toContain('md:w-60');
    const reduce = within(menu).getByRole('button', { name: 'Riduci il menu' });
    expect(reduce.getAttribute('aria-expanded')).toBe('true');
    expect(within(item).getByText('Partite').className).not.toContain('sr-only');
    expect(item.hasAttribute('title')).toBe(false);
  });

  it('opens the menu on the phone with ☰ (44 px), moves the focus into it and closes it with Esc', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    const menu = await screen.findByRole('complementary', { name: 'Menu dell’area riservata' });
    const button = screen.getByRole('button', { name: 'Apri il menu' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    expect(button.className).toContain('size-11');
    // Closed: out of the screen and out of reach under 768 px, always beside the page from 768 px.
    expect(menu.className).toContain('max-md:invisible');
    expect(menu.className).toContain('md:visible');
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Chiudi il menu', expanded: true })).toBe(button);
    expect(menu.className).not.toContain('max-md:invisible');
    const nav = within(menu).getByRole('navigation', { name: 'Area riservata' });
    expect(document.activeElement).toBe(within(nav).getByRole('link', { name: 'Partita live' }));
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(menu.className).toContain('max-md:invisible');
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('main').hasAttribute('inert')).toBe(false);
  });

  it('closes the phone menu when an item is chosen, with the close button or a tap outside', async () => {
    mockServer('admin');
    renderAt('/admin/live');
    const menu = await screen.findByRole('complementary', { name: 'Menu dell’area riservata' });
    const button = screen.getByRole('button', { name: 'Apri il menu' });
    fireEvent.click(button);
    const item = within(menu).getByRole('link', { name: 'Partite' });
    expect(item.className).toContain('min-h-11');
    fireEvent.click(item);
    expect(where()).toBe('/admin/partite');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(within(menu).getByRole('button', { name: 'Chiudi il menu' }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    fireEvent.click(screen.getByTestId('menu-backdrop'));
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('admin look', () => {
  it('everything of the reserved area, login included, is in the Inter wrapper; the side menu has the thin scrollbar', async () => {
    mockServer('admin');
    const { container } = renderAt('/admin/live');
    const nav = await screen.findByRole('navigation', { name: 'Area riservata' });
    expect(container.querySelector('.sir-admin-font')?.contains(nav)).toBe(true);
    expect(nav.className).toContain('sir-thin-scroll');
    expect(within(nav).getByRole('link', { name: 'Studio grafico' }).getAttribute('href')).toBe('/admin/studio');
    expect(within(nav).queryByText(/sponsor/i)).toBeNull();
  });

  it('the login page too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    const { container } = renderAt('/admin/live');
    await screen.findByRole('heading', { name: 'Area riservata' });
    expect(container.querySelector('.sir-admin-font')?.querySelector('form')).toBeTruthy();
  });
});
