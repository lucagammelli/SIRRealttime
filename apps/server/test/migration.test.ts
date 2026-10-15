import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { DEFAULT_TENANT_SLUG } from '@sir/shared';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import {
  agentRegistrations,
  agents,
  matches,
  MIGRATIONS_FOLDER,
  shareTokens,
  tenants,
  users,
} from '../src/db/index.js';
import { schema } from '../src/db/schema.js';
import { verifyPassword } from '../src/lib/passwords.js';
import { seedAdmin } from '../src/seed.js';

/** Tag of the last migration before the clients. */
const BEFORE_TENANTS = '0001_agent_registrations';
const silent = { info: () => undefined, warn: () => undefined } as unknown as Parameters<typeof seedAdmin>[2];

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanup.splice(0)) await c();
});

/** Copy of the migrations folder up to `lastTag` (journal trimmed), to build a database as it was before. */
async function migrationsUpTo(lastTag: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sir-migr-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((e) => e.tag === lastTag);
  const entries = journal.entries.slice(0, last + 1);
  await mkdir(join(dir, 'meta'));
  await writeFile(join(dir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  for (const e of entries) await copyFile(join(MIGRATIONS_FOLDER, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  return dir;
}

async function oldDatabase() {
  const client = new PGlite();
  cleanup.push(() => client.close());
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: await migrationsUpTo(BEFORE_TENANTS) });
  return { client, db };
}

describe('migration to clients', () => {
  it('puts every existing row in the client «Predefinito»', async () => {
    const { client, db } = await oldDatabase();
    // Rows with the shape of the database before the clients (raw SQL: the current schema has tenant_id).
    await client.exec(`
      insert into users (email, password_hash, role) values ('admin@sir.test', 'x', 'admin'), ('v@sir.test', 'x', 'viewer');
      insert into agents (id, name, token_hash) values ('11111111-1111-4111-8111-111111111111', 'pc', 'h1');
      insert into agent_registrations (name, secret_hash, pairing_code, expires_at)
        values ('pc2', 's1', 'K7M2QX', now() + interval '1 day');
      insert into matches (id, match_key, live) values ('22222222-2222-4222-8222-222222222222', 'gara-1', true);
      insert into matches (match_key) values ('gara-2');
      insert into share_tokens (token_hash, match_id, label)
        values ('t1', '22222222-2222-4222-8222-222222222222', 'Tribuna'), ('t2', null, 'Live');
    `);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const all = await db.select().from(tenants);
    expect(all.map((t) => [t.slug, t.name, t.hostnames])).toEqual([[DEFAULT_TENANT_SLUG, 'Predefinito', []]]);
    expect(all[0]).toMatchObject({ branding: {}, layout: {}, intermissions: {}, overlays: {} });
    const id = all[0]?.id;
    for (const table of [users, agents, agentRegistrations, matches, shareTokens]) {
      const rows = await db.select({ tenantId: table.tenantId }).from(table);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === id)).toBe(true);
    }
    const [live] = await db.select().from(matches).where(eq(matches.live, true));
    expect(live?.matchKey).toBe('gara-1');
  });

  it('makes tenant_id required and keeps the rules of roles and live matches', async () => {
    const { db } = await oldDatabase();
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const [tenant] = await db.select().from(tenants);
    if (!tenant) throw new Error('no tenant');
    await expect(db.execute(sql`insert into agents (name, token_hash) values ('pc', 'h')`)).rejects.toThrow();
    // A superadmin has no client, the others always have one.
    await expect(
      db.insert(users).values({ email: 'a@b.it', passwordHash: 'x', role: 'admin', tenantId: null }),
    ).rejects.toThrow();
    await expect(
      db.insert(users).values({ email: 's@b.it', passwordHash: 'x', role: 'superadmin', tenantId: tenant.id }),
    ).rejects.toThrow();
    await db.insert(users).values({ email: 's@b.it', passwordHash: 'x', role: 'superadmin', tenantId: null });
    // The same match key and a live match in each client.
    const [other] = await db.insert(tenants).values({ slug: 'altro', name: 'Altro' }).returning();
    if (!other) throw new Error('no tenant');
    await db.insert(matches).values([
      { tenantId: tenant.id, matchKey: 'g', live: true },
      { tenantId: other.id, matchKey: 'g', live: true },
    ]);
    await expect(db.insert(matches).values({ tenantId: tenant.id, matchKey: 'g' })).rejects.toThrow();
    await expect(db.insert(matches).values({ tenantId: tenant.id, matchKey: 'h', live: true })).rejects.toThrow();
  });
});

describe('seed', () => {
  const config = (env: Record<string, string> = {}) =>
    loadConfig({
      DATABASE_URL: 'pglite:memory',
      ADMIN_EMAIL: 'Capo@Sir.Test',
      ADMIN_PASSWORD: 'password-del-capo',
      ...env,
    });

  it('promotes the first admin of an existing installation to superadmin, keeping its password', async () => {
    const { client, db } = await oldDatabase();
    await client.exec(
      `insert into users (email, password_hash, role) values ('capo@sir.test', 'hash-vecchio', 'admin')`,
    );
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    expect(await seedAdmin(db, config(), silent)).toBe(true);
    const [user] = await db.select().from(users).where(eq(users.email, 'capo@sir.test'));
    expect(user).toMatchObject({ role: 'superadmin', tenantId: null, passwordHash: 'hash-vecchio' });
    // Once a superadmin exists, nothing changes any more.
    expect(await seedAdmin(db, config(), silent)).toBe(false);
  });

  it('creates the superadmin and the client «Predefinito» when missing', async () => {
    const { db } = await oldDatabase();
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await db.delete(tenants);
    expect(await seedAdmin(db, config(), silent)).toBe(true);
    const [user] = await db.select().from(users);
    expect(user).toMatchObject({ email: 'capo@sir.test', role: 'superadmin', tenantId: null });
    expect(await verifyPassword(user?.passwordHash, 'password-del-capo')).toBe(true);
    const all = await db.select().from(tenants);
    expect(all.map((t) => t.slug)).toEqual([DEFAULT_TENANT_SLUG]);
  });
});
