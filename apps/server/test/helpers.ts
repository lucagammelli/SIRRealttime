import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { decodeDvw } from '@sir/dvw-parser';
import type { GeneratedMatch } from '@sir/dvw-simulator';
import { renderDvw } from '@sir/dvw-simulator';
import type { IngestRequest } from '@sir/shared';
import { DEFAULT_TENANT_SLUG, diffScoutLines, hashScoutLines, splitDvwText } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { AppOptions } from '../src/app.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { RateLimits } from '../src/context.js';
import { SESSION_COOKIE } from '../src/context.js';
import type { Database } from '../src/db/index.js';
import { agents, tenants, users } from '../src/db/index.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import { hashPassword } from '../src/lib/passwords.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';

export const ORIGIN = 'http://portale.test';
export const ADMIN = { email: 'admin@sir.test', password: 'password-admin-1' };
export const VIEWER = { email: 'viewer@sir.test', password: 'password-viewer-1' };
export const SUPERADMIN = { email: 'super@sir.test', password: 'password-super-1' };
/** Agents of the clients of the tests (`tenants.agent_quota` is 1 for a new client). */
export const TEST_AGENT_QUOTA = 50;

export interface TestServer {
  app: FastifyInstance;
  database: Database;
  /** Id of the client «Predefinito» (created by the migration): ADMIN and VIEWER belong to it. */
  tenantId: string;
  /** Folder of the uploaded images (temporary). */
  assetsDir: string;
  /** Moves the server clock (share token and session expiry). */
  setNow(date: Date | null): void;
  close(): Promise<void>;
}

/**
 * App on an isolated in-memory PGlite database, with an admin and a viewer of the client «Predefinito» and a
 * superadmin; `env` adds configuration variables.
 */
export async function startServer(
  rateLimits: Partial<RateLimits> = {},
  env: Record<string, string> = {},
  appOptions: Pick<AppOptions, 'leagueFetcher' | 'onRoute' | 'simulationTimers'> = {},
): Promise<TestServer> {
  const database = createPgliteDatabase();
  await database.migrate();
  // Uploaded images go to a temporary folder of this server, removed by close().
  const assetsDir = mkdtempSync(join(tmpdir(), 'sir-assets-'));
  const config = loadConfig({
    DATABASE_URL: 'pglite:memory',
    CORS_ORIGIN: ORIGIN,
    PUBLIC_BASE_URL: ORIGIN,
    COOKIE_SECURE: 'false',
    LOG_LEVEL: 'silent',
    ASSETS_DIR: assetsDir,
    LEAGUE_SYNC: 'off',
    ...env,
  });
  let now: Date | null = null;
  const app = await buildApp({
    config,
    db: database.db,
    logger: process.env.TEST_LOG ? { level: 'error' } : false,
    rateLimits: {
      login: 1000,
      ingest: 10_000,
      public: 10_000,
      publicWs: 10_000,
      publicInvalid: 10_000,
      admin: 10_000,
      register: 10_000,
      shortCodeInvalidTotal: 10_000,
      agentDownload: 10_000,
      leagueSync: 10_000,
      ...rateLimits,
    },
    now: () => now ?? new Date(),
    // No request ever leaves a test: without a fake fetch the league sites are unreachable.
    leagueFetcher: {
      fetch: () => Promise.reject(new Error('no network in tests')),
      minIntervalMs: 0,
      ...appOptions.leagueFetcher,
    },
    ...(appOptions.onRoute ? { onRoute: appOptions.onRoute } : {}),
    ...(appOptions.simulationTimers ? { simulationTimers: appOptions.simulationTimers } : {}),
  });
  const [tenant] = await database.db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT_SLUG));
  if (!tenant) throw new Error('default tenant missing');
  // Most tests create several agents: the quota of the clients is tested on its own (agentQuota.test.ts).
  await database.db.update(tenants).set({ agentQuota: TEST_AGENT_QUOTA }).where(eq(tenants.id, tenant.id));
  await database.db.insert(users).values([
    { tenantId: tenant.id, email: ADMIN.email, passwordHash: await hashPassword(ADMIN.password), role: 'admin' },
    { tenantId: tenant.id, email: VIEWER.email, passwordHash: await hashPassword(VIEWER.password), role: 'viewer' },
    {
      tenantId: null,
      email: SUPERADMIN.email,
      passwordHash: await hashPassword(SUPERADMIN.password),
      role: 'superadmin',
    },
  ]);
  return {
    app,
    database,
    tenantId: tenant.id,
    assetsDir: config.assetsDir,
    setNow: (d) => {
      now = d;
    },
    close: async () => {
      await app.close();
      await database.close();
      rmSync(assetsDir, { recursive: true, force: true });
    },
  };
}

/** Logs in (on the hostname `host`, default: the inject default) and returns the `Cookie` header of the session. */
export async function login(
  app: FastifyInstance,
  who: { email: string; password: string },
  host?: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: who,
    ...(host ? { headers: { host } } : {}),
  });
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}`);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('no session cookie');
  return `${SESSION_COOKIE}=${cookie.value}`;
}

/** Agent inserted directly in the database (default: client «Predefinito»); returns its clear token. */
export async function createAgent(server: TestServer, revoked = false, tenantId = server.tenantId): Promise<string> {
  const token = generateToken();
  await server.database.db.insert(agents).values({ tenantId, name: 'pc-test', tokenHash: hashToken(token), revoked });
  return token;
}

/** Client inserted directly in the database; returns its id. */
export async function createTenant(server: TestServer, slug: string, hostnames: string[]): Promise<string> {
  const [row] = await server.database.db
    .insert(tenants)
    .values({ slug, name: slug.toUpperCase(), hostnames, agentQuota: TEST_AGENT_QUOTA })
    .returning({ id: tenants.id });
  if (!row) throw new Error('tenant not inserted');
  return row.id;
}

/** User of a client inserted directly in the database. */
export async function createUser(
  server: TestServer,
  who: { email: string; password: string },
  role: 'admin' | 'viewer',
  tenantId: string,
): Promise<void> {
  await server.database.db
    .insert(users)
    .values({ tenantId, email: who.email, passwordHash: await hashPassword(who.password), role });
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
