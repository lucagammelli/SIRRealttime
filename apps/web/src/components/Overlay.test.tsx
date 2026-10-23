import type { TenantOverlaysInput } from '@arenalive/shared';
import { TenantOverlaysSchema } from '@arenalive/shared';
import type { MatchEvent, MatchState } from '@arenalive/volley-stats';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../lib/layout.ts';
import {
  eventsOf,
  nextOverlay,
  OVERLAY_MAX_AGE_MS,
  overlayFor,
  overlayValues,
  sampleEvent,
  unseenEvents,
} from '../lib/overlay.ts';
import { midMatchState, stateAfter, totalLines } from '../test/fixtures.ts';
import { Overlay } from './Overlay.tsx';

const base = midMatchState();

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

let line = 1000;
/** Event of `kind` for the home team at the score given (new index at every call). */
function event(kind: MatchEvent['kind'], extra: Partial<MatchEvent> = {}): MatchEvent {
  line += 1;
  return {
    id: `${kind}-${line}`,
    kind,
    index: line,
    set: 2,
    team: 'home',
    player: kind === 'ace' || kind === 'block' ? { number: 8, firstName: 'Mario', lastName: 'Rossi' } : null,
    playerOut: null,
    homeScore: 24,
    awayScore: 20,
    count: kind === 'run' ? 3 : null,
    priority: 5,
    ...extra,
  };
}

const withEvents = (events: MatchEvent[], state: MatchState = base): MatchState => ({ ...state, events });

interface SetupOptions {
  device?: Device;
  config?: TenantOverlaysInput;
  live?: boolean;
  blocked?: boolean;
}

function setup(initial: MatchState, { device = 'tv', config = {}, live = false, blocked = false }: SetupOptions = {}) {
  const parsed = TenantOverlaysSchema.parse(config);
  const element = (s: MatchState, l: boolean, b: boolean) => (
    <Overlay state={s} live={l} config={parsed} device={device} blocked={b} />
  );
  const view = render(element(initial, live, blocked));
  return {
    ...view,
    update: (s: MatchState, l = true, b = blocked) => view.rerender(element(s, l, b)),
  };
}

const region = () => document.querySelector('[data-overlay-region]');
const shown = () => region()?.textContent ?? '';
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Overlay: which events', () => {
  it('nothing for the events already there when the page opens; the region is aria-live polite', () => {
    const first = [event('ace'), event('matchPoint')];
    setup(withEvents(first));
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    expect(shown()).toBe('');
    advance(20_000);
    expect(shown()).toBe('');
  });

  it('a new event of a live update shows its text for the seconds chosen, then goes away', () => {
    const first = [event('block')];
    const view = setup(withEvents(first), { config: { ace: { seconds: 3 } } });
    view.update(withEvents([...first, event('ace')]));
    expect(shown()).toBe('ACE! Rossi');
    expect(document.querySelector('[data-overlay="home"]')?.className).toContain('bg-home');
    expect(document.querySelector('[data-overlay="home"]')?.className).toContain('sir-overlay');
    advance(2900);
    expect(shown()).toBe('ACE! Rossi');
    advance(100);
    expect(shown()).toBe('');
    // the same event again (another update of the same point): not repeated
    view.update(withEvents([...first, event('block', { id: first[0]?.id ?? '' })]));
    expect(shown()).toBe('');
  });

  it('nothing after a reconnection or a resync (not live), then the new live ones again', () => {
    const view = setup(withEvents([]));
    view.update(withEvents([event('ace')]), false);
    expect(shown()).toBe('');
    view.update(withEvents([event('setPoint', { team: 'away' })]), true);
    expect(shown()).toContain('SET POINT');
    expect(document.querySelector('[data-overlay="away"]')?.className).toContain('bg-away');
  });

  it('a past rally corrected by the scout gives no overlay; a corrected last rally gives the right one', () => {
    const past = event('setPoint', { index: 10 });
    const last = event('block', { index: 20 });
    const view = setup(withEvents([past, last]));
    // the scores after the corrected rally are rewritten: new ids, but before the last line already seen
    view.update(withEvents([event('setPoint', { id: 'setPoint-2-24-21', index: 10 }), last]));
    expect(shown()).toBe('');
    // the last rally corrected: the block becomes an ace on the same line
    view.update(withEvents([past, event('ace', { id: 'ace-2-24-20', index: 20 })]));
    expect(shown()).toBe('ACE! Rossi');
  });

  it('only on the devices chosen, only the events on', () => {
    const phone = setup(withEvents([]), { device: 'phone', config: { ace: { devices: { phone: false } } } });
    phone.update(withEvents([event('ace'), event('substitution'), event('timeout')]));
    expect(shown()).toBe('');
    phone.unmount();
    const tv = setup(withEvents([]), { device: 'tv' });
    tv.update(withEvents([event('timeout')]));
    // the time-out is off by default (the time-out pause says it)
    expect(shown()).toBe('');
  });

  it('a state stored before the events existed shows nothing and does not break', () => {
    const old = { ...base } as Partial<MatchState>;
    delete old.events;
    const view = setup(old as MatchState);
    view.update(old as MatchState);
    expect(shown()).toBe('');
  });
});

