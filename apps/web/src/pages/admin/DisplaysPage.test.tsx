import type { DisplaySummary } from '@arenalive/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from './AdminApp.tsx';
import type { PlayerImageInfo } from '@arenalive/shared';
import {
  CONFIG_ONLY_TEXT,
  IMAGE_MISSING_TEXT,
  IMAGE_TEXT,
  READY_IMAGE_HELP,
  READY_IMAGE_MISSING_TEXT,
  READY_IMAGE_TEXT,
} from './DisplaysPage.tsx';

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

const TICKET = 'T'.repeat(43);
const READY_FILE = 'arenalive-player-maxischermo-tribuna-0.2.0.img.gz';
const READY_INFO: PlayerImageInfo = {
  available: true,
  version: '0.2.0',
  builtAt: '2026-10-27T10:00:00.000Z',
  bytes: 750 * 1024 * 1024,
  sha256: 'cd'.repeat(32),
  sha256Of: 'image',
  fileName: 'arenalive-player-0.2.0.img.gz',
  ready: true,
};

function mockServer(
  role: 'admin' | 'viewer' = 'admin',
  image: PlayerImageInfo = { available: false },
  over: Partial<DisplaySummary> = {},
) {
  let row = display(over);
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
      if (url === '/api/admin/player/image/info') return json(image);
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
      if (url === `/api/admin/displays/${DISPLAY_ID}/image`)
        return json({ ticket: TICKET, expiresAt: '2026-10-27T10:10:00.000Z', fileName: READY_FILE, size: 1000 });
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
    expect(await screen.findByText(`${IMAGE_MISSING_TEXT}.`)).toBeTruthy();
    expect(screen.queryByRole('link', { name: IMAGE_TEXT })).toBeNull();
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
    expect(within(form).getByText(READY_IMAGE_MISSING_TEXT)).toBeTruthy();
    expect(within(form).queryByRole('button', { name: READY_IMAGE_TEXT })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: CONFIG_ONLY_TEXT }));
    expect(await within(form).findByText(/da 8 a 63 caratteri/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Password del Wi-Fi/), { target: { value: 'segreta-123' } });
    fireEvent.click(within(form).getByRole('button', { name: CONFIG_ONLY_TEXT }));
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

  it('links the image of the SD card with version, size and sha256', async () => {
    const sha = 'ab'.repeat(32);
    mockServer('admin', {
      available: true,
      version: '0.1.0',
      builtAt: '2026-10-26T10:00:00.000Z',
      bytes: 750 * 1024 * 1024,
      sha256: sha,
      sha256Of: 'file',
      fileName: 'arenalive-player-0.1.0.img.xz',
      ready: false,
    });
    renderPage();
    const link = await screen.findByRole('link', { name: IMAGE_TEXT });
    expect(link.getAttribute('href')).toBe('/api/admin/player/image');
    expect(link.getAttribute('download')).toBe('arenalive-player-0.1.0.img.xz');
    expect(screen.getByTestId('player-image').textContent).toMatch(/0\.1\.0 · .* · 750 MB/);
    expect(screen.getByText(sha)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copia sha256' })).toBeTruthy();
  });

  it('downloads the image ready for the player with a link to the ticket, or the file alone', async () => {
    const server = mockServer('admin', READY_INFO, { configured: true });
    const clicked: { href: string; download: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    renderPage();
    const row = await item();
    fireEvent.click(within(row).getByRole('button', { name: 'Scarica configurazione' }));
    const form = within(row).getByRole('form', { name: /Configurazione di/ });
    expect(within(form).getByText(/Il download precedente smette di valere/)).toBeTruthy();
    expect(within(form).getByText(READY_IMAGE_HELP)).toBeTruthy();
    expect(within(form).queryByText(READY_IMAGE_MISSING_TEXT)).toBeNull();
    fireEvent.change(within(form).getByLabelText(/Rete Wi-Fi/), { target: { value: 'Palestra' } });
    fireEvent.change(within(form).getByLabelText(/Password del Wi-Fi/), { target: { value: 'segreta-123' } });
    fireEvent.click(within(form).getByRole('button', { name: READY_IMAGE_TEXT }));
    await waitFor(() =>
      expect(server.calls).toContainEqual({
        url: `/api/admin/displays/${DISPLAY_ID}/image`,
        method: 'POST',
        body: { wifi: { ssid: 'Palestra', password: 'segreta-123', country: 'IT' } },
      }),
    );
    expect(await within(form).findByText('Download dell’immagine avviato.')).toBeTruthy();
    expect(clicked).toEqual([{ href: `/api/admin/displays/image/${TICKET}`, download: READY_FILE }]);
    fireEvent.click(within(form).getByRole('button', { name: CONFIG_ONLY_TEXT }));
    await waitFor(() =>
      expect(server.calls).toContainEqual({
        url: `/api/admin/displays/${DISPLAY_ID}/config`,
        method: 'POST',
        // The password is cleared after a download: an open network with the same name.
        body: { wifi: { ssid: 'Palestra', country: 'IT' } },
      }),
    );
    // The generic image stays, as a secondary link.
    expect((await screen.findByRole('link', { name: IMAGE_TEXT })).getAttribute('download')).toBe(
      'arenalive-player-0.2.0.img.gz',
    );
    expect(screen.getByText(/sha256 dell’immagine decompressa/)).toBeTruthy();
  });

  it('is read-only for a viewer', async () => {
    const server = mockServer('viewer');
    renderPage();
    const row = await item();
    expect(within(row).queryByRole('button', { name: 'Ricarica' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Crea player' })).toBeNull();
    expect(screen.getByText(/Sola lettura/)).toBeTruthy();
    expect(screen.queryByText(`${IMAGE_MISSING_TEXT}.`)).toBeNull();
    expect(server.calls.some((c) => c.url.startsWith('/api/admin/player/image'))).toBe(false);
  });
});
