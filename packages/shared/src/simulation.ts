import { z } from 'zod';
import { SHORT_CODE_PATTERN } from './admin.js';
import { plainText } from './strings.js';

/**
 * Simulation of a match (`/admin/simulazione`): the server replays a `.dvw` (random or imported) in the
 * same pipeline of the ingest, on a match of its own (never the live one, the channel, the calendar), with its own
 * link. One per client at a time; lost when the server restarts; deleted SIMULATION_RETENTION_MS after its end.
 */

/** Speeds offered on the real rhythm of the lines (times of the file, otherwise an average rhythm). */
export const SIMULATION_SPEEDS = [1, 2, 5, 10] as const;
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number];

/** Limits of the duration of a set and of the break between two sets, in seconds. */
export const SIMULATION_SET_SECONDS = { min: 10, max: 3600, default: 120 } as const;
export const SIMULATION_BREAK_SECONDS = { min: 0, max: 1800, default: 20 } as const;

/** Largest `.dvw` that can be uploaded (a real file is a few hundred KB). */
export const SIMULATION_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** Length of the base64 text of a file of SIMULATION_UPLOAD_MAX_BYTES (with padding). */
export const SIMULATION_UPLOAD_MAX_BASE64_LENGTH = Math.ceil(SIMULATION_UPLOAD_MAX_BYTES / 3) * 4;
/** Name of an uploaded file, as shown on the page. */
export const SIMULATION_FILE_NAME_MAX = 120;

/** A simulation ended (stopped or finished) is deleted with its link this long after its end. */
export const SIMULATION_RETENTION_MS = 6 * 3_600_000;
/** Title of the simulated match and label of its link. */
export const SIMULATION_TITLE = 'Simulazione';

export const SimulationPaceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('duration'),
    setSeconds: z.int().min(SIMULATION_SET_SECONDS.min).max(SIMULATION_SET_SECONDS.max),
    breakSeconds: z.int().min(SIMULATION_BREAK_SECONDS.min).max(SIMULATION_BREAK_SECONDS.max),
  }),
  z.object({
    kind: z.literal('speed'),
    speed: z.union(SIMULATION_SPEEDS.map((s) => z.literal(s))),
  }),
]);
export type SimulationPace = z.infer<typeof SimulationPaceSchema>;

/**
 * How a generated match goes («Andamento della partita»): limits, default and step of every field, the same as
 * `PROFILE_LIMITS` and `DEFAULT_PROFILE` of `tools/dvw-simulator` (checked by a test). Averages per team and per set,
 * except the strength of the home team (50: on a par) and the variability (0: the level of the teams never changes).
 */
export const SIMULATION_PROFILE = {
  homeStrength: { min: 0, max: 100, default: 50, step: 1 },
  variability: { min: 0, max: 100, default: 50, step: 1 },
  acesPerSet: { min: 0, max: 8, default: 1.5, step: 0.5 },
  serveErrorsPerSet: { min: 0, max: 10, default: 3.5, step: 0.5 },
  blocksPerSet: { min: 0, max: 8, default: 2, step: 0.5 },
  substitutionsPerSet: { min: 0, max: 6, default: 2, step: 0.5 },
  timeoutsPerSet: { min: 0, max: 2, default: 1.5, step: 0.5 },
} as const;
export type SimulationProfileField = keyof typeof SIMULATION_PROFILE;

const profileField = (field: SimulationProfileField) => {
  const { min, max } = SIMULATION_PROFILE[field];
  return z.number().min(min).max(max).optional();
};

/** Every field optional: a missing one takes the default of the simulator. */
export const SimulationProfileSchema = z.object({
  homeStrength: profileField('homeStrength'),
  variability: profileField('variability'),
  acesPerSet: profileField('acesPerSet'),
  serveErrorsPerSet: profileField('serveErrorsPerSet'),
  blocksPerSet: profileField('blocksPerSet'),
  substitutionsPerSet: profileField('substitutionsPerSet'),
  timeoutsPerSet: profileField('timeoutsPerSet'),
});
export type SimulationProfile = z.infer<typeof SimulationProfileSchema>;

