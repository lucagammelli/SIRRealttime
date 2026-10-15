import type { MatchState } from '@sir/volley-stats';
import { z } from 'zod';

/** Match state computed by `@sir/volley-stats`: only checked to be an object (it comes from the server). */
export const MatchStateSchema = z.custom<MatchState>((v) => typeof v === 'object' && v !== null && !Array.isArray(v), {
  message: 'stato della partita non valido',
});

/** Full state of a match; sent when a client connects and after every update. */
export const StateMessageSchema = z.object({
  type: z.literal('state'),
  matchId: z.uuid(),
  version: z.int().min(0),
  state: MatchStateSchema,
});
export type StateMessage = z.infer<typeof StateMessageSchema>;

/** No match available (a "live" link while no match is live). */
export const NoMatchMessageSchema = z.object({ type: z.literal('noMatch') });
export type NoMatchMessage = z.infer<typeof NoMatchMessageSchema>;

export const ErrorMessageSchema = z.object({ type: z.literal('error'), message: z.string() });
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

/** Messages server→client on `/ws/public/:token` and `/ws/admin`; also the body of `GET /api/public/:token/state`. */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  StateMessageSchema,
  NoMatchMessageSchema,
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Body of every error response of the HTTP API (never stack traces or internal details). */
export const ApiErrorSchema = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;
