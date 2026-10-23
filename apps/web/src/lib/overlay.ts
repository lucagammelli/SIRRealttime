/**
 * Overlays of the public page (pure functions, no DOM): which events of the match become an overlay with the
 * configuration of the client (`TenantOverlays` of @arenalive/shared), their text and the order of the queue. The events
 * and every number come from @arenalive/volley-stats (`MatchState.events`): nothing is computed here.
 */
import type {
  LayoutDevice,
  Overlay,
  OverlayBackground,
  OverlayPlaceholder,
  OverlayPosition,
  OverlaySize,
  TenantOverlays,
} from '@arenalive/shared';
import { backgroundForTeam, fillOverlayText, overlayPlacement } from '@arenalive/shared';
import type { MatchEvent, MatchState, Side } from '@arenalive/volley-stats';
import { playerName, teamName } from './format.ts';

/** An overlay waiting in the queue (or on screen). */
export interface QueuedOverlay {
  id: string;
  /** Plain text, placeholders already replaced. */
  text: string;
  /** Colour of the overlay: the team of the event, `null` neutral. */
  team: Side | null;
  seconds: number;
  /** Where on the page and how big (own value of the overlay or general setting). */
  position: OverlayPosition;
  size: OverlaySize;
  priority: number;
  /** When it arrived (ms, clock of the page): too old ones are dropped. */
  receivedAt: number;
  /** Line of the event: same priority, the earlier one first. */
  index: number;
  /** Image or video behind the text, with the options of a video (missing: text only). */
  background?: OverlayBackground;
}

/** An overlay waiting longer than this is dropped: it is no longer news. */
export const OVERLAY_MAX_AGE_MS = 10_000;
/** Most overlays waiting at once (the newest are kept). */
export const OVERLAY_QUEUE_MAX = 5;
/** Ids remembered as already seen before the list is trimmed to the events of the state. */
const SEEN_MAX = 500;

/** Events of a state; none for a state stored before they existed. */
export function eventsOf(state: MatchState): MatchEvent[] {
  const events = (state as Partial<MatchState>).events;
  return Array.isArray(events) ? events : [];
}

/** Values of the placeholders for an event (missing ones: nothing to say, e.g. no player). */
export function overlayValues(event: MatchEvent, state: MatchState): Partial<Record<OverlayPlaceholder, string>> {
  const values: Partial<Record<OverlayPlaceholder, string>> = {
    punteggio: `${event.homeScore}-${event.awayScore}`,
    set: String(event.set),
  };
  if (event.team) values.squadra = teamName(state.teams, event.team);
  if (event.player) {
    const { number, firstName, lastName } = event.player;
    values.giocatore = playerName({ number, firstName, lastName, role: null, specialRole: null }, number);
    values.numero = String(number);
  }
  if (event.count !== null) {
    if (event.kind === 'run') values.serie = String(event.count);
    if (event.kind === 'longRally') values.attacchi = String(event.count);
  }
  return values;
}

/** Text of the overlay of an event with the text chosen by the client. */
export const overlayText = (event: MatchEvent, state: MatchState, overlay: Pick<Overlay, 'text'>): string =>
  fillOverlayText(overlay.text, overlayValues(event, state));

/** The overlay of an event for `device`; null when its kind is off or not shown on the device. */
export function overlayFor(
  event: MatchEvent,
  state: MatchState,
  config: TenantOverlays,
  device: LayoutDevice,
  now: number,
  /** Side of our team in the match (null: unknown, a video for our team only is then shown for both). */
  ourSide: Side | null = null,
): QueuedOverlay | null {
  const overlay = (config as Partial<TenantOverlays>)[event.kind];
  if (!overlay || !overlay.enabled || !overlay.devices[device]) return null;
  const text = overlayText(event, state, overlay);
  if (text === '') return null;
  const { position, size } = overlayPlacement(config, overlay);
  // A video for our team only: none for an event of the opponent (text only, as without background).
  const background = backgroundForTeam(overlay.background, event.team, ourSide);
  return {
    id: event.id,
    text,
    team: event.team,
    seconds: overlay.seconds,
    position,
    size,
    priority: overlay.priority,
    receivedAt: now,
    index: event.index,
    ...(background ? { background } : {}),
  };
}

/**
 * Events of `events` not in `seen`, in order; `seen` is updated (and trimmed to the events of the state when it grows
 * too much).
 */
export function unseenEvents(events: readonly MatchEvent[], seen: Set<string>): MatchEvent[] {
  const fresh = events.filter((e) => !seen.has(e.id));
  for (const e of fresh) seen.add(e.id);
  if (seen.size > SEEN_MAX) {
    seen.clear();
    for (const e of events) seen.add(e.id);
  }
  return fresh;
}

/** Queue with `items` added: one entry per id, at most OVERLAY_QUEUE_MAX (the newest). */
export function enqueue(queue: readonly QueuedOverlay[], items: readonly QueuedOverlay[]): QueuedOverlay[] {
  const ids = new Set(queue.map((q) => q.id));
  const next = [...queue, ...items.filter((i) => !ids.has(i.id))];
  return next.slice(-OVERLAY_QUEUE_MAX);
}

/**
 * Next overlay to show: the queue without the ones waiting longer than `maxAgeMs`, then the highest priority (same
 * priority: the earlier event). `rest` is the queue without it.
 */
export function nextOverlay(
  queue: readonly QueuedOverlay[],
  now: number,
  maxAgeMs = OVERLAY_MAX_AGE_MS,
): { next: QueuedOverlay | null; rest: QueuedOverlay[] } {
  const alive = queue.filter((q) => now - q.receivedAt <= maxAgeMs);
  let best: QueuedOverlay | null = null;
  for (const q of alive) {
    if (!best || q.priority > best.priority || (q.priority === best.priority && q.index < best.index)) best = q;
  }
  return { next: best, rest: alive.filter((q) => q !== best) };
}

/**
 * Example event of `kind` for the editor of the overlays: the score of `state` (live match or the example match), the
 * team of `side` (default home: in the Studio our team) and its first player; 3 points in a row, 4 attacks. Only to show the text, never a real event.
 */
export function sampleEvent(kind: MatchEvent['kind'], state: MatchState, side: Side = 'home'): MatchEvent {
  const player = state.players[side][0];
  const withPlayer = kind === 'ace' || kind === 'block' || kind === 'substitution';
  return {
    id: `prova-${kind}`,
    kind,
    index: 0,
    set: state.live.set,
    team: side,
    player:
      withPlayer && player
        ? { number: player.number, firstName: player.firstName, lastName: player.lastName }
        : withPlayer
          ? { number: 7, firstName: null, lastName: null }
          : null,
    playerOut: null,
    homeScore: state.live.homeScore,
    awayScore: state.live.awayScore,
    count: kind === 'run' ? 3 : kind === 'longRally' ? 4 : null,
    priority: 1,
  };
}
