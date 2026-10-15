import type { TenantIntermissionsInput } from '@sir/shared';
import { defaultIntermissions, TenantIntermissionsSchema, THANKS_MESSAGE } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePause, previewState, visibleSlides } from '../lib/intermission.ts';
import type { Device } from '../lib/layout.ts';
import { midMatchState, stateAfter } from '../test/fixtures.ts';
import { Intermission } from './Intermission.tsx';

const SPONSOR = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';

const mid = midMatchState();
const inPlay = mid;
const setBreak = previewState(mid, 'setBreak', 1);
const timeout = previewState(mid, 'timeout');
const finished = stateAfter();

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

interface SetupOptions {
  device?: Device;
  config?: TenantIntermissionsInput;
  paused?: boolean;
  sponsorLogo?: string | null;
}

function setup(
  state: MatchState,
  { device = 'tablet', config = {}, paused = false, sponsorLogo = null }: SetupOptions = {},
) {
  const toggle = vi.fn();
  const props = (s: MatchState, p = paused) => (
    <Intermission
      state={s}
      config={TenantIntermissionsSchema.parse(config)}
      device={device}
      paused={p}
      onTogglePaused={toggle}
      sponsorLogo={sponsorLogo}
    />
  );
  const view = render(props(state));
  return { ...view, toggle, update: (s: MatchState, p?: boolean) => view.rerender(props(s, p)) };
}

const dialog = () => screen.queryByRole('dialog');
const banner = () => document.querySelector('[data-intermission="banner"]');

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Intermission: when it opens and closes', () => {
  it('opens at the end of a set after the delay chosen, and closes by itself at the first point', () => {
    const view = setup(inPlay, { config: { setBreak: { delaySeconds: 5 } } });
    expect(dialog()).toBeNull();
    view.update(setBreak);
    expect(dialog()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(dialog()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('dialog', { name: 'Fine 1° set' })).toBeTruthy();
    expect(screen.getByText('Riepilogo del 1° set')).toBeTruthy();
    // the next set starts: back to the match without doing anything
    view.update(inPlay);
    expect(dialog()).toBeNull();
  });

  it('is shown at once when the page opens during a pause', () => {
    setup(setBreak);
    expect(screen.getByRole('dialog', { name: 'Fine 1° set' })).toBeTruthy();
  });

  it('nothing without graphics, with the pause off or before the match', () => {
    render(<Intermission state={setBreak} config={null} device="tablet" paused={false} />);
    expect(dialog()).toBeNull();
    cleanup();
    setup(setBreak, { config: { setBreak: { enabled: false } } });
    expect(dialog()).toBeNull();
    cleanup();
    setup({ ...mid, phase: { kind: 'preMatch' } });
    expect(dialog()).toBeNull();
    // a state stored before the phase existed
    const old: Partial<MatchState> = { ...mid };
    delete old.phase;
    cleanup();
    setup(old as MatchState);
    expect(dialog()).toBeNull();
  });

  it('a set with its own pause uses it', () => {
    setup(setBreak, { config: { setBreakBySet: { '1': { slides: [{ id: 'q', type: 'qr' }] } } } });
    expect(screen.getByRole('heading', { name: 'Segui la partita sul telefono' })).toBeTruthy();
    expect(screen.queryByText('Riepilogo del 1° set')).toBeNull();
  });
});

describe('Intermission: full screen and banner', () => {
  it('end of set: full screen on the tablet, banner on the phone (the page stays visible)', () => {
    setup(setBreak, { device: 'tablet' });
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(banner()).toBeNull();
    cleanup();
    setup(setBreak, { device: 'phone' });
    expect(dialog()).toBeNull();
    expect(banner()).toBeTruthy();
    expect(banner()?.textContent).toContain('Fine 1° set');
    expect(screen.getByRole('status').textContent).toBe('Fine 1° set');
  });

  it('time-out: compact banner with the sponsor and the team that called it', () => {
    setup(timeout, {
      device: 'tv',
      config: { timeout: { slides: [{ id: 's', type: 'sponsor', options: { images: [SPONSOR] } }] } },
    });
    expect(banner()?.textContent).toContain('Time-out Pallavolo Città');
    expect(screen.getByRole('img', { name: 'Sponsor 1 di 1' })).toBeTruthy();
  });

  it('«Torna alla partita» and Esc close it, for this pause only; the focus goes to the button', () => {
    const view = setup(setBreak);
    const back = screen.getByRole('button', { name: 'Torna alla partita' });
    expect(document.activeElement).toBe(back);
    fireEvent.click(back);
    expect(dialog()).toBeNull();
    view.update(inPlay);
    view.update(previewState(finished, 'matchEnd'));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('dialog', { name: 'Fine partita' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog()).toBeNull();
  });

  it('the banner closes with «Chiudi» and Esc', () => {
    setup(setBreak, { device: 'phone' });
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(banner()).toBeNull();
    cleanup();
    setup(setBreak, { device: 'phone' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(banner()).toBeNull();
  });
});

describe('Intermission: slides', () => {
  it('end of match: result, MVP, thanks, each for its seconds', () => {
    setup(finished);
    expect(screen.getByRole('dialog', { name: 'Fine partita' })).toBeTruthy();
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('MVP della partita')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(THANKS_MESSAGE)).toBeTruthy();
    // the sponsor slide without images nor sponsor logo is skipped: back to the first one
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Schermata 1 di 3' })).toBeTruthy();
  });

  it('«Ferma rotazione» stops the slides (the same switch of the page)', () => {
    const view = setup(finished, { paused: true });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    const stop = screen.getByRole('button', { name: 'Ferma rotazione' });
    expect(stop.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(stop);
    expect(view.toggle).toHaveBeenCalledTimes(1);
    view.update(finished, false);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('MVP della partita')).toBeTruthy();
  });

  it('reduced motion: the first slide stays, no rotation button', () => {
    stubReducedMotion(true);
    setup(finished);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ferma rotazione' })).toBeNull();
  });

  it('texts of the client are plain text, never HTML', () => {
    setup(finished, {
      config: {
        matchEnd: { slides: [{ id: 'm', type: 'message', options: { text: '<img src=x onerror=alert(1)>' } }] },
      },
    });
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(dialog()?.querySelector('img[src="x"]')).toBeNull();
  });

  it('a sponsor slide without images uses the sponsor logo of the graphics', () => {
    const state = previewState(mid, 'timeout');
    const active = activePause(state, defaultIntermissions());
    expect(active?.kind).toBe('timeout');
    if (!active) return;
    expect(visibleSlides(state, active, { sponsorLogo: null })).toEqual([]);
    expect(visibleSlides(state, active, { sponsorLogo: '/logo.png' })).toHaveLength(1);
    setup(state, { sponsorLogo: '/api/public/assets/logo' });
    expect(screen.getByRole('img', { name: 'Sponsor' }).getAttribute('src')).toBe('/api/public/assets/logo');
  });
});
