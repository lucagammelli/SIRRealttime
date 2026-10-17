import { parseDvw } from '@sir/dvw-parser';
import { generateMatch, renderDvw } from '@sir/dvw-simulator';
import type { MatchState } from '@sir/volley-stats';
import { computeMatchState, matchPoints } from '@sir/volley-stats';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POINT_SEQUENCE_MAX_POINTS,
  POINT_STEP_MS,
  PointSequencer,
  planPointSequence,
  usePointSequence,
} from './pointSequence.ts';

const match = generateMatch({ seed: 4, sets: 3 });
const parsed = parseDvw(renderDvw(match, match.lines.length));
const pointRows = parsed.scout.filter((e) => e.kind === 'point').map((e) => e.index);

/** State of the file cut right after the `count`-th point (with the `**Nset` line that follows it). */
function after(count: number): MatchState {
  const row = pointRows[count - 1] ?? -1;
  const end = parsed.scout[row + 1]?.kind === 'setEnd' ? row + 2 : row + 1;
  return computeMatchState(parseDvw(renderDvw(match, end)));
}

const score = (s: MatchState): string => `${s.live.set}:${s.live.homeScore}-${s.live.awayScore}`;
const LIVE = { live: true, reducedMotion: false };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('planPointSequence', () => {
  const plan = (shown: MatchState | null, next: MatchState, options = LIVE) => {
    const p = planPointSequence(shown, next, options);
    return { paced: p.paced, steps: p.steps.map(score), last: p.steps.at(-1) };
  };

  it('un punto nuovo: un passo, lo stato del server', () => {
    const next = after(11);
    expect(plan(after(10), next)).toEqual({ paced: true, steps: [score(next)], last: next });
  });

  it('tre punti nuovi: uno alla volta, l’ultimo è lo stato del server', () => {
    const next = after(13);
    const p = plan(after(10), next);
    expect(p.paced).toBe(true);
    expect(p.steps).toEqual([after(11), after(12), next].map(score));
    expect(p.last).toBe(next);
  });

  it('troppi punti nuovi (oltre 3 s): salto alla fine', () => {
    expect(POINT_SEQUENCE_MAX_POINTS).toBe(5);
    const next = after(20);
    expect(plan(after(10), next)).toEqual({ paced: false, steps: [score(next)], last: next });
    expect(plan(after(10), after(15)).steps).toHaveLength(5);
  });

  it('primo stato, stato non live, movimento ridotto, nessun punto nuovo e storia riscritta: subito la fine', () => {
    const next = after(13);
    expect(plan(null, next).paced).toBe(false);
    expect(plan(after(10), next, { live: false, reducedMotion: false }).paced).toBe(false);
    expect(plan(after(10), next, { live: true, reducedMotion: true }).paced).toBe(false);
    expect(plan(after(13), next).paced).toBe(false);
    const rewritten = structuredClone(after(10));
    const p = rewritten.momentum.sets[0]?.points[4];
    if (p) p.scorer = p.scorer === 'home' ? 'away' : 'home';
    expect(plan(rewritten, next)).toEqual({ paced: false, steps: [score(next)], last: next });
    // Points taken away: the earlier state as it is.
    const back = after(8);
    expect(plan(after(10), back)).toEqual({ paced: false, steps: [score(back)], last: back });
  });

  it('fine set dentro la sequenza: la pausa arriva solo con lo stato vero', () => {
    const endOfSet1 = matchPoints(after(pointRows.length)).filter((p) => p.set === 1).length;
    const next = after(endOfSet1);
    expect(next.phase.kind).toBe('setBreak');
    const { steps } = planPointSequence(after(endOfSet1 - 3), next, LIVE);
    expect(steps).toHaveLength(3);
    expect(steps.slice(0, -1).every((s) => s.phase.kind === 'rally')).toBe(true);
    expect(steps.at(-1)?.phase.kind).toBe('setBreak');
  });
});

