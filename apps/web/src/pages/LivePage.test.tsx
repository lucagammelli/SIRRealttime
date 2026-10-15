import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBranding, TenantLayoutSchema } from '@sir/shared';
import { setTenantLook, tenantLookOf } from '../lib/branding.ts';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { TV_ROOT_CLASS } from '../lib/tvScreen.ts';
import { midMatchState } from '../test/fixtures.ts';
import { LivePage } from './LivePage.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const snapshot: LiveSnapshot = {
  status: 'live',
  data: { kind: 'state', matchId: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', version: 3, state: midMatchState() },
  error: null,
  attempts: 0,
};
vi.mock('../lib/useLiveSocket.ts', () => ({
  socketUrl: (path: string) => `ws://test${path}`,
  useLiveSocket: () => snapshot,
}));

const TOKEN = 'abcdefghijklmnopqrstuv12';

function setWidth(width: number, height = 1080): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
}

function renderAt(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/live/${TOKEN}${search}`]}>
      <Routes>
        <Route path="/live/:token" element={<LivePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const device = (container: HTMLElement) => container.querySelector('[data-device]')?.getAttribute('data-device');

let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn(() => Promise.resolve({ released: false, release: () => Promise.resolve() }));
  vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
});
afterEach(() => {
  cleanup();
  act(() => setTenantLook(null));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setWidth(1024);
});

describe('LivePage devices', () => {
  it('chooses phone, tablet and big screen from the width', () => {
    setWidth(390);
    const phone = renderAt();
    expect(device(phone.container)).toBe('phone');
    expect(screen.getByRole('region', { name: 'Tabellone' }).className).toContain('sticky');
    phone.unmount();

    setWidth(1024);
    const tablet = renderAt();
    expect(device(tablet.container)).toBe('tablet');
    expect(request).not.toHaveBeenCalled();
    tablet.unmount();

    setWidth(1920);
    const tv = renderAt();
    expect(device(tv.container)).toBe('tv');
    tv.unmount();

    // Wide but 4:3 (a monitor, not a TV): two columns.
    setWidth(1600, 1200);
    const monitor = renderAt();
    expect(device(monitor.container)).toBe('tablet');
    monitor.unmount();

    setWidth(1920);
    const off = renderAt('?tv=0');
    expect(device(off.container)).toBe('tablet');
    off.unmount();
  });

  it('big screen: the rotation can be stopped and resumed, also with the keyboard', async () => {
    vi.useFakeTimers();
    setWidth(1920);
    renderAt();
    const stop = screen.getByRole('button', { name: 'Ferma rotazione' });
    expect(stop.getAttribute('aria-pressed')).toBe('false');
    const heading = (name: string) => screen.queryByRole('heading', { name });
    expect(heading('Andamento del set')).toBeTruthy();
    fireEvent.click(stop);
    expect(stop.getAttribute('aria-pressed')).toBe('true');
    expect(stop.getAttribute('title')).toBe('Riprendi rotazione');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(heading('Andamento del set')).toBeTruthy();
    expect(heading('Statistiche giocatori')).toBeNull();
    // Hidden with the pointer after 3 s, but still in the tab order and shown again when focused.
    await act(async () => {
      await Promise.resolve();
    });
    const controls = stop.parentElement;
    expect(controls?.className).toContain('opacity-0');
    expect(controls?.className).toContain('focus-within:opacity-100');
    expect(stop.tabIndex).toBe(0);
    fireEvent.click(stop);
    expect(stop.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(heading('Statistiche giocatori')).toBeTruthy();
  });

  it('phone: no rotation button and full screen does not switch to the big screen', () => {
    setWidth(390, 844);
    const { container } = renderAt();
    expect(screen.queryByRole('button', { name: 'Ferma rotazione' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Schermo intero' }));
    expect(device(container)).toBe('phone');
  });

  it('follows the width when the window is resized', () => {
    setWidth(1024);
    const { container } = renderAt();
    act(() => {
      setWidth(500);
      window.dispatchEvent(new Event('resize'));
    });
    expect(device(container)).toBe('phone');
  });

  it('?tv=1: big screen at any width, no scrolling, text scaled, screen kept on, pointer hidden after 3 s', async () => {
    vi.useFakeTimers();
    setWidth(1024);
    const { container } = renderAt('?tv=1');
    const root = container.querySelector('[data-device]');
    expect(root?.getAttribute('data-device')).toBe('tv');
    expect(root?.className).toContain('h-dvh');
    expect(root?.className).toContain('overflow-hidden');
    expect(document.documentElement.classList.contains(TV_ROOT_CLASS)).toBe(true);
    expect(request).toHaveBeenCalledWith('screen');
    // Logo and buttons inside the scoreboard: no page header.
    expect(root?.querySelector(':scope > header')).toBeNull();
    expect(screen.getByRole('button', { name: 'Schermo intero' })).toBeTruthy();
    expect(root?.className).not.toContain('cursor-none');
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(root?.className).toContain('cursor-none');
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
    });
    expect(root?.className).not.toContain('cursor-none');
  });
});

describe('LivePage layout of the client', () => {
  it('shows the blocks chosen by the client for the device, the QR with the address of the page', () => {
    const layout = TenantLayoutSchema.parse({
      tablet: [
        { id: 'tab', type: 'scoreboard' },
        { id: 'msg', type: 'message', width: 8, options: { text: 'Benvenuti al PalaBarton!' } },
        { id: 'qr', type: 'qr', width: 4 },
      ],
      phone: [{ id: 'msg', type: 'message', options: { text: 'Solo telefono' } }],
    });
    act(() =>
      setTenantLook(
        tenantLookOf({
          name: 'Sir Safety',
          branding: defaultBranding(),
          images: { logoMain: null, logoMark: null, sponsorLogo: null },
          layout,
        }),
      ),
    );
    setWidth(1024);
    const tablet = renderAt();
    expect(screen.getByText('Benvenuti al PalaBarton!')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Segui la partita sul telefono' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Andamento del set' })).toBeNull();
    tablet.unmount();
    setWidth(390, 844);
    renderAt();
    expect(screen.getByText('Solo telefono')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Tabellone' })).toBeNull();
  });
});
