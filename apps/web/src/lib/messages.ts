import type { MatchState } from '@arenalive/volley-stats';
import type { DisplaySocketMessage, ServerMessage } from '@arenalive/shared';
import { DisplaySocketMessageSchema, ServerMessageSchema } from '@arenalive/shared';

/**
 * Parses a WebSocket frame or an HTTP body coming from the server with the shared schema;
 * `null` for anything that is not valid JSON or not a `ServerMessage`.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  const parsed = ServerMessageSchema.safeParse(jsonOf(raw));
  return parsed.success ? parsed.data : null;
}

/** As `parseServerMessage`, for the socket of a player (`/ws/display`: also `standby` and `command`). */
export function parseDisplayMessage(raw: unknown): DisplaySocketMessage | null {
  const parsed = DisplaySocketMessageSchema.safeParse(jsonOf(raw));
  return parsed.success ? parsed.data : null;
}

/** The value of a JSON text (undefined when it is not JSON); anything else as it is. */
function jsonOf(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The state carried by the shared schema is only checked to be an object: these are the fields every view reads. */
export function looksLikeMatchState(state: unknown): state is MatchState {
  if (typeof state !== 'object' || state === null) return false;
  const s = state as Record<string, unknown>;
  return (
    typeof s.teams === 'object' &&
    s.teams !== null &&
    Array.isArray(s.sets) &&
    typeof s.live === 'object' &&
    s.live !== null &&
    typeof s.stats === 'object' &&
    s.stats !== null &&
    typeof s.momentum === 'object' &&
    s.momentum !== null
  );
}
