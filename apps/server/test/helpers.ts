import { gzipSync } from 'node:zlib';
import { decodeDvw } from '@sir/dvw-parser';
import type { GeneratedMatch } from '@sir/dvw-simulator';
import { renderDvw } from '@sir/dvw-simulator';
import type { IngestRequest } from '@sir/shared';
import { diffScoutLines, hashScoutLines, splitDvwText } from '@sir/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { RateLimits } from '../src/context.js';
import { SESSION_COOKIE } from '../src/context.js';
import type { Database } from '../src/db/index.js';
import { agents, users } from '../src/db/index.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import { hashPassword } from '../src/lib/passwords.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';

export const ORIGIN = 'http://portale.test';
export const ADMIN = { email: 'admin@sir.test', password: 'password-admin-1' };
export const VIEWER = { email: 'viewer@sir.test', password: 'password-viewer-1' };

export interface TestServer {
  app: FastifyInstance;
  database: Database;
  /** Moves the server clock (share token and session expiry). */
  setNow(date: Date | null): void;
  close(): Promise<void>;
}

/** App on an isolated in-memory PGlite database, with an admin and a viewer; `env` adds configuration variables. */
export async function startServer(
  rateLimits: Partial<RateLimits> = {},
  env: Record<string, string> = {},
): Promise<TestServer> {
  const database = createPgliteDatabase();
  await database.migrate();
  const config = loadConfig({
    DATABASE_URL: 'pglite:memory',
    CORS_ORIGIN: ORIGIN,
    PUBLIC_BASE_URL: ORIGIN,
    COOKIE_SECURE: 'false',
    LOG_LEVEL: 'silent',
    ...env,
  });
  let now: Date | null = null;
  const app = await buildApp({
    config,
    db: database.db,
    logger: process.env.TEST_LOG ? { level: 'error' } : false,
    rateLimits: { login: 1000, ingest: 10_000, public: 10_000, admin: 10_000, register: 10_000, ...rateLimits },
    now: () => now ?? new Date(),
  });
  await database.db.insert(users).values([
    { email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password), role: 'admin' },
    { email: VIEWER.email, passwordHash: await hashPassword(VIEWER.password), role: 'viewer' },
  ]);
  return {
    app,
    database,
    setNow: (d) => {
      now = d;
    },
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

/** Logs in and returns the `Cookie` header of the session. */
export async function login(app: FastifyInstance, who: { email: string; password: string }): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: who });
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('no session cookie');
  return `${SESSION_COOKIE}=${cookie.value}`;
}

/** Agent inserted directly in the database; returns its clear token. */
export async function createAgent(server: TestServer, revoked = false): Promise<string> {
  const token = generateToken();
  await server.database.db.insert(agents).values({ name: 'pc-test', tokenHash: hashToken(token), revoked });
  return token;
}

export function ingest(
  app: FastifyInstance,
  token: string,
  body: unknown,
  options: { gzip?: boolean } = {},
): Promise<LightMyRequestResponse> {
  const json = Buffer.from(JSON.stringify(body));
  return app.inject({
    method: 'POST',
    url: '/api/ingest',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.gzip ? { 'content-encoding': 'gzip' } : {}),
    },
    payload: options.gzip ? gzipSync(json) : json,
  });
}

/** Simulated DVW file with `upTo` scout rows, as the agent reads it. */
export function fileAt(match: GeneratedMatch, upTo: number): { header: string; scoutLines: string[] } {
  return splitDvwText(decodeDvw(renderDvw(match, upTo)));
}

/** Request the agent would send going from the lines `prev` to the file `next`. */
export async function requestFor(
  matchKey: string,
  seq: number,
  prev: string[],
  next: { header: string; scoutLines: string[] },
): Promise<IngestRequest> {
  const diff = diffScoutLines(prev, next.scoutLines);
  return {
    protocol: 1,
    matchKey,
    seq,
    kind: diff.kind,
    fromIndex: diff.fromIndex,
    lines: diff.lines,
    header: next.header,
    contentHash: await hashScoutLines(next.scoutLines),
  };
}