describe('PointSequencer', () => {
  beforeEach(() => vi.useFakeTimers());

  it('mostra i punti ogni 600 ms e finisce sullo stato del server', () => {
    const seen: string[] = [];
    const seq = new PointSequencer((s) => seen.push(score(s)));
    seq.push(after(10), LIVE);
    vi.advanceTimersByTime(5000);
    seq.push(after(13), LIVE);
    expect(seen).toEqual([score(after(10)), score(after(11))]);
    vi.advanceTimersByTime(POINT_STEP_MS - 1);
    expect(seen).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(seen.at(-1)).toBe(score(after(12)));
    vi.advanceTimersByTime(POINT_STEP_MS);
    expect(seen.at(-1)).toBe(score(after(13)));
    expect(seq.current && score(seq.current)).toBe(score(after(13)));
    vi.advanceTimersByTime(10 * POINT_STEP_MS);
    expect(seen).toHaveLength(4);
  });

  it('dieci punti: salto immediato; un aggiornamento durante la sequenza riparte da ciò che è a video', () => {
    const seen: string[] = [];
    const seq = new PointSequencer((s) => seen.push(score(s)));
    seq.push(after(10), LIVE);
    seq.push(after(20), LIVE);
    expect(seen).toEqual([score(after(10)), score(after(20))]);
    vi.advanceTimersByTime(5000);
    seq.push(after(23), LIVE);
    expect(seen.at(-1)).toBe(score(after(21)));
    seq.push(after(24), LIVE);
    // From 21 on screen to 24: 22 when 21 has been on screen for 600 ms, then 23 and 24.
    expect(seen.at(-1)).toBe(score(after(21)));
    vi.advanceTimersByTime(3 * POINT_STEP_MS);
    expect(seen.slice(-3)).toEqual([after(22), after(23), after(24)].map(score));
  });

  it('aggiornamenti di un punto ravvicinati (coda dell’agente): uno ogni 600 ms, oltre 3 s salto alla fine', () => {
    const seen: string[] = [];
    const seq = new PointSequencer((s) => seen.push(score(s)));
    seq.push(after(10), LIVE);
    vi.advanceTimersByTime(5000);
    seq.push(after(11), LIVE);
    seq.push(after(12), LIVE);
    seq.push(after(13), LIVE);
    expect(seen).toEqual([after(10), after(11)].map(score));
    vi.advanceTimersByTime(POINT_STEP_MS);
    expect(seen.at(-1)).toBe(score(after(12)));
    vi.advanceTimersByTime(POINT_STEP_MS);
    expect(seen.at(-1)).toBe(score(after(13)));
    // 13 shown just now: 14..19 would end 3.6 s from now, too late: straight to 19.
    for (let n = 14; n <= 19; n++) seq.push(after(n), LIVE);
    expect(seen.at(-1)).toBe(score(after(19)));
    vi.advanceTimersByTime(10 * POINT_STEP_MS);
    expect(seen.at(-1)).toBe(score(after(19)));
  });

  it('riscrittura durante la sequenza: subito lo stato nuovo, nessun passo vecchio dopo', () => {
    const seen: string[] = [];
    const seq = new PointSequencer((s) => seen.push(score(s)));
    seq.push(after(10), LIVE);
    seq.push(after(14), LIVE);
    seq.push(after(9), LIVE);
    expect(seen.at(-1)).toBe(score(after(9)));
    vi.advanceTimersByTime(5 * POINT_STEP_MS);
    expect(seen.at(-1)).toBe(score(after(9)));
  });
});

function Probe({ state, live, id }: { state: MatchState | null; live: boolean; id: string }) {
  const shown = usePointSequence(state, live, id);
  return <output>{shown ? score(shown) : 'nessuno'}</output>;
}

describe('usePointSequence', () => {
  beforeEach(() => vi.useFakeTimers());

  it('primo stato subito, poi i punti uno alla volta; partita nuova: subito', () => {
    const view = render(<Probe state={after(10)} live={false} id="a" />);
    expect(view.container.textContent).toBe(score(after(10)));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    view.rerender(<Probe state={after(12)} live id="a" />);
    expect(view.container.textContent).toBe(score(after(11)));
    act(() => {
      vi.advanceTimersByTime(POINT_STEP_MS);
    });
    expect(view.container.textContent).toBe(score(after(12)));
    view.rerender(<Probe state={after(15)} live id="b" />);
    expect(view.container.textContent).toBe(score(after(15)));
    view.rerender(<Probe state={null} live={false} id="" />);
    expect(view.container.textContent).toBe('nessuno');
  });

  it('movimento ridotto: nessuna attesa tra i punti', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('reduced-motion'),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const view = render(<Probe state={after(10)} live id="a" />);
    view.rerender(<Probe state={after(13)} live id="a" />);
    expect(view.container.textContent).toBe(score(after(13)));
  });
});
