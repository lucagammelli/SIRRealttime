import type { MatchLogoInfo, ScheduleResponse, UserRole } from '@sir/shared';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { LiveHub, StatePublisher } from './hub.js';
import type { IngestService } from './ingest.js';
import type { LeagueService } from './leagues/sync.js';
import type { FailureLimiter } from './lib/failureLimiter.js';
import type { ResyncScheduler } from './lib/resync.js';
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
  /** Pacing of the full states sent because of `resync` (per socket and per IP). */
  resync: ResyncScheduler;
  /** Downloads and updates of the championships (common to every client). */
  leagues: LeagueService;
  now: () => Date;
}

export const SESSION_COOKIE = 'sir_session';

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

declare module 'fastify' {
  interface FastifyRequest {
    /** Logged-in user (admin routes and `/ws/admin`). */
    user: SessionUser | null;
    /** Expiry of that session (an admin WebSocket is closed when it passes). */
    sessionExpiresAt: Date | null;
    /**
     * Client the admin routes work on: the user's own, or for a superadmin the active one of the session, otherwise
     * the client of the hostname (null if none). Set by `requireRole`.
     */
    adminTenantId: string | null;
    /** Agent authenticated by its bearer token (`/api/ingest`). */
    agent: AuthenticatedAgent | null;
    /** Share token of a public request. */
    shareToken: ResolvedShareToken | null;
  }
}

export const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: 60_000 } });
