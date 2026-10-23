import type { TenantIntermissionsInput } from '@arenalive/shared';
import { defaultIntermissions, TenantIntermissionsSchema, THANKS_MESSAGE } from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import { MATCH_PERIOD } from '@arenalive/volley-stats';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePause, duelRoles, previewState, visibleSlides } from '../lib/intermission.ts';
import type { Device } from '../lib/layout.ts';
import { midMatchState, scoreAt, stateAfter } from '../test/fixtures.ts';
import { ROLE_LABELS } from '../blocks/StatSlides.tsx';
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

  it('tells when a full screen pause is on screen (the overlays of the events stay away from it)', () => {
    const onFullscreenChange = vi.fn();
    const config = TenantIntermissionsSchema.parse({});
    const element = (s: MatchState, device: Device) => (
      <Intermission state={s} config={config} device={device} paused={false} onFullscreenChange={onFullscreenChange} />
    );
    const view = render(element(setBreak, 'tablet'));
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true);
    view.rerender(element(setBreak, 'phone'));
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
    view.rerender(element(setBreak, 'tablet'));
    expect(onFullscreenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
    view.rerender(element(inPlay, 'tablet'));
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
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

  it('the full screen pause and the banner are opaque from the first frame: never the page through them', () => {
    // An opacity animation (sir-flash, sir-fade) on the dialog itself left it see-through while it ran, or for good in a
    // browser that skips the frames: only its content may come in, the panel always has the opaque page background.
    const OPACITY_ANIMATIONS = /(^| )(sir-flash|sir-fade|sir-overlay|opacity-\d+|bg-bg\/\d+)( |$)/;
    setup(setBreak, { device: 'tablet' });
    const full = dialog();
    expect(full?.className).toMatch(/(^| )bg-bg( |$)/);
    expect(full?.className).toMatch(/(^| )fixed( |$)/);
    expect(full?.className).toMatch(/(^| )inset-0( |$)/);
    expect(full?.className).not.toMatch(OPACITY_ANIMATIONS);
    expect(full?.querySelector('header')?.className).toContain('sir-flash');
    // The slide scrolls inside the dialog, which stays as tall as the screen.
    const slide = full?.querySelector('.overflow-y-auto');
    expect(slide?.parentElement).toBe(full);
    cleanup();
    setup(setBreak, { device: 'phone' });
    expect(banner()?.className).toMatch(/(^| )bg-surface( |$)/);
    expect(banner()?.className).not.toMatch(OPACITY_ANIMATIONS);
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
    expect(screen.getByText('Miglior Realizzatore della partita')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('Parziale e marcatori')).toBeTruthy();
    // statistics of the whole match, the duels of every role in turn
    expect(screen.getByLabelText(`Set vinti ${finished.setsWon.home} a ${finished.setsWon.away}`)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const roles = duelRoles(finished, MATCH_PERIOD);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(screen.getByRole('dialog').textContent).toContain(`Sfida tra ${ROLE_LABELS[role].many}`);
      act(() => {
        vi.advanceTimersByTime(8000);
      });
    }
    expect(screen.getByText('Squadre a confronto')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(THANKS_MESSAGE)).toBeTruthy();
    // the sponsor slide without images nor sponsor logo is skipped: back to the first one
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByText('Risultato finale')).toBeTruthy();
    expect(screen.getByRole('img', { name: `Schermata 1 di ${5 + roles.length}` })).toBeTruthy();
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
    expect(screen.getByText('Miglior Realizzatore della partita')).toBeTruthy();
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

  it('a slide turned off is never shown, with the others of its pause', () => {
    const state = previewState(mid, 'timeout');
    const active = activePause(state, defaultIntermissions());
    if (!active) throw new Error('no pause');
    const [sponsor] = active.pause.slides;
    if (!sponsor) throw new Error('no slide');
    const off = { ...active, pause: { ...active.pause, slides: [{ ...sponsor, enabled: false }] } };
    expect(visibleSlides(state, active, { sponsorLogo: '/logo.png' })).toHaveLength(1);
    expect(visibleSlides(state, off, { sponsorLogo: '/logo.png' })).toEqual([]);
  });
});

describe('Intermission: «ogni N punti»', () => {
  function live(device: Device = 'tablet', config: TenantIntermissionsInput = {}) {
    const parsed = TenantIntermissionsSchema.parse(config);
    const element = (s: MatchState, isLive: boolean) => (
      <Intermission state={s} live={isLive} config={parsed} device={device} paused={false} />
    );
    const view = render(element(scoreAt(4, 3), false));
    return { update: (s: MatchState, isLive = true) => view.rerender(element(s, isLive)) };
  }
  const shown = () => document.querySelector('[data-intermission]');
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('opens at a new threshold after its delay, as a banner with the score, shows its slides once and closes', () => {
    const page = live();
    page.update(scoreAt(4, 4));
    expect(shown()).toBeNull();
    wait(3000);
    expect(banner()?.textContent).toContain(`${mid.live.set}° set: 4-4`);
    expect(banner()?.textContent).toContain('Marcatori · ');
    // the next point does not close it nor restart it
    page.update(scoreAt(5, 4));
    wait(8000);
    expect(banner()?.textContent).toContain('Squadre · ');
    wait(8000);
    expect(shown()).toBeNull();
    page.update(scoreAt(6, 4));
    wait(5000);
    expect(shown()).toBeNull();
  });

  it('full screen on the TV', () => {
    const page = live('tv');
    page.update(scoreAt(4, 4));
    wait(3000);
    expect(screen.getByRole('dialog', { name: `${mid.live.set}° set: 4-4` })).toBeTruthy();
  });

  it('nothing at the first state, after a reconnection, past «non dopo il punto», or after a correction', () => {
    const page = live();
    // reconnection: the state with the threshold is not a live update
    page.update(scoreAt(4, 4), false);
    page.update(scoreAt(5, 4));
    wait(5000);
    expect(shown()).toBeNull();
    // the scout takes the point back, then gives it again: same threshold, nothing
    page.update(scoreAt(4, 3));
    page.update(scoreAt(4, 4));
    wait(5000);
    expect(shown()).toBeNull();
    // last part of the set
    page.update(scoreAt(21, 10));
    page.update(scoreAt(21, 11));
    wait(5000);
    expect(shown()).toBeNull();
  });

  it('a time-out goes first: it closes the «ogni N punti» and that threshold does not come back', () => {
    const page = live('tablet', { timeout: { slides: [{ id: 'm', type: 'message' }] } });
    page.update(scoreAt(4, 4));
    wait(3000);
    expect(banner()?.textContent).toContain('Marcatori · ');
    const timeoutAt = previewState(scoreAt(4, 4), 'timeout');
    page.update(timeoutAt);
    expect(banner()?.textContent).toContain('Time-out');
    page.update(scoreAt(5, 4));
    wait(5000);
    expect(shown()).toBeNull();
    // a threshold reached during a pause is not shown after it
    page.update(previewState(scoreAt(8, 8), 'timeout'));
    page.update(scoreAt(9, 8));
    wait(5000);
    expect(shown()).toBeNull();
  });

  it('off: nothing', () => {
    const page = live('tablet', { milestone: { enabled: false } });
    page.update(scoreAt(4, 4));
    wait(5000);
    expect(shown()).toBeNull();
  });
});
