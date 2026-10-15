import type { UserRole } from '@sir/shared';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { LiveHub } from './hub.js';
import type { IngestService } from './ingest.js';

/** Requests per minute and per client IP. */
export interface RateLimits {
  login: number;
  ingest: number;
  public: number;
  admin: number;
  /** Self-registration requests of agents (`POST /api/agents/registrations`). */
  register: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  login: 10,
  ingest: 600,
  public: 120,
  admin: 300,
  register: 10,
};

/** Shared services of the routes. */
export interface AppContext {
  config: Config;
  db: Db;
  hub: LiveHub;
  ingest: IngestService;
  rateLimits: RateLimits;
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
