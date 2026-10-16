import { resolve } from 'node:path';
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

/** Shortest SHARE_CODE_SECRET accepted. */
export const SHARE_CODE_SECRET_MIN_LENGTH = 32;
/**
 * Development only (public, so not a secret): used when SHARE_CODE_SECRET is not set and NODE_ENV is not
 * `production`, with a warning in the log. In production the variable is required.
 */
export const DEV_SHARE_CODE_SECRET = 'sirrealtime-sviluppo-segreto-dei-codici-brevi-non-usare';

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
    ASSETS_DIR: z.string().min(1).default('data/assets'),
    ASSETS_QUOTA_MB: z.coerce.number().int().positive().max(1000).default(50),
    AGENT_DOWNLOAD_DIR: z.string().min(1).default('data/downloads'),
    RATE_LIMIT_SHORT_CODE_INVALID: perMinute(DEFAULT_RATE_LIMITS.shortCodeInvalidTotal),
    RATE_LIMIT_AGENT_DOWNLOAD: perMinute(DEFAULT_RATE_LIMITS.agentDownload),
    RATE_LIMIT_LEAGUE_SYNC: perMinute(DEFAULT_RATE_LIMITS.leagueSync),
    LEAGUE_SYNC: z.enum(['on', 'off']).default('on'),
    LEAGUE_CONTACT: z
      .string()
      .max(200)
      .regex(/^[\x20-\x7e]*$/)
      .optional(),
    SHARE_CODE_SECRET: z.string().min(SHARE_CODE_SECRET_MIN_LENGTH).max(1024).optional(),
    NODE_ENV: z.string().optional(),
  })
  .refine((e) => (e.ADMIN_EMAIL === undefined) === (e.ADMIN_PASSWORD === undefined), {
    message: 'ADMIN_EMAIL e ADMIN_PASSWORD vanno impostate insieme',
    path: ['ADMIN_PASSWORD'],
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.SHARE_CODE_SECRET !== undefined, {
    message: 'SHARE_CODE_SECRET obbligatoria in produzione',
    path: ['SHARE_CODE_SECRET'],
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
  /** Absolute folder of the uploaded images (one sub-folder per client). */
  assetsDir: string;
  /** Most bytes of images per client. */
  assetsQuotaBytes: number;
  /** Absolute folder with `sir-agent.exe` and `sir-agent.json` (scripts/costruisci-agente.sh), offered in the portal. */
  agentDownloadDir: string;
  /**
   * Key of the HMAC that derives the short code of each public link from its id: changing it changes every short
   * code (the printed QR codes stop working; the long links do not change).
   */
  shareCodeSecret: string;
  /** True when shareCodeSecret is DEV_SHARE_CODE_SECRET (SHARE_CODE_SECRET not set, not production). */
  shareCodeSecretIsDefault: boolean;
  /**
   * Automatic updates of the championships (night and match days); false (`LEAGUE_SYNC=off`, tests and development):
   * only «Aggiorna ora» of the admin area.
   */
  leagueSync: boolean;
  /** Contact in the User-Agent of the downloads from the league sites (default: PUBLIC_BASE_URL). */
  leagueContact: string;
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
      shortCodeInvalidTotal: e.RATE_LIMIT_SHORT_CODE_INVALID,
      agentDownload: e.RATE_LIMIT_AGENT_DOWNLOAD,
      leagueSync: e.RATE_LIMIT_LEAGUE_SYNC,
    },
    socketLimits: { perIp: e.WS_MAX_PER_IP, total: e.WS_MAX_TOTAL },
    defaultTenantSlug: noDefaultTenant ? null : e.DEFAULT_TENANT_SLUG,
    assetsDir: resolve(e.ASSETS_DIR),
    assetsQuotaBytes: e.ASSETS_QUOTA_MB * 1024 * 1024,
    agentDownloadDir: resolve(e.AGENT_DOWNLOAD_DIR),
    shareCodeSecret: e.SHARE_CODE_SECRET ?? DEV_SHARE_CODE_SECRET,
    shareCodeSecretIsDefault: e.SHARE_CODE_SECRET === undefined,
    leagueSync: e.LEAGUE_SYNC === 'on',
    leagueContact: e.LEAGUE_CONTACT?.trim() || e.PUBLIC_BASE_URL,
  };
}
