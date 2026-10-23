import type { MatchState } from '@arenalive/volley-stats';
import { z } from 'zod';
import { TeamLogoPairSchema, UpcomingFixtureSchema } from './club.js';
import { PatchOpsSchema } from './patch.js';
import { HelloMessageSchema } from './stats.js';

/** Match state computed by `@arenalive/volley-stats`: only checked to be an object (it comes from the server). */
export const MatchStateSchema = z.custom<MatchState>((v) => typeof v === 'object' && v !== null && !Array.isArray(v), {
  message: 'stato della partita non valido',
});

/** Full state of a match; sent when a client connects and after every update. */
export const StateMessageSchema = z.object({
  type: z.literal('state'),
  matchId: z.uuid(),
  version: z.int().min(0),
  state: MatchStateSchema,
  /**
   * Logos of the two sides of the `.dvw` (match of the calendar, profile of the club, league), already filtered by
   * «Loghi delle squadre»; missing: no logos (older servers). A patch keeps the logos of the state it applies to.
   */
  logos: TeamLogoPairSchema.optional(),
  /**
   * true: a match played by the simulation of the server (page «Simulazione»): the public page shows the label
   * «Simulazione». Missing for the real matches.
   */
  simulated: z.literal(true).optional(),
  /**
   * When the match ended (ISO 8601 UTC), while its state is `finished`; missing otherwise (and from older servers,
   * which older clients ignore). The public page shows «Dopo la partita» some minutes after it.
   */
  finishedAt: z.iso.datetime().optional(),
});
export type StateMessage = z.infer<typeof StateMessageSchema>;

/** No match available (a channel link of a client without matches). */
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
 * The graphics of the client (branding, page, pauses, overlays, sponsors) were saved: a signal only, without data.
 * Sent on `/ws/public/:token` and `/ws/admin` to the sockets of that client only; the page reads
 * `GET /api/public/tenant` again (spread over a few seconds) and keeps the match it shows.
 */
export const ConfigMessageSchema = z.object({ type: z.literal('config') });
export type ConfigMessage = z.infer<typeof ConfigMessageSchema>;

/**
 * Messages server→client on `/ws/public/:token` and `/ws/admin` (`patch` and `config` only there); also the body of
 * `GET /api/public/:token/state` (`state`, `noMatch`, `scheduled` or `error`).
 */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  StateMessageSchema,
  PatchMessageSchema,
  NoMatchMessageSchema,
  ScheduledMessageSchema,
  ErrorMessageSchema,
  ConfigMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** Client→server on the live WebSockets: send the full current state again (a patch did not fit). */
export const ResyncMessageSchema = z.strictObject({ type: z.literal('resync') });
export const ClientMessageSchema = z.discriminatedUnion('type', [ResyncMessageSchema, HelloMessageSchema]);
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
