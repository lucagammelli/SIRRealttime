import type { AfterMatch } from '@arenalive/shared';
import { afterMatchImage } from '@arenalive/shared';
import { useEffect, useState } from 'react';
import type { LiveData } from './liveConnection.ts';

/**
 * «Dopo la partita» of the public page: `delayMinutes` after the end of the match (`finishedAt` of the state message)
 * the photo chosen by the client goes full screen, with the countdown to the next match of the club over it. One timer
 * waits for that moment (no polling); the screen stays until the match is no longer finished (a correction) or the
 * link shows another match.
 * A simulated match (`data.simulated`) does not wait the real minutes of the client: after SIMULATED_AFTER_MATCH_MS (or
 * the minutes, if shorter) the screen shows, so a test of the simulation sees it.
 */
/** Wait of the screen after a simulated match ends (ms): short, to be seen in a test. */
export const SIMULATED_AFTER_MATCH_MS = 15_000;

/** Longest single wait of the timer (a `setTimeout` beyond about 24.8 days fires at once): it is armed again. */
const MAX_WAIT_MS = 24 * 3_600_000;

/**
 * Pure: when the screen starts (ms since the epoch) for what the page shows; null when it never does (no finished
 * match, no end time from the server, screen off or without a photo, graphics not loaded).
 */
export function afterMatchDueAt(data: LiveData | null, config: AfterMatch | null): number | null {
  if (!config || afterMatchImage(config) === null) return null;
  if (data?.kind !== 'state' || data.state.status !== 'finished' || !data.finishedAt) return null;
  const end = Date.parse(data.finishedAt);
  if (!Number.isFinite(end)) return null;
  const wait = config.delayMinutes * 60_000;
  return end + (data.simulated ? Math.min(wait, SIMULATED_AFTER_MATCH_MS) : wait);
}

/**
 * The id of the photo of «Dopo la partita» once its moment has come, otherwise null. `now` is the clock (tests).
 */
export function useAfterMatchImage(
  data: LiveData | null,
  config: AfterMatch | null,
  now: () => number = Date.now,
): string | null {
  const due = afterMatchDueAt(data, config);
  // The moment reached (the `due` it was reached for): a later change of `due` waits again.
  const [reached, setReached] = useState<number | null>(null);
  const [rearm, setRearm] = useState(0);
  useEffect(() => {
    if (due === null) return;
    const wait = due - now();
    const timer = setTimeout(
      () => (now() >= due ? setReached(due) : setRearm((n) => n + 1)),
      Math.max(0, Math.min(wait, MAX_WAIT_MS)),
    );
    return () => clearTimeout(timer);
  }, [due, now, rearm]);
  return due !== null && reached === due && config ? afterMatchImage(config) : null;
}