describe('Overlay: queue', () => {
  it('one at a time, by priority: the match point goes before the ace', () => {
    const view = setup(withEvents([]), { config: { matchPoint: { seconds: 4 }, ace: { seconds: 2 } } });
    view.update(withEvents([event('ace'), event('matchPoint')]));
    expect(shown()).toContain('MATCH POINT');
    expect(region()?.children).toHaveLength(1);
    advance(4000);
    expect(shown()).toBe('ACE! Rossi');
    advance(2000);
    expect(shown()).toBe('');
  });

  it('the priority chosen by the client wins over the default one', () => {
    const view = setup(withEvents([]), { config: { ace: { priority: 10 } } });
    view.update(withEvents([event('matchPoint'), event('ace')]));
    expect(shown()).toBe('ACE! Rossi');
  });

  it('an overlay waiting too long is dropped', () => {
    const view = setup(withEvents([]), { config: { matchPoint: { seconds: 8 }, setEnd: { seconds: 8 } } });
    view.update(withEvents([event('ace'), event('matchPoint'), event('setEnd')]));
    expect(shown()).toContain('MATCH POINT');
    advance(8000);
    expect(shown()).toContain('vince il 2° set');
    advance(8000);
    // the ace waited 16 s: no longer news
    expect(shown()).toBe('');
  });

  it('never over a full screen pause: what is on screen goes away, new events are dropped', () => {
    const view = setup(withEvents([]));
    view.update(withEvents([event('ace')]));
    expect(shown()).not.toBe('');
    view.update(withEvents([event('ace'), event('block')]), true, true);
    expect(shown()).toBe('');
    advance(10_000);
    expect(shown()).toBe('');
    view.update(withEvents([event('setPoint')]), true, false);
    expect(shown()).toContain('SET POINT');
  });
});

describe('Overlay: text and motion', () => {
  it('the text is plain text: names that look like HTML stay text', () => {
    const state = withEvents([], {
      ...base,
      teams: { ...base.teams, home: { name: '<img src=x onerror=alert(1)>', code: null } },
    });
    const view = setup(state);
    view.update(withEvents([event('setPoint')], state));
    expect(shown()).toBe('SET POINT <img src=x onerror=alert(1)>');
    expect(region()?.querySelector('img')).toBeNull();
  });

  it('with reduced motion: no animation', () => {
    stubReducedMotion(true);
    const view = setup(withEvents([]));
    view.update(withEvents([event('ace')]));
    expect(document.querySelector('[data-overlay]')?.className).not.toContain('sir-overlay');
  });
});

