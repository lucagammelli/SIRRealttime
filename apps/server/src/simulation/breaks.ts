import { MIN_SPEED_BREAK_SECONDS } from '@arenalive/dvw-simulator';
import { intermissionFor, resolveIntermissions } from '@arenalive/shared';

/**
 * Pure: shortest break (seconds) after the set `endedSet` in a simulation with a speed: the whole «Fine set» pause of the
 * client for that set (its delay and the seconds of its slides on, as `intermissionFor` chooses it), so the points of
 * the next set never cut it short; MIN_SPEED_BREAK_SECONDS when that pause is off. `stored` is the pauses document of
 * the client, as saved.
 */
export function setBreakSeconds(stored: unknown, endedSet: number): number {
  const pause = intermissionFor(resolveIntermissions(stored), 'setBreak', endedSet);
  if (!pause) return MIN_SPEED_BREAK_SECONDS;
  return pause.delaySeconds + pause.slides.filter((s) => s.enabled).reduce((sum, s) => sum + s.seconds, 0);
}
