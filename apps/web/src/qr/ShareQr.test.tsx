import type { ShareTokenSummary } from '@arenalive/shared';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '../pages/admin/AdminApp.tsx';
import { qrSvg } from './qrImage.ts';
import { qrAddress, ShareQr } from './ShareQr.tsx';

const URL = 'https://portale.example.org/l/K7M2QX9P';
const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const svgOf = (img: HTMLElement): string => decodeURIComponent(img.getAttribute('src')?.split(',')[1] ?? '');

describe('ShareQr', () => {
  it('encodes the link with ?q=1 (statistics: visits from the QR), the copied link stays plain', () => {
    expect(qrAddress(URL)).toBe(`${URL}?q=1`);
    expect(qrAddress(`${URL}?tv=1`)).toBe(`${URL}?tv=1&q=1`);
    expect(qrAddress('non un indirizzo')).toBe('non un indirizzo');
    render(<ShareQr url={URL} code="K7M2QX9P" logoSrc={null} />);
    const img = screen.getByRole('img', { name: 'Codice QR del link K7M2-QX9P' });
    expect(svgOf(img)).toBe(qrSvg(`${URL}?q=1`, { caption: 'K7M2-QX9P', logoDataUrl: null }));
    expect(svgOf(img)).not.toBe(qrSvg(URL, { caption: 'K7M2-QX9P', logoDataUrl: null }));
  });

  it('shows the QR preview with the code and the copy and download buttons', () => {
    render(<ShareQr url={URL} code="K7M2QX9P" logoSrc={null} />);
    const img = screen.getByRole('img', { name: 'Codice QR del link K7M2-QX9P' });
    expect(img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(svgOf(img)).toContain('>K7M2-QX9P</text>');
    expect(svgOf(img)).not.toContain('<image');
    for (const name of ['Copia link', 'Scarica QR (PNG)', 'Scarica QR (SVG)'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('puts the logo of the client in the middle once it is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(PNG_1X1, { headers: { 'content-type': 'image/png' } }))),
    );
    render(<ShareQr url={URL} code="K7M2QX9P" logoSrc="/api/public/assets/logo" actions={false} />);
    const img = await screen.findByRole('img', { name: 'Codice QR del link K7M2-QX9P' });
    expect(svgOf(img)).toContain('<image');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws the QR without logo when the logo cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('no', { status: 404 }))),
    );
    render(<ShareQr url={URL} code="K7M2QX9P" logoSrc="/api/public/assets/logo" />);
    const img = await screen.findByRole('img', { name: 'Codice QR del link K7M2-QX9P' });
    expect(svgOf(img)).not.toContain('<image');
  });
});

describe('ShareLinksPage', () => {
  const link = (over: Partial<ShareTokenSummary>): ShareTokenSummary => ({
    id: '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c',
    label: 'Tribuna',
    matchId: null,
    clientFixtureId: null,
    expiresAt: null,
    revoked: false,
    createdAt: '2026-10-15T10:00:00.000Z',
    shortCode: 'K7M2QX9P',
    shortUrl: URL,
    ...over,
  });

  it('shows the short link and the QR of the active links only', async () => {
    const links = [
      link({}),
      link({
        id: '4f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c',
        label: 'Vecchio',
        revoked: true,
        shortCode: null,
        shortUrl: null,
      }),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body =
          url === '/api/auth/me'
            ? { id: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', email: 'a@b.it', role: 'admin', tenant: null }
            : url === '/api/admin/share-tokens'
              ? links
              : [];
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    render(
      <MemoryRouter initialEntries={['/admin/link']}>
        <Routes>
          <Route path="/admin/*" element={<AdminApp />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(URL)).toBeTruthy());
    expect(screen.getByText('K7M2-QX9P')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /Codice QR/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Scarica QR (PNG)' })).toHaveLength(1);
  });
});
