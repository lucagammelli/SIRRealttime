import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBranding, defaultIntermissions, defaultOverlays, TenantLayoutSchema } from '@arenalive/shared';
import { setTenantLook, tenantLookOf } from '../lib/branding.ts';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { DISPLAY_TOKEN_KEY } from '../lib/displayToken.ts';
import { TV_ROOT_CLASS } from '../lib/tvScreen.ts';
import { midMatchState } from '../test/fixtures.ts';
import { DISPLAY_INVALID_TITLE, DisplayPage } from './DisplayPage.tsx';

// jsdom has no canvas: the chart wrapper is replaced by its accessible label.
vi.mock('../charts/EChart.tsx', () => ({
  EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} />,
}));

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
let socketSnapshot: LiveSnapshot = { status: 'connecting', data: null, error: null, attempts: 0 };
let socketUrlOpened: string | null = null;
let socketOptions: { hello?: () => string | null; retryInvalidMs?: number; display?: unknown } | undefined;
vi.mock('../lib/useLiveSocket.ts', () => ({
  socketUrl: (path: string) => `ws://test${path}`,
  useLiveSocket: (url: string | null, options?: typeof socketOptions) => {
    socketUrlOpened = url;
    socketOptions = options;
    return socketSnapshot;
  },
}));

beforeEach(() => {
  vi.stubGlobal('navigator', {
    ...navigator,
    wakeLock: { request: vi.fn(() => Promise.resolve({ released: false, release: () => Promise.resolve() })) },
  });
  window.sessionStorage.clear();
  window.history.replaceState(null, '', `/schermo#${TOKEN}`);
});
afterEach(() => {
  cleanup();
  socketSnapshot = { status: 'connecting', data: null, error: null, attempts: 0 };
  act(() => setTenantLook(null));
  vi.unstubAllGlobals();
});

describe('page of a player', () => {
  it('takes the token from the fragment, removes it from the address and sends it as the first message', () => {
    render(<DisplayPage />);
    expect(socketUrlOpened).toBe('ws://test/ws/display');
    expect(JSON.parse(socketOptions?.hello?.() ?? '')).toEqual({ type: 'auth', token: TOKEN });
    expect(socketOptions?.retryInvalidMs).toBe(60_000);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/schermo');
    expect(window.sessionStorage.getItem(DISPLAY_TOKEN_KEY)).toBe(TOKEN);
    expect(document.documentElement.classList.contains(TV_ROOT_CLASS)).toBe(true);
    expect(screen.getByTestId('tela-tv')).toBeTruthy();
  });

  it('reads the token kept by an earlier load after a reload', () => {
    window.sessionStorage.setItem(DISPLAY_TOKEN_KEY, TOKEN);
    window.history.replaceState(null, '', '/schermo');
    render(<DisplayPage />);
    expect(socketUrlOpened).toBe('ws://test/ws/display');
  });

  it('says the player is not valid without a token or after 4404', () => {
    window.history.replaceState(null, '', '/schermo');
    render(<DisplayPage />);
    expect(socketUrlOpened).toBeNull();
    expect(screen.getByRole('heading', { name: DISPLAY_INVALID_TITLE })).toBeTruthy();
    cleanup();
    window.history.replaceState(null, '', `/schermo#${TOKEN}`);
    socketSnapshot = { status: 'invalid', data: null, error: null, attempts: 0 };
    render(<DisplayPage />);
    expect(screen.getByText(/Scarica di nuovo la configurazione dal portale/)).toBeTruthy();
  });

  it('shows the waiting screen with the name of the client', () => {
    socketSnapshot = {
      status: 'live',
      data: { kind: 'standby', tenantName: 'Club Test', displayName: 'Tribuna' },
      error: null,
      attempts: 0,
    };
    const { container } = render(<DisplayPage />);
    expect(screen.getByText('Club Test')).toBeTruthy();
    // The logo once: no page header over the waiting screen.
    expect(container.querySelector('header')).toBeNull();
    expect(screen.getByText('Tribuna')).toBeTruthy();
  });

  it('shows the match on the big screen without any button, even when the client allows touch', () => {
    act(() =>
      setTenantLook(
        tenantLookOf({
          name: 'Club Test',
          branding: defaultBranding(),
          images: { logoMain: null, logoMark: null, sponsorLogo: null },
          layout: TenantLayoutSchema.parse({}),
          intermissions: defaultIntermissions(),
          overlays: defaultOverlays(),
          sponsors: [],
          players: [],
        }),
      ),
    );
    socketSnapshot = {
      status: 'live',
      data: { kind: 'state', matchId: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', version: 1, state: midMatchState() },
      error: null,
      attempts: 0,
    };
    const { container } = render(<DisplayPage />);
    expect(container.querySelector('[data-device]')?.getAttribute('data-device')).toBe('tv');
    expect(screen.queryByRole('button', { name: 'Ferma rotazione' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Schermo intero/ })).toBeNull();
  });
});
