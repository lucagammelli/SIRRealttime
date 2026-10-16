import type { MatchState } from '@sir/volley-stats';
import { z } from 'zod';
import { UpcomingFixtureSchema } from './club.js';
import { PatchOpsSchema } from './patch.js';

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

/**
 * The link of a match of the calendar before its `.dvw` arrives: the public page shows «Prossima partita» and turns
 * into the live page by itself at the first state of the match.
 */
export const ScheduledMessageSchema = z.object({ type: z.literal('scheduled'), fixture: UpcomingFixtureSchema });
export type ScheduledMessage = z.infer<typeof ScheduledMessageSchema>;

export const ErrorMessageSchema = z.object({ type: z.literal('error'), message: z.string() });
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

/**
 * Changes from the state `baseVersion` to the state `version` of the same match (see `patch.ts`). A client applies
 * it only to the state `baseVersion` it shows; otherwise it asks the full state again with `resync`.
 */
export const PatchMessageSchema = z
  .object({
    type: z.literal('patch'),
    matchId: z.uuid(),
    baseVersion: z.int().min(0),
    version: z.int().min(1),
    ops: PatchOpsSchema,
  })
  .refine((m) => m.version > m.baseVersion, { message: 'version deve superare baseVersion', path: ['version'] });
export type PatchMessage = z.infer<typeof PatchMessageSchema>;

/**
 * Messages server→client on `/ws/public/:token` and `/ws/admin` (`patch` only there); also the body of
 * `GET /api/public/:token/state` (`state`, `noMatch`, `scheduled` or `error`).
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  StateMessageSchema,
  PatchMessageSchema,
  NoMatchMessageSchema,
  ScheduledMessageSchema,
  ErrorMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Client→server on the live WebSockets: send the full current state again (a patch did not fit). */
export const ResyncMessageSchema = z.strictObject({ type: z.literal('resync') });
export const ClientMessageSchema = z.discriminatedUnion('type', [ResyncMessageSchema]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/**
 * Query of the live WebSockets: `enc=gzip` when the client can decompress (`DecompressionStream`); the server then
 * sends binary frames with the gzip of the JSON message, otherwise text frames.
 */
export const LiveSocketQuerySchema = z.object({ enc: z.literal('gzip').optional() });
export type LiveSocketQuery = z.infer<typeof LiveSocketQuerySchema>;

/** Most bytes of a decompressed live frame: a client drops (and resyncs) anything larger. */
export const LIVE_FRAME_MAX_DECODED_BYTES = 4 * 1024 * 1024;

/** Body of every error response of the HTTP API (never stack traces or internal details). */
export const ApiErrorSchema = z.object({ error: z.string() });
export type ApiError = z.infer<typeof ApiErrorSchema>;