describe('overlays: pure functions', () => {
  it('placeholders of an event: player, number, team, score, set, run', () => {
    expect(overlayValues(event('ace'), base)).toMatchObject({
      giocatore: 'Rossi',
      numero: '8',
      punteggio: '24-20',
      set: '2',
    });
    expect(overlayValues(event('run'), base).serie).toBe('3');
    expect(overlayValues(event('longRally', { count: 5 }), base).attacchi).toBe('5');
    expect(overlayValues(event('tie', { team: null }), base).squadra).toBeUndefined();
    expect(sampleEvent('run', base)).toMatchObject({ kind: 'run', count: 3, team: 'home' });
  });

  it('queue: old ones out, then the highest priority, then the earlier one', () => {
    const q = (id: string, priority: number, receivedAt: number, index: number) => ({
      id,
      text: id,
      team: null,
      seconds: 4,
      position: 'top' as const,
      size: 'medium' as const,
      priority,
      receivedAt,
      index,
    });
    const now = 100_000;
    const queue = [q('vecchio', 10, now - OVERLAY_MAX_AGE_MS - 1, 1), q('a', 5, now, 3), q('b', 5, now, 2)];
    const { next, rest } = nextOverlay(queue, now);
    expect(next?.id).toBe('b');
    expect(rest.map((r) => r.id)).toEqual(['a']);
    expect(nextOverlay([], now).next).toBeNull();
  });

  it('seen events: each once', () => {
    const seen = new Set<string>();
    const a = event('ace');
    expect(unseenEvents([a], seen)).toEqual([a]);
    expect(unseenEvents([a], seen)).toEqual([]);
  });

  it('real states line by line: every new event shown once, none at the opening', () => {
    const config = { run: { enabled: false } };
    const parsed = TenantOverlaysSchema.parse(config);
    const from = Math.floor(totalLines * 0.3);
    const initial = stateAfter(from);
    const view = setup(initial, { config });
    expect(shown()).toBe('');
    const seen = new Set(eventsOf(initial).map((e) => e.id));
    let expected = 0;
    let count = 0;
    for (let k = from + 1; k <= Math.floor(totalLines * 0.4); k++) {
      const state = stateAfter(k);
      expected += unseenEvents(eventsOf(state), seen).filter((e) => overlayFor(e, state, parsed, 'tv', 0)).length;
      view.update(state);
      for (let i = 0; i < 3; i++) {
        if (shown()) count++;
        advance(4000);
      }
    }
    expect(expected).toBeGreaterThan(0);
    expect(count).toBe(expected);
  });
});

describe('Overlay: position and size', () => {
  const showAce = (config: TenantOverlaysInput, device: Device = 'tv') => {
    const first = [event('block')];
    const view = setup(withEvents(first), { config, device });
    view.update(withEvents([...first, event('ace')]));
  };
  const box = () => document.querySelector('[data-overlay]') as HTMLElement;

  it('default: near the top and medium, as before the setting existed', () => {
    showAce({});
    expect(region()?.className).toContain('top-[12%]');
    expect(box().dataset.size).toBe('medium');
    expect(box().className).toContain('text-4xl');
  });

  it('general setting: centre and large; the region never takes clicks', () => {
    showAce({ position: 'center', size: 'large' });
    expect(region()?.getAttribute('data-overlay-region')).toBe('center');
    expect(region()?.className).toContain('items-center');
    expect(region()?.className).toContain('pointer-events-none');
    expect(box().className).toContain('text-6xl');
  });

  it('own value of an overlay beats the general setting; bottom stays above the pause banner', () => {
    showAce({ position: 'center', size: 'large', ace: { position: 'bottom', size: 'small' } }, 'phone');
    expect(region()?.className).toContain('bottom-[14%]');
    expect(region()?.className).toContain('pointer-events-none');
    expect(box().className).toContain('text-base');
  });

  it('the queued overlay carries the placement of its configuration', () => {
    const parsed = TenantOverlaysSchema.parse({ size: 'small', matchEnd: { position: 'center' } });
    const state = withEvents([]);
    const queued = overlayFor(event('matchEnd'), state, parsed, 'tv', 0);
    expect(queued).toMatchObject({ position: 'center', size: 'small' });
  });
});
