import type { DisplaySummary } from '@arenalive/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.tsx';
import { IMAGE_TEXT } from './DisplaysPage.tsx';

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const DISPLAY_ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

const display = (over: Partial<DisplaySummary> = {}): DisplaySummary => ({
  id: DISPLAY_ID,
  name: 'Maxischermo tribuna',
  target: { kind: 'none' },
  configured: false,
  revoked: false,
  lastSeenAt: new Date(Date.now() - 5000).toISOString(),
  lastIp: '10.0.0.5',
  version: '1.0.0',
  resolution: '1920x1080',
  command: null,
  commandSeq: 0,
  createdAt: '2026-10-20T10:00:00.000Z',
  ...over,
});

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function mockServer(role: 'admin' | 'viewer' = 'admin') {
  let row = display();
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (url === '/api/auth/me') return json({ id: USER_ID, email: 'a@b.it', role, tenant: null });
      if (url === '/api/admin/displays' && method === 'GET') return json([row]);
      if (url === `/api/admin/displays/${DISPLAY_ID}` && method === 'PATCH') {
        row = { ...row, ...(body as Partial<DisplaySummary>) };
        return json(row);
      }
      if (url === `/api/admin/displays/${DISPLAY_ID}/command`) {
        row = {
          ...row,
          command: (body as { command: DisplaySummary['command'] }).command,
          commandSeq: row.commandSeq + 1,
        };
        return json(row);
      }
      if (url === `/api/admin/displays/${DISPLAY_ID}/config`)
        return json({ version: 1, serverUrl: 'https://club.example.it', token: TOKEN, name: row.name });
      return json([]);
    }),
  );
  return { calls };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/player']}>
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const item = async () => screen.findByTestId('display');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('page «Player»', () => {
  it('lists the players with state, software and screen, and the text of the image', async () => {
    mockServer();
    renderPage();
    const row = await item();
    expect(within(row).getByText('Maxischermo tribuna')).toBeTruthy();
    expect(within(row).getByText('In linea')).toBeTruthy();
    expect(within(row).getByText(/versione 1\.0\.0 · schermo 1920x1080/)).toBeTruthy();
    expect(screen.getByText(IMAGE_TEXT)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Player' })).toBeTruthy();
  });

  it('changes what the player shows and sends the commands, asking to confirm the reboot', async () => {
    const server = mockServer();
    renderPage();
    const row = await item();
    fireEvent.change(within(row).getByRole('combobox', { name: 'Cosa mostra' }), { target: { value: 'channel' } });
    await waitFor(() =>
      expect(server.calls).toContainEqual({
        url: `/api/admin/displays/${DISPLAY_ID}`,
        method: 'PATCH',
        body: { target: { kind: 'channel' } },
      }),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Ricarica' }));
    await waitFor(() =>
      expect(server.calls).toContainEqual({
        url: `/api/admin/displays/${DISPLAY_ID}/command`,
        method: 'POST',
        body: { command: 'reload' },
      }),
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Riavvia' }));
    expect(server.calls.some((c) => (c.body as { command?: string } | undefined)?.command === 'reboot')).toBe(false);
    fireEvent.click(within(row).getByRole('button', { name: 'Conferma riavvio' }));
    await waitFor(() =>
      expect(server.calls.some((c) => (c.body as { command?: string } | undefined)?.command === 'reboot')).toBe(true),
    );
  });

  it('downloads the configuration with the Wi-Fi, refusing a short password', async () => {
    const server = mockServer();
    renderPage();
    const row = await item();
    fireEvent.click(within(row).getByRole('button', { name: 'Scarica configurazione' }));
    const form = within(row).getByRole('form', { name: /Configurazione di/ });
    fireEvent.change(within(form).getByLabelText(/Rete Wi-Fi/), { target: { value: 'Palestra' } });
    fireEvent.change(within(form).getByLabelText(/Password del Wi-Fi/), { target: { value: 'corta' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Scarica il file del player' }));
    expect(await within(form).findByText(/da 8 a 63 caratteri/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Password del Wi-Fi/), { target: { value: 'segreta-123' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Scarica il file del player' }));
    await waitFor(() =>
      expect(server.calls).toContainEqual({
        url: `/api/admin/displays/${DISPLAY_ID}/config`,
        method: 'POST',
        body: { wifi: { ssid: 'Palestra', password: 'segreta-123', country: 'IT' } },
      }),
    );
    expect(await within(form).findByText('File arenalive-player.json scaricato.')).toBeTruthy();
    expect(within(form).getByText(/partizione/).textContent).toMatch(/bootfs/);
  });

  it('is read-only for a viewer', async () => {
    mockServer('viewer');
    renderPage();
    const row = await item();
    expect(within(row).queryByRole('button', { name: 'Ricarica' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crea player' })).toBeNull();
    expect(screen.getByText(/Sola lettura/)).toBeTruthy();
  });
});
