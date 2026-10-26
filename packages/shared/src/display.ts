import { z } from 'zod';
import { AgentVersionSchema } from './agentDownload.js';
import { ServerMessageSchema } from './messages.js';
import { hasNoControlChars, plainText } from './strings.js';

/**
 * «Player»: a Raspberry Pi connected to a big screen that opens `https://<host of the client>/schermo#<token>` by
 * itself (Chromium in kiosk mode). In the code it is a **display** («player» already means a player of the team).
 * The portal creates it, downloads its `arenalive-player.json` (a new token at every download), chooses what it shows
 * and sends it commands; the device asks for them with `POST /api/displays/heartbeat` and updates itself with
 * `GET /api/displays/update`.
 */

/** Most players of one client that are not revoked (409 past it). */
export const DISPLAY_LIMIT = 20;

/** Name of the configuration file copied on the SD card of the player. */
export const DISPLAY_CONFIG_FILE_NAME = 'arenalive-player.json';
/** Version of `arenalive-player.json`. */
export const DISPLAY_CONFIG_VERSION = 1;

/** Token of a player: the one of `generateToken` (base64url), as accepted in an `Authorization: Bearer`. */
export const DisplayTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);

/**
 * What a player shows: nothing (waiting screen with the logo of the client), the channel of the club, one match, or
 * one match of the calendar (the same cases of the public links, `targetOf` of the server). Stored on the player, not
 * on a link: revoking a link never switches a big screen off.
 */
export const DisplayTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('channel') }),
  z.strictObject({ kind: z.literal('match'), matchId: z.uuid() }),
  z.strictObject({ kind: z.literal('fixture'), clientFixtureId: z.uuid() }),
]);
export type DisplayTarget = z.infer<typeof DisplayTargetSchema>;

/**
 * Remote commands: `reload` the page (also sent on the socket of the page), `reboot` the device, `screenOff` /
 * `screenOn` the HDMI output.
 */
export const DisplayCommandSchema = z.enum(['reload', 'reboot', 'screenOff', 'screenOn']);
export type DisplayCommand = z.infer<typeof DisplayCommandSchema>;

/** Wi-Fi of the player (`nmcli`): name, WPA password (missing: open network) and country of the radio rules. */
export const DisplayWifiSchema = z.strictObject({
  ssid: z.string().min(1).max(32).refine(hasNoControlChars, { message: 'caratteri di controllo non ammessi' }),
  password: z
    .string()
    .min(8)
    .max(63)
    .refine(hasNoControlChars, { message: 'caratteri di controllo non ammessi' })
    .optional(),
  /** ISO 3166-1 alpha-2, upper case (`IT`). */
  country: z.string().regex(/^[A-Z]{2}$/),
});
export type DisplayWifi = z.infer<typeof DisplayWifiSchema>;

/**
 * `arenalive-player.json`, copied on the SD card: the server of the client, the token of the player (in clear: the
 * server keeps only its sha256) and its name; `wifi` only when chosen at the download (never stored on the server).
 */
export const DisplayConfigFileSchema = z.strictObject({
  version: z.literal(DISPLAY_CONFIG_VERSION),
  /** `https://<host of the client>` without the final slash (http only towards localhost or a private IPv4). */
  serverUrl: z.url({ protocol: /^https?$/ }).refine((u) => !u.endsWith('/'), { message: 'senza / finale' }),
  token: DisplayTokenSchema,
  name: plainText(100),
  wifi: DisplayWifiSchema.optional(),
});
export type DisplayConfigFile = z.infer<typeof DisplayConfigFileSchema>;

/** Screen resolution reported by the player (`1920x1080`). */
export const DisplayResolutionSchema = z.string().regex(/^\d{1,5}x\d{1,5}$/);

/**
 * Body of `POST /api/displays/heartbeat` (every 15 s). `ackSeq`: the `commandSeq` of the last command executed (the
 * pending command is done when `ackSeq` reaches its `commandSeq`).
 */
export const DisplayHeartbeatRequestSchema = z.strictObject({
  version: AgentVersionSchema,
  resolution: DisplayResolutionSchema.optional(),
  /** Seconds since the start of the device. */
  uptimeS: z
    .int()
    .min(0)
    .max(10 * 365 * 24 * 3600),
  ackSeq: z.int().min(0).optional(),
});
export type DisplayHeartbeatRequest = z.infer<typeof DisplayHeartbeatRequestSchema>;

/** Software of the player on offer (`GET /api/displays/update` gives the `.deb`). */
export const DisplayUpdateSchema = z.object({
  version: AgentVersionSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Bytes of the `.deb`. */
  size: z.int().positive(),
});
export type DisplayUpdate = z.infer<typeof DisplayUpdateSchema>;

/**
 * Answer of the heartbeat: the pending command (null: none) with its sequence number, to execute once (a command
 * with a `commandSeq` already executed is skipped); `update` when a newer software than the one reported is on offer.
 */
export const DisplayHeartbeatResponseSchema = z.object({
  command: DisplayCommandSchema.nullable(),
  commandSeq: z.int().min(0),
  update: DisplayUpdateSchema.optional(),
});
export type DisplayHeartbeatResponse = z.infer<typeof DisplayHeartbeatResponseSchema>;

const VERSION_NUMBERS = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Pure: whether the software `available` is to be installed on a player that runs `current`. With two versions
 * `X.Y.Z` only a greater one; otherwise (other formats) any different one.
 */
