import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemLogo } from '@arenalive/shared';
import {
  defaultBranding,
  defaultIntermissions,
  defaultOverlays,
  NO_SYSTEM_LOGOS,
  TenantLayoutSchema,
} from '@arenalive/shared';
import { initBranding, setTenantLook, tenantLookOf } from '../lib/branding.ts';
import { setSystemLogos } from '../lib/systemLogos.ts';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { TV_ROOT_CLASS } from '../lib/tvScreen.ts';
import { previewState } from '../lib/intermission.ts';
import { matchPoints, matchStateUntilPoint } from '@arenalive/volley-stats';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { resetSchedule } from '../lib/schedule.ts';
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
/** What the mocked socket gives (a test may change it and render again). */
let socketSnapshot: LiveSnapshot = snapshot;
/** Options the page gave to the socket (the `hello` of the statistics). */
let socketOptions: { hello?: () => string | null } | undefined;
vi.mock('../lib/useLiveSocket.ts', () => ({
  socketUrl: (path: string) => `ws://test${path}`,
  useLiveSocket: (_url: string | null, options?: { hello?: () => string | null }) => {
    socketOptions = options;
    return socketSnapshot;
  },
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
  socketSnapshot = snapshot;
  act(() => setTenantLook(null));
  act(() => setSystemLogos(NO_SYSTEM_LOGOS));
  document.body.removeAttribute('style');
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

  it('the buttons over the match (pause of the rotation, «Torna alla partita») are not there while the look is null', () => {
    vi.useFakeTimers();
    setWidth(1920);
    renderAt();
    // Look not loaded: the page controls stay, the context of the match says «no touch».
    expect(screen.queryByRole('button', { name: 'Torna alla partita' })).toBeNull();
    expect(document.querySelector('[data-intermission] button')).toBeNull();
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
          intermissions: defaultIntermissions(),
          overlays: defaultOverlays(),
          sponsors: [],
          players: [],
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

describe('LivePage without «Touch»', () => {
  it('tablet and phone without touch are screens without scrolling (fixed height, groups); with touch the page scrolls', () => {
    const lookWith = (touch: boolean) =>
      tenantLookOf({
        name: 'Sir Safety',
        branding: defaultBranding(),
        images: { logoMain: null, logoMark: null, sponsorLogo: null },
        layout: TenantLayoutSchema.parse({ touch: { tv: true, tablet: touch, phone: touch } }),
        intermissions: defaultIntermissions(),
        overlays: defaultOverlays(),
        sponsors: [],
        players: [],
      });
    const SCROLL = '.overflow-y-auto, .overflow-auto, .overflow-scroll, .sir-scroll-x';
    for (const [width, height] of [
      [1024, 768],
      [390, 844],
    ] as const) {
      act(() => setTenantLook(lookWith(false)));
      setWidth(width, height);
      const off = renderAt();
      const root = off.container.querySelector('[data-device]');
      expect(root?.className).toContain('h-dvh');
      expect(root?.className).toContain('overflow-hidden');
      expect(off.container.querySelector('[data-layout="screens"]')).toBeTruthy();
      expect(off.container.querySelector(SCROLL)).toBeNull();
      off.unmount();
      act(() => setTenantLook(lookWith(true)));
      const on = renderAt();
      expect(on.container.querySelector('[data-device]')?.className).toContain('min-h-dvh');
      expect(on.container.querySelector('[data-layout="screens"]')).toBeNull();
      on.unmount();
    }
  });
});

describe('LivePage pauses of the client', () => {
  it('opened during the end of a set: the pause of the client over the page, Esc goes back to the match', () => {
    const data = snapshot.data;
    if (data?.kind !== 'state') throw new Error('stato mancante');
    const previous = data.state;
    data.state = previewState(previous, 'setBreak', 1);
    try {
      act(() =>
        setTenantLook(
          tenantLookOf({
            name: 'Sir Safety',
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
      setWidth(1024);
      renderAt();
      expect(screen.getByRole('dialog', { name: 'Fine 1° set' })).toBeTruthy();
      expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      data.state = previous;
    }
  });
});

describe('LivePage pauses without the graphics of the client', () => {
  /** Runs `body` with the state of the snapshot at the end of the 1st set. */
  async function atEndOfSet(body: () => Promise<void> | void): Promise<void> {
    const data = snapshot.data;
    if (data?.kind !== 'state') throw new Error('stato mancante');
    const previous = data.state;
    data.state = previewState(previous, 'setBreak', 1);
    try {
      await body();
    } finally {
      data.state = previous;
    }
  }

  it('while the graphics are loading: no pause', async () => {
    await atEndOfSet(() => {
      setWidth(1024);
      renderAt();
      expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('graphics not available (404): no pause, never the default one', async () => {
    await atEndOfSet(async () => {
      const notFound = vi.fn(() => Promise.resolve(new Response('{"error":"Non trovato"}', { status: 404 })));
      await act(() => initBranding({ fetch: notFound as unknown as typeof fetch }));
      expect(notFound).toHaveBeenCalledTimes(1);
      setWidth(1024);
      renderAt();
      expect(screen.getByRole('region', { name: 'Tabellone' })).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});

describe('LivePage as an app', () => {
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  });

  it('shows the discreet hint and the first tap on the page asks for full screen, once', () => {
    const request = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = request;
    renderAt();
    expect(screen.getByTestId('suggerimento-schermo-intero').textContent).toBe('Tocca per lo schermo intero');
    // a tap on a button is for the button: nothing yet
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Schermo intero' }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('suggerimento-schermo-intero')).toBeNull();
    fireEvent.pointerDown(document.body);
    expect(request).toHaveBeenCalledTimes(1);
    // the button «Schermo intero» is still there
    expect(screen.getByRole('button', { name: 'Schermo intero' })).toBeTruthy();
  });

  it('no hint without the Fullscreen API', () => {
    renderAt();
    expect(screen.queryByTestId('suggerimento-schermo-intero')).toBeNull();
  });

  it('registers the service worker where it is supported; the install button only when the browser offers it', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { register }, wakeLock: { request } });
    renderAt();
    await act(() => Promise.resolve());
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(screen.queryByRole('button', { name: 'Installa come app' })).toBeNull();
    const prompt = vi.fn(() => Promise.resolve());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Installa come app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('on iPhone, which has no prompt, «Installa come app» shows the short instructions', () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
      wakeLock: { request },
    });
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'Installa come app' }));
    expect(screen.getByText(/tocca Condividi/)).toBeTruthy();
    expect(screen.getByText(/«Aggiungi a Home»/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByText(/Aggiungi a Home/)).toBeNull();
  });
});

describe('LivePage: punti arrivati insieme', () => {
  it('tre punti in un solo aggiornamento: il tabellone li mostra uno alla volta, poi lo stato del server', () => {
    vi.useFakeTimers();
    setWidth(1024);
    const full = midMatchState();
    const total = matchPoints(full).length;
    const withState = (live: boolean, state = full) =>
      ({ ...snapshot, data: { ...snapshot.data, live, state } }) as LiveSnapshot;
    /** Text for screen readers of the scoreboard: «Punteggio del N° set: casa X, ospiti Y». */
    const scoreLine = () =>
      [...document.querySelectorAll('*')].find(
        (el) => el.children.length === 0 && el.textContent?.startsWith('Punteggio del') === true,
      )?.textContent ?? '';
    const expectScoreOf = (n: number) => {
      const { live } = n >= total ? full : matchStateUntilPoint(full, n);
      expect(scoreLine()).toMatch(new RegExp(` ${live.homeScore}, .* ${live.awayScore}$`));
    };
    // A new element at every render (the same element would not render the page again).
    const page = () => (
      <MemoryRouter initialEntries={[`/live/${TOKEN}`]}>
        <Routes>
          <Route path="/live/:token" element={<LivePage />} />
        </Routes>
      </MemoryRouter>
    );
    socketSnapshot = withState(false, matchStateUntilPoint(full, total - 3));
    const view = render(page());
    expectScoreOf(total - 3);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    socketSnapshot = withState(true);
    view.rerender(page());
    expectScoreOf(total - 2);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expectScoreOf(total - 1);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expectScoreOf(total);
  });
});

describe('LivePage of a simulated match', () => {
  const simulated = (state = midMatchState()): LiveSnapshot => ({
    ...snapshot,
    data: { kind: 'state', matchId: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', version: 3, state, simulated: true },
  });

  it('shows the label «Simulazione» on phone, tablet and big screen; never on a real match', () => {
    for (const width of [390, 1024, 1920]) {
      setWidth(width);
      socketSnapshot = simulated();
      const view = renderAt();
      expect(screen.getByTestId('simulation-label').textContent).toBe('Simulazione');
      view.unmount();
    }
    socketSnapshot = snapshot;
    renderAt();
    expect(screen.queryByTestId('simulation-label')).toBeNull();
  });

  it('keeps the label above the full-screen pause between two sets', () => {
    act(() =>
      setTenantLook(
        tenantLookOf({
          name: 'Sir Safety',
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
    socketSnapshot = simulated(previewState(midMatchState(), 'setBreak', 1));
    setWidth(1024);
    renderAt();
    const dialog = screen.getByRole('dialog', { name: 'Fine 1° set' });
    const label = screen.getByTestId('simulation-label');
    expect(label.className).toContain('fixed');
    // Over the pause (z-50) and the avvisi (z-45).
    expect(label.className).toContain('z-[60]');
    expect(dialog.className).toContain('z-50');
  });

  it('tells the server how the page was opened (statistics): QR, device, one id per page, nothing stored', () => {
    setWidth(390, 800);
    const { unmount } = renderAt('?q=1');
    const first = JSON.parse(socketOptions?.hello?.() ?? 'null') as Record<string, unknown>;
    expect(first).toMatchObject({ type: 'hello', device: 'phone', source: 'qr', app: false });
    expect(String(first.visit)).toMatch(/^[0-9a-f]{32}$/);
    // The same page keeps its id (a reconnection joins the visit); a new page has another one.
    expect(JSON.parse(socketOptions?.hello?.() ?? 'null')).toEqual(first);
    unmount();
    renderAt('');
    const second = JSON.parse(socketOptions?.hello?.() ?? 'null') as Record<string, unknown>;
    expect(second.source).toBe('link');
    expect(second.visit).not.toBe(first.visit);
    expect(document.cookie).toBe('');
  });
});

describe('LivePage: loghi di sistema', () => {
  const LOGO = {
    url: '/api/public/system-logos/00000000-0000-4000-8000-000000000001',
    mime: 'image/png',
    width: 150,
    height: 50,
  } as const;
  const RIGHT = { ...LOGO, url: '/api/public/system-logos/00000000-0000-4000-8000-000000000002', width: 100 };
  const LEFT_DARK = { ...LOGO, url: '/api/public/system-logos/00000000-0000-4000-8000-000000000003' };
  const pair = (positive: SystemLogo | null, negative: SystemLogo | null = null) => ({ positive, negative });

  it('none loaded: no row and no empty room above the page', () => {
    renderAt();
    expect(screen.queryByTestId('loghi-di-sistema')).toBeNull();
  });

  it('one at the left and one at the right, on the phone (scaled with the screen) and on the big screen', () => {
    act(() => setSystemLogos({ left: pair(LOGO), right: pair(RIGHT) }));
    setWidth(360);
    const phone = renderAt();
    const row = screen.getByTestId('loghi-di-sistema');
    const [left, right] = Array.from(row.querySelectorAll('img'));
    expect(left?.getAttribute('src')).toBe(LOGO.url);
    expect(left?.dataset.systemLogo).toBe('sinistra');
    expect(right?.getAttribute('src')).toBe(RIGHT.url);
    expect(right?.dataset.systemLogo).toBe('destra');
    expect(left?.className).toContain('max-w-[min(150px,25vw)]');
    expect(left?.className).toContain('max-h-[min(50px,8.33vw)]');
    expect(left?.className).toContain('object-contain');
    phone.unmount();
    setWidth(1920);
    renderAt();
    expect(device(document.body)).toBe('tv');
    expect(screen.getByTestId('loghi-di-sistema').querySelectorAll('img')).toHaveLength(2);
  });

  it('with the bar the brand is not repeated in the page header; without it the brand stays', () => {
    const view = renderAt();
    expect(document.querySelector('[data-product-logo]')).not.toBeNull();
    view.unmount();
    act(() => setSystemLogos({ left: pair(LOGO), right: pair(null) }));
    renderAt();
    expect(screen.getByTestId('loghi-di-sistema')).toBeTruthy();
    expect(document.querySelector('[data-product-logo]')).toBeNull();
  });

  it('only the right one: the left side stays empty, the logo stays at the right', () => {
    act(() => setSystemLogos({ left: pair(null), right: pair(null, RIGHT) }));
    renderAt();
    const row = screen.getByTestId('loghi-di-sistema');
    expect(row.querySelectorAll('img')).toHaveLength(1);
    expect(row.querySelector('img')?.getAttribute('data-system-logo')).toBe('destra');
    expect(row.lastElementChild?.querySelector('img')?.getAttribute('src')).toBe(RIGHT.url);
    // Only the negative one is loaded: it stands also on a light background.
    expect(row.querySelector('img')?.getAttribute('data-system-logo-variant')).toBe('negative');
  });

  it('the variant follows the background behind: positive on a light one, negative on a dark one', async () => {
    act(() => setSystemLogos({ left: pair(LOGO, LEFT_DARK), right: pair(RIGHT) }));
    document.body.style.backgroundColor = '#ffffff';
    renderAt();
    const left = () => screen.getByTestId('loghi-di-sistema').querySelector('[data-system-logo="sinistra"]');
    expect(left()?.getAttribute('src')).toBe(LOGO.url);
    expect(left()?.getAttribute('data-system-logo-variant')).toBe('positive');
    act(() => {
      document.body.style.backgroundColor = '#0f172a';
    });
    await waitFor(() => expect(left()?.getAttribute('src')).toBe(LEFT_DARK.url));
    expect(left()?.getAttribute('data-system-logo-variant')).toBe('negative');
    // The right side has no negative: the positive stays, also on the dark background.
    const right = screen.getByTestId('loghi-di-sistema').querySelector('[data-system-logo="destra"]');
    expect(right?.getAttribute('src')).toBe(RIGHT.url);
    expect(right?.getAttribute('data-system-logo-variant')).toBe('positive');
  });
});

describe('LivePage «Dopo la partita»', () => {
  const IMAGE = '1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
  const END = '2026-10-23T19:00:00.000Z';
  const NEXT = {
    startsAt: '2026-10-25T17:00:00.000Z',
    home: { name: 'Sir Susa Scai Perugia', logoUrl: null },
    away: { name: 'Itas Trentino', logoUrl: null },
    ourSide: 'home',
    venue: null,
    venueCity: null,
    roundLabel: '3ª Giornata Andata',
    leagueName: null,
    live: false,
    shortUrl: null,
  };

  function lookWith(touch: boolean): void {
    const layout = TenantLayoutSchema.parse({ touch: { tv: touch, tablet: touch, phone: touch } });
    act(() =>
      setTenantLook(
        tenantLookOf({
          name: 'Sir Safety',
          branding: defaultBranding(),
          images: { logoMain: null, logoMark: null, sponsorLogo: null },
          layout,
          intermissions: { ...defaultIntermissions(), afterMatch: { enabled: true, image: IMAGE, delayMinutes: 30 } },
          overlays: defaultOverlays(),
          sponsors: [],
          players: [],
        }),
      ),
    );
  }

  function finishedMatch(): void {
    socketSnapshot = {
      ...snapshot,
      data: {
        kind: 'state',
        matchId: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11',
        version: 9,
        state: stateAfter(),
        finishedAt: END,
      },
    };
  }

  function stubSchedule(fixtures: unknown[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/public/tenant/schedule'
          ? new Response(JSON.stringify({ fixtures, standings: null }), { status: 200 })
          : new Response('{"error":"Non trovato"}', { status: 404 }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const flush = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

  afterEach(() => resetSchedule());

  it('the end-of-match pause first; after the minutes the photo full screen with the countdown, no pause nor overlay', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-23T19:10:00.000Z') });
    stubSchedule([NEXT]);
    lookWith(true);
    finishedMatch();
    setWidth(1024);
    renderAt();
    expect(screen.queryByTestId('dopo-partita')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
    });
    await flush();
    const after = screen.getByTestId('dopo-partita');
    expect(after.querySelector('img')?.getAttribute('src')).toBe(`/api/public/assets/${IMAGE}`);
    expect(after.querySelector('img')?.className).toContain('object-cover');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(after).getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    expect(within(after).getByText('Sir Susa Scai Perugia')).toBeTruthy();
    expect(within(after).getByText('Itas Trentino')).toBeTruthy();
    expect(within(after).getByText(/ore 18:00/)).toBeTruthy();
    expect(within(after).getByRole('timer').getAttribute('aria-label')).toBe('Mancano 1 giorni, 21 ore e 30 minuti');
    expect(within(after).queryAllByRole('button')).toHaveLength(0);
    expect(within(after).queryAllByRole('link')).toHaveLength(0);
  });

  it('without a next match only the photo; the same with «Touch» off', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-23T20:00:00.000Z') });
    stubSchedule([]);
    lookWith(false);
    finishedMatch();
    setWidth(1920);
    renderAt();
    await flush();
    await flush();
    const after = screen.getByTestId('dopo-partita');
    expect(after.querySelector('img')).toBeTruthy();
    expect(within(after).queryByRole('heading')).toBeNull();
    expect(within(after).queryByRole('timer')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('a match still being played, or without the end time (older server): never', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-24T08:00:00.000Z') });
    stubSchedule([NEXT]);
    lookWith(true);
    socketSnapshot = {
      ...snapshot,
      data: { kind: 'state', matchId: '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11', version: 9, state: stateAfter() },
    };
    setWidth(1024);
    renderAt();
    await flush();
    expect(screen.queryByTestId('dopo-partita')).toBeNull();
    cleanup();
    socketSnapshot = snapshot;
    renderAt();
    await flush();
    expect(screen.queryByTestId('dopo-partita')).toBeNull();
  });
});
