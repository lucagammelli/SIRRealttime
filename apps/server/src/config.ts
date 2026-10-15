import { DEFAULT_TENANT_SLUG, PASSWORD_MIN_LENGTH, TenantSlugSchema } from '@sir/shared';
import { z } from 'zod';
import type { RateLimits, SocketLimits } from './context.js';
import { DEFAULT_RATE_LIMITS, DEFAULT_SOCKET_LIMITS } from './context.js';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
/** Requests per minute and per IP: a positive integer, at most 100000. */
const perMinute = (fallback: number) => z.coerce.number().int().positive().max(100_000).default(fallback);
/** Open WebSockets: a positive integer, at most 1000000. */
const sockets = (fallback: number) => z.coerce.number().int().positive().max(1_000_000).default(fallback);
const origin = z.url().transform((u) => new URL(u).origin);

/** Environment variables of the server (documented in `.env.example`). */
const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    PORT: z.coerce.number().int().min(0).max(65535).default(8090),
    HOST: z.string().min(1).default('127.0.0.1'),
    CORS_ORIGIN: origin.default('http://localhost:5173'),
    COOKIE_SECURE: bool.default(true),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .positive()
      .max(24 * 30)
      .default(12),
    ADMIN_EMAIL: z.email().optional(),
    ADMIN_PASSWORD: z.string().min(PASSWORD_MIN_LENGTH).optional(),
    PUBLIC_BASE_URL: z
      .url()
      .default('http://localhost:5173')
      .transform((u) => u.replace(/\/+$/, '')),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: bool.default(false),
    RATE_LIMIT_LOGIN: perMinute(DEFAULT_RATE_LIMITS.login),
    RATE_LIMIT_INGEST: perMinute(DEFAULT_RATE_LIMITS.ingest),
    RATE_LIMIT_PUBLIC: perMinute(DEFAULT_RATE_LIMITS.public),
    RATE_LIMIT_PUBLIC_WS: perMinute(DEFAULT_RATE_LIMITS.publicWs),
    RATE_LIMIT_PUBLIC_INVALID: perMinute(DEFAULT_RATE_LIMITS.publicInvalid),
    RATE_LIMIT_ADMIN: perMinute(DEFAULT_RATE_LIMITS.admin),
    RATE_LIMIT_REGISTER: perMinute(DEFAULT_RATE_LIMITS.register),
    WS_MAX_PER_IP: sockets(DEFAULT_SOCKET_LIMITS.perIp),
    WS_MAX_TOTAL: sockets(DEFAULT_SOCKET_LIMITS.total),
    MATCH_MAX_LINES: z.coerce.number().int().positive().max(1_000_000).default(20_000),
    DEFAULT_TENANT_SLUG: TenantSlugSchema.default(DEFAULT_TENANT_SLUG),
  })
  .refine((e) => (e.ADMIN_EMAIL === undefined) === (e.ADMIN_PASSWORD === undefined), {
    message: 'ADMIN_EMAIL e ADMIN_PASSWORD vanno impostate insieme',
    path: ['ADMIN_PASSWORD'],
  });

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  corsOrigin: string;
  cookieSecure: boolean;
  sessionTtlHours: number;
  admin: { email: string; password: string } | null;
  publicBaseUrl: string;
  logLevel: string;
  trustProxy: boolean;
  /** Most scout lines stored for one match: an ingest that would go over it gets 413. */
  matchMaxLines: number;
  /** Requests per minute and per IP of each route group. */
  rateLimits: RateLimits;
  /** Most public WebSockets open at once, per IP and in total (then 503 with Retry-After). */
  socketLimits: SocketLimits;
  /** Client of an unknown hostname; null (DEFAULT_TENANT_SLUG set but empty): unknown hostnames get 404. */
  defaultTenantSlug: string | null;
}

export class ConfigError extends Error {
  readonly code = 'CONFIG_INVALID';
}

/** Reads and validates the configuration; the error lists the invalid variable names, never their values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const blankToUndefined = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === '' ? undefined : v]));
  const parsed = EnvSchema.safeParse(blankToUndefined);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new ConfigError(`Configurazione non valida: ${names}`);
  }
  const e = parsed.data;
  // Empty is not "unset" here: it disables the fallback client.
  const noDefaultTenant = env.DEFAULT_TENANT_SLUG === '';
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    corsOrigin: e.CORS_ORIGIN,
    cookieSecure: e.COOKIE_SECURE,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    admin:
      e.ADMIN_EMAIL && e.ADMIN_PASSWORD ? { email: e.ADMIN_EMAIL.toLowerCase(), password: e.ADMIN_PASSWORD } : null,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    logLevel: e.LOG_LEVEL,
    trustProxy: e.TRUST_PROXY,
    matchMaxLines: e.MATCH_MAX_LINES,
    rateLimits: {
      login: e.RATE_LIMIT_LOGIN,
      ingest: e.RATE_LIMIT_INGEST,
      public: e.RATE_LIMIT_PUBLIC,
      publicWs: e.RATE_LIMIT_PUBLIC_WS,
      publicInvalid: e.RATE_LIMIT_PUBLIC_INVALID,
      admin: e.RATE_LIMIT_ADMIN,
      register: e.RATE_LIMIT_REGISTER,
    },
    socketLimits: { perIp: e.WS_MAX_PER_IP, total: e.WS_MAX_TOTAL },
    defaultTenantSlug: noDefaultTenant ? null : e.DEFAULT_TENANT_SLUG,
  };
}
