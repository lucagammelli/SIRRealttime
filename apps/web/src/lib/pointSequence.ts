/**
 * Points shown one at a time on the public page. A single live update can carry several new points (DataVolley saved
 * the file after more rallies, a slow send): applied at once both scores would jump together. The intermediate states
 * come from @sir/volley-stats (`matchStateUntilPoint`), never computed here; the state of the server stays the truth,
 * the sequence is only how it is shown and always ends on it.
 */
import type { MatchState } from '@sir/volley-stats';
import { matchPoints, matchStateUntilPoint, pointsExtend } from '@sir/volley-stats';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from './theme.ts';

/** Time each point stays on screen before the next one. */
export const POINT_STEP_MS = 600;
/** Longest sequence: more new points than fit in it are not played one by one, the page goes straight to the end. */
export const POINT_SEQUENCE_MAX_MS = 3000;
/** Most new points of one update shown one at a time (the first at once, one every POINT_STEP_MS: last at 2.4 s). */
export const POINT_SEQUENCE_MAX_POINTS = Math.floor(POINT_SEQUENCE_MAX_MS / POINT_STEP_MS);

export interface SequenceOptions {
  /** The state is a live update (`LiveData.live`): false for the first state, a reconnection or a resync. */
  live: boolean;
  /** `prefers-reduced-motion`: no waiting between the points, straight to the end. */
  reducedMotion: boolean;
}

/** What `planPointSequence` decides for a new state of the server. */
export interface PointPlan {
  /** States to show in order, one every POINT_STEP_MS; the last is always the new state of the server. */
  steps: MatchState[];
  /** False: show the last step at once, no waiting (nothing to play one by one). */
  paced: boolean;
}

/**
 * States to show, in order, going from `shown` (on screen, null: nothing yet) to `incoming` (the new state of the
 * server). Not paced (only `incoming`, at once) for the first state, a state that is not a live update, reduced
 * motion, points taken away or changed (the scout corrected the history), no new point, or more than
 * POINT_SEQUENCE_MAX_POINTS new points. Otherwise one step per new point, from @sir/volley-stats.
 */
export function planPointSequence(
  shown: MatchState | null,
  incoming: MatchState,
  { live, reducedMotion }: SequenceOptions,
): PointPlan {
  const jump: PointPlan = { steps: [incoming], paced: false };
  if (shown === null || !live || reducedMotion || !pointsExtend(shown, incoming)) return jump;
  const from = matchPoints(shown).length;
  const added = matchPoints(incoming).length - from;
  if (added < 1 || added > POINT_SEQUENCE_MAX_POINTS) return jump;
  const steps: MatchState[] = [];
  for (let n = from + 1; n < from + added; n++) steps.push(matchStateUntilPoint(incoming, n));
  steps.push(incoming);
  return { steps, paced: true };
}

export interface PointSequencerOptions {
  stepMs?: number;
  maxMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

/**
 * Plays the plans of `planPointSequence`: `push` a new state of the server and `onShow` is called with each state to
 * put on screen. A point stays on screen at least `stepMs` before the next one, also across updates (the agent
 * delivering a backlog sends one point per message, a few milliseconds apart); a state arriving while a sequence is
 * playing starts a new plan from what is on screen. When the last point would come later than `maxMs` from now, the
 * page goes straight to the end.
 */
export class PointSequencer {
  private shown: MatchState | null = null;
  private shownAt = Number.NEGATIVE_INFINITY;
  private timer: unknown = null;
  private readonly stepMs: number;
  private readonly maxMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(
    private readonly onShow: (state: MatchState) => void,
    options: PointSequencerOptions = {},
  ) {
    this.stepMs = options.stepMs ?? POINT_STEP_MS;
    this.maxMs = options.maxMs ?? POINT_SEQUENCE_MAX_MS;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /** State on screen (null before the first push). */
  get current(): MatchState | null {
    return this.shown;
  }

  push(incoming: MatchState, options: SequenceOptions): void {
    this.cancel();
    const { steps, paced } = planPointSequence(this.shown, incoming, options);
    const now = this.now();
    const firstAt = Math.max(now, this.shownAt + this.stepMs);
    if (!paced || firstAt + (steps.length - 1) * this.stepMs - now > this.maxMs) {
      this.show(incoming, now);
      return;
    }
    this.play(steps, firstAt - now);
  }

  /** Stops the sequence playing (the state on screen stays). */
  cancel(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private show(state: MatchState, at: number): void {
    this.shown = state;
    this.shownAt = at;
    this.onShow(state);
  }

  private play(steps: MatchState[], delayMs: number): void {
    const [first, ...rest] = steps;
    if (first === undefined) return;
    const step = (): void => {
      this.timer = null;
      this.show(first, this.now());
      if (rest.length > 0) this.play(rest, this.stepMs);
    };
    if (delayMs <= 0) step();
    else this.timer = this.setTimer(step, delayMs);
  }
}

/**
 * The state to put on screen for `state` (the state of the server, null: none): the new points of a live update one
 * at a time (see `planPointSequence`). `resetKey` (the match): when it changes the sequence starts again from nothing.
 */
export function usePointSequence(state: MatchState | null, live: boolean, resetKey: string): MatchState | null {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState<{ key: string; state: MatchState } | null>(null);
  const sequencer = useRef<{ key: string; sequencer: PointSequencer } | null>(null);

  useEffect(() => {
    if (state === null) return;
    let current = sequencer.current;
    if (current === null || current.key !== resetKey) {
      current?.sequencer.cancel();
      current = { key: resetKey, sequencer: new PointSequencer((s) => setShown({ key: resetKey, state: s })) };
      sequencer.current = current;
    }
    current.sequencer.push(state, { live, reducedMotion });
  }, [state, live, resetKey, reducedMotion]);

  useEffect(() => () => sequencer.current?.sequencer.cancel(), []);

  if (state === null) return null;
  // Before the first push of this match (or of a new one): the state of the server as it is.
  return shown !== null && shown.key === resetKey ? shown.state : state;
}