export function displayUpdateWanted(current: string, available: string): boolean {
  const a = VERSION_NUMBERS.exec(current);
  const b = VERSION_NUMBERS.exec(available);
  if (!a || !b) return current !== available;
  for (let i = 1; i <= 3; i++) {
    const d = Number(b[i]) - Number(a[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** A player in the reserved area (never its token: only whether one was downloaded). */
export const DisplaySummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  target: DisplayTargetSchema,
  /** true: a configuration was downloaded (the token of the last one is valid). */
  configured: z.boolean(),
  revoked: z.boolean(),
  /** Last heartbeat (ISO 8601 UTC); null: never seen. */
  lastSeenAt: z.iso.datetime().nullable(),
  /** IP of the last heartbeat: only for admins (null for a viewer). */
  lastIp: z.string().nullable(),
  /** Software and screen of the last heartbeat. */
  version: z.string().nullable(),
  resolution: z.string().nullable(),
  /** Command not executed yet (null: none) and the number of the last one sent. */
  command: DisplayCommandSchema.nullable(),
  commandSeq: z.int().min(0),
  createdAt: z.iso.datetime(),
});
export type DisplaySummary = z.infer<typeof DisplaySummarySchema>;

/** `POST /api/admin/displays`: a new player, showing nothing until a target is chosen. */
export const CreateDisplayRequestSchema = z.strictObject({ name: plainText(100) });
export type CreateDisplayRequest = z.infer<typeof CreateDisplayRequestSchema>;

/** `PATCH /api/admin/displays/:id`: new name and/or what it shows (at least one). */
export const UpdateDisplayRequestSchema = z
  .strictObject({ name: plainText(100).optional(), target: DisplayTargetSchema.optional() })
  .refine((r) => r.name !== undefined || r.target !== undefined, { message: 'nessun campo da modificare' });
export type UpdateDisplayRequest = z.infer<typeof UpdateDisplayRequestSchema>;

/** `POST /api/admin/displays/:id/command`. */
export const DisplayCommandRequestSchema = z.strictObject({ command: DisplayCommandSchema });
export type DisplayCommandRequest = z.infer<typeof DisplayCommandRequestSchema>;

/**
 * `POST /api/admin/displays/:id/config`: downloads `arenalive-player.json` with a new token (the previous file stops
 * working); the Wi-Fi goes only into the file.
 */
export const DisplayConfigRequestSchema = z.strictObject({ wifi: DisplayWifiSchema.optional() });
export type DisplayConfigRequest = z.infer<typeof DisplayConfigRequestSchema>;

/** Client→server, first message on `/ws/display` (the token never goes in the URL). */
export const DisplayAuthMessageSchema = z.strictObject({ type: z.literal('auth'), token: DisplayTokenSchema });
export type DisplayAuthMessage = z.infer<typeof DisplayAuthMessageSchema>;

/** Client→server on `/ws/display`: the page executed the command `commandSeq` (a reload: it says so before it). */
export const DisplayAckMessageSchema = z.strictObject({ type: z.literal('ack'), commandSeq: z.int().min(1) });
export type DisplayAckMessage = z.infer<typeof DisplayAckMessageSchema>;

/** The player shows nothing: waiting screen with the name of the client (logo from `GET /api/public/tenant`). */
export const StandbyMessageSchema = z.object({
  type: z.literal('standby'),
  /** Display name of the client. */
  tenantName: z.string(),
  /** Name of the player (it helps who installs it). */
  displayName: z.string(),
});
export type StandbyMessage = z.infer<typeof StandbyMessageSchema>;

/** A command for the page of the player (today only `reload`), at once on the socket. */
export const DisplayCommandMessageSchema = z.object({
  type: z.literal('command'),
  command: z.literal('reload'),
  commandSeq: z.int().min(1),
});
export type DisplayCommandMessage = z.infer<typeof DisplayCommandMessageSchema>;

/** Server→client on `/ws/display`: the messages of the live sockets plus `standby` and `command`. */
export const DisplaySocketMessageSchema = z.discriminatedUnion('type', [
  ...ServerMessageSchema.options,
  StandbyMessageSchema,
  DisplayCommandMessageSchema,
]);
export type DisplaySocketMessage = z.infer<typeof DisplaySocketMessageSchema>;

/** Close code of `/ws/display` for a token unknown, revoked, replaced by a new download or of another client. */
export const DISPLAY_CLOSE_INVALID = 4404;
/** Close code of `/ws/display` when the first message is not a valid `auth` in time. */
export const DISPLAY_CLOSE_NO_AUTH = 4401;

/**
 * `GET /api/admin/player/image/info`: the image of the SD card of the players offered by the server
 * (`arenalive-player.img.xz` described by `arenalive-player-image.json` in PLAYER_DOWNLOAD_DIR), if any.
 */
export const PlayerImageInfoSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(false) }),
  z.object({
    available: z.literal(true),
    version: AgentVersionSchema,
    builtAt: z.iso.datetime(),
    /** Bytes of the `.img.xz`. */
    bytes: z.int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Name of the downloaded file. */
    fileName: z.string(),
  }),
]);
export type PlayerImageInfo = z.infer<typeof PlayerImageInfoSchema>;

/** Name of the downloaded image (the version is already safe for a file name). */
export const playerImageFileName = (version: string): string => `arenalive-player-${version}.img.xz`;

/** Address of the download of the image (a plain link: the session cookie is enough, same origin). */
export const PLAYER_IMAGE_PATH = '/api/admin/player/image';
