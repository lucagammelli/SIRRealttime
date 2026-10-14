import type { MatchState } from '@sir/volley-stats';
import type { ServerMessage } from '@sir/shared';
import { ServerMessageSchema } from '@sir/shared';

/**
 * Parses a WebSocket frame or an HTTP body coming from the server with the shared schema;
 * `null` for anything that is not valid JSON or not a `ServerMessage`.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = ServerMessageSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
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
