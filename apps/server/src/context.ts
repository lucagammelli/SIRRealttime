import type { MatchLogoInfo, ScheduleResponse, UserRole } from '@arenalive/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { LiveHub, StatePublisher } from './hub.js';
import type { IngestService } from './ingest.js';
import type { LeagueCatalog } from './leagues/catalog.js';
import type { LeagueService } from './leagues/sync.js';
import type { FailureLimiter } from './lib/failureLimiter.js';
import type { MailService } from './mail/service.js';
import type { ResyncScheduler } from './lib/resync.js';
import type { StatsService } from './stats/service.js';
import type { TtlCache } from './lib/ttlCache.js';
import type { Tenant } from './tenancy.js';

/** Requests per minute and per client IP. */
export interface RateLimits {
  login: number;
  ingest: number;
  /** `GET /api/public/:token/state`: many spectators share one IP (Wi-Fi of the gym, mobile NAT). */
  public: number;
  /** Openings of `/ws/public/:token` (reconnections included). */
  publicWs: number;
  /** Public requests with an unknown, revoked or expired token: past this the IP is blocked until the minute ends. */
  publicInvalid: number;
  admin: number;
  /** Self-registration requests of agents (`POST /api/agents/registrations`). */
  register: number;
  /**
   * Unknown short codes per minute from all the IPs together: past this, until the minute ends, every short code
   * that is not already known valid (cached) gets 429, whatever the IP.
   */
  shortCodeInvalidTotal: number;
  /** Downloads of the agent zip (`GET /api/admin/agent/download`, about 90 MB each). */
  agentDownload: number;
  /** «Aggiorna ora» of a championship (`POST /api/admin/leagues/:id/sync`): each one downloads pages of the league site. */
  leagueSync: number;
  /** «Importa dal sito della Lega» of the roster (`POST /api/admin/roster/import`): each one reads a page and the photos. */
  rosterImport: number;
  /** Reset of a password and use of invitation links (`/api/auth/password-reset/*`, `/api/auth/invite/*`, `/api/auth/links/*`). */
  passwordReset: number;
  /** Heartbeats and updates of the players (`/api/displays/*`): one every 15 s per player, several behind one IP. */
  display: number;
  /** Openings of `/ws/display` (reconnections of the page of the players included). */
  displayWs: number;
  /** Wrong tokens of players (heartbeat, update, socket): past this the IP is blocked until the minute ends. */
  displayInvalid: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  login: 10,
  ingest: 600,
  public: 6000,
  publicWs: 6000,
  publicInvalid: 120,
  admin: 300,
  register: 10,
  shortCodeInvalidTotal: 1000,
  agentDownload: 10,
  leagueSync: 6,
  rosterImport: 3,
  passwordReset: 10,
  display: 240,
  displayWs: 60,
  displayInvalid: 20,
};

/** Most public WebSockets open at the same time, per client IP and in total. */
export interface SocketLimits {
  perIp: number;
  total: number;
}

export const DEFAULT_SOCKET_LIMITS: SocketLimits = { perIp: 2000, total: 6000 };

/** Seconds of `Retry-After` when the server is full (the portal adds a random wait on top). */
export const SERVER_FULL_RETRY_AFTER_S = 20;

/** Lifetime of the cached client of a hostname and of a cached share token. */
export const LOOKUP_CACHE_TTL_MS = 30_000;

/** Lifetime of the cached public schedule (matches and standings) of a client. */
export const SCHEDULE_CACHE_TTL_MS = 60_000;

/** In-memory lookups (30 s), invalidated at once when a client changes or a link is revoked. */
export interface LookupCaches {
  /** Client of a hostname (`''`: no valid hostname), null: none. */
  hosts: TtlCache<string, Tenant | null>;
  /** Valid share tokens, by `<tenantId>:<sha256 of the token>` (short codes: `<tenantId>:c:<keyed hash of the code>`). */
  shares: TtlCache<string, ResolvedShareToken>;
  /** `GET /api/public/tenant/schedule` by client id (60 s; emptied when the club changes or a match starts or ends). */
  schedule: TtlCache<string, ScheduleResponse>;
  /** Logos of the `.dvw` by `<tenantId>:<clientFixtureId or empty>` (60 s; emptied when a client or its club changes). */
  logos: TtlCache<string, MatchLogoInfo>;
  /** Whether the `.dvw` of a match of the calendar go to the channel, by `<tenantId>:<clientFixtureId>` (60 s). */
  broadcast: TtlCache<string, boolean>;
}

/** Shared services of the routes. */
export interface AppContext {
  config: Config;
  db: Db;
  hub: LiveHub;
  /** Where the ingest sends the new states: today the hub of this process (later Postgres NOTIFY for more copies). */
  publisher: StatePublisher;
  ingest: IngestService;
  rateLimits: RateLimits;
  socketLimits: SocketLimits;
  caches: LookupCaches;
  /** Failures of the public routes per IP (`rateLimits.publicInvalid` per minute). */
  publicFailures: FailureLimiter;
  /** Unknown short codes of all the IPs together (`rateLimits.shortCodeInvalidTotal` per minute, one key). */
  shortCodeFailures: FailureLimiter;
  /** Wrong tokens of players per IP (`rateLimits.displayInvalid` per minute): then 429 until the minute ends. */
  displayFailures: FailureLimiter;
  /** Requests of a password reset per email (3 per hour): the over-limit ones are answered the same and ignored. */
  resetRequests: FailureLimiter;
  /** Mail server of the invitations and of the password resets (settings in the database, `mail_settings`). */
  mail: MailService;
  /** Pacing of the full states sent because of `resync` (per socket and per IP). */
  resync: ResyncScheduler;
  /** Visits of the public pages: counted in memory, written in batches (`src/stats/`). */
  stats: StatsService;
  /** Downloads and updates of the championships (common to every client). */
  leagues: LeagueService;
  /** Championships of the season in course on the official site (series chosen by the clubs). */
  catalog: LeagueCatalog;
  now: () => Date;
  /** Log of the server for the work in the background (missing in the tests that build a context by hand). */
  log?: FastifyBaseLogger;
}

export const SESSION_COOKIE = 'arenalive_session';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  /** Client of the user; null only for a superadmin. */
  tenantId: string | null;
}

export interface ResolvedShareToken {
  id: string;
  tenantId: string;
  matchId: string | null;
  /** Match of the calendar of the club the link belongs to (null: a link created by hand). */
  clientFixtureId: string | null;
  expiresAt: Date | null;
}

/** Agent authenticated by its bearer token, with the client it belongs to. */
export interface AuthenticatedAgent {
  id: string;
  tenantId: string;
}

/** Player authenticated by its bearer token, with the client it belongs to. */
export interface AuthenticatedDisplay {
  id: string;
  tenantId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Logged-in user (admin routes and `/ws/admin`). */
    user: SessionUser | null;
    /** Expiry of that session (an admin WebSocket is closed when it passes). */
    sessionExpiresAt: Date | null;
    /**
     * Client the admin routes work on: the user's own, or for a superadmin the client it has entered (null if
     * none: never the client of the hostname). Set by `requireRole`.
     */
    adminTenantId: string | null;
    /** Agent authenticated by its bearer token (`/api/ingest`). */
    agent: AuthenticatedAgent | null;
    /** Share token of a public request. */
    shareToken: ResolvedShareToken | null;
    /** Player authenticated by its bearer token (`/api/displays/*`). */
    display: AuthenticatedDisplay | null;
  }
}

export const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: 60_000 } });
