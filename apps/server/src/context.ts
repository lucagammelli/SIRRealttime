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
  role: 'admin' | 'viewer';
}

export interface ResolvedShareToken {
  id: string;
  matchId: string | null;
  expiresAt: Date | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Logged-in user (admin routes and `/ws/admin`). */
    user: SessionUser | null;
    /** Expiry of that session (an admin WebSocket is closed when it passes). */
    sessionExpiresAt: Date | null;
    /** Agent authenticated by its bearer token (`/api/ingest`). */
    agentId: string | null;
    /** Share token of a public request. */
    shareToken: ResolvedShareToken | null;
  }
}

export const perMinute = (max: number) => ({ rateLimit: { max, timeWindow: 60_000 } });