/**
 * `generated`: a match of `tools/dvw-simulator` with 3, 4 or 5 sets (`seed` for the same match again, otherwise a
 * random one; `clubTeams`: our team and the opponent of the next match, when there is one; `profile`: how it goes,
 * the defaults of the simulator without it).
 * `upload`: a `.dvw` of the admin, as base64 (at most SIMULATION_UPLOAD_MAX_BYTES).
 */
export const SimulationSourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('generated'),
    sets: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    seed: z.int().min(1).max(2_147_483_647).optional(),
    clubTeams: z.boolean().default(false),
    profile: SimulationProfileSchema.optional(),
  }),
  z.object({
    kind: z.literal('upload'),
    fileName: plainText(SIMULATION_FILE_NAME_MAX),
    data: z.base64().min(4).max(SIMULATION_UPLOAD_MAX_BASE64_LENGTH),
  }),
]);
export type SimulationSource = z.infer<typeof SimulationSourceSchema>;

/** `POST /api/admin/simulation`: starts a simulation (409 when one is running or paused). */
export const StartSimulationRequestSchema = z.object({ source: SimulationSourceSchema, pace: SimulationPaceSchema });
export type StartSimulationRequest = z.infer<typeof StartSimulationRequestSchema>;

/** Commands on the simulation of the client: `POST /api/admin/simulation/<command>`. */
export const SIMULATION_COMMANDS = ['pause', 'resume', 'stop', 'restart'] as const;
export const SimulationCommandSchema = z.enum(SIMULATION_COMMANDS);
export type SimulationCommand = z.infer<typeof SimulationCommandSchema>;
export const SimulationCommandParamSchema = z.object({ command: SimulationCommandSchema });

/** `stopped` also when the server restarted (the replay is lost, the match and its link stay until deleted). */
export const SimulationStatusSchema = z.enum(['running', 'paused', 'stopped', 'finished']);
export type SimulationStatus = z.infer<typeof SimulationStatusSchema>;

const ScoreSchema = z.object({ home: z.int().min(0), away: z.int().min(0) });

export const SimulationSummarySchema = z.object({
  /** Id of the simulated match. */
  matchId: z.uuid(),
  status: SimulationStatusSchema,
  /** Where the match comes from, as shown («Partita casuale (3 set, seme …)», «File: <nome>»). */
  source: z.string(),
  /** null after a restart of the server (the replay is lost). */
  pace: SimulationPaceSchema.nullable(),
  homeName: z.string().nullable(),
  awayName: z.string().nullable(),
  /** Set being played and its score; sets won. */
  set: z.int().min(0),
  score: ScoreSchema,
  setsWon: ScoreSchema,
  linesSent: z.int().min(0),
  linesTotal: z.int().min(0),
  elapsedMs: z.int().min(0),
  totalMs: z.int().min(0),
  remainingMs: z.int().min(0),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  /** When match and link are deleted (6 hours after the end); null while it is running or paused. */
  deleteAt: z.iso.datetime().nullable(),
  /** Why it stopped by itself (restart of the server, error), in Italian; null otherwise. */
  notice: z.string().nullable(),
  /** The link of the simulation (short code and URL `<base>/l/<code>`). */
  link: z.object({ shortCode: z.string().regex(SHORT_CODE_PATTERN), shortUrl: z.url() }).nullable(),
});
export type SimulationSummary = z.infer<typeof SimulationSummarySchema>;

/** `GET /api/admin/simulation` (and the answer of every command): the simulation of the client, if any, and the teams of the club. */
export const SimulationResponseSchema = z.object({
  simulation: SimulationSummarySchema.nullable(),
  /** Teams of a generated match with `clubTeams` (our team and the opponent of the next match); null: none known. */
  clubTeams: z.object({ home: z.string(), away: z.string() }).nullable(),
});
export type SimulationResponse = z.infer<typeof SimulationResponseSchema>;
