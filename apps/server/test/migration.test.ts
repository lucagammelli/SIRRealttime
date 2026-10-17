import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { AGENT_QUOTA_MAX, AgentQuotaSchema, DEFAULT_AGENT_QUOTA, DEFAULT_TENANT_SLUG } from '@sir/shared';
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

describe('migration to the quota of agents and the calendar of the client', () => {
  it('keeps every active agent within the quota and the old matches and links as they were', async () => {
    const client = new PGlite();
    cleanup.push(() => client.close());
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: await migrationsUpTo('0006_club') });
    const [tenant] = await db.select({ id: tenants.id }).from(tenants);
    if (!tenant) throw new Error('no tenant');
    await client.exec(`
      insert into tenants (slug, name) values ('vuoto', 'Vuoto');
      insert into agents (tenant_id, name, token_hash, revoked) values
        ('${tenant.id}', 'a', 'h1', false), ('${tenant.id}', 'b', 'h2', false),
        ('${tenant.id}', 'c', 'h3', false), ('${tenant.id}', 'd', 'h4', true);
      insert into share_tokens (tenant_id, token_hash, match_id, label) values ('${tenant.id}', 't1', null, 'Live');
    `);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const rows = await db.select({ slug: tenants.slug, quota: tenants.agentQuota }).from(tenants);
    expect(rows.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: DEFAULT_TENANT_SLUG, quota: 3 },
      { slug: 'vuoto', quota: 1 },
    ]);
    const live = await db.select().from(shareTokens);
    expect(live).toEqual([expect.objectContaining({ matchId: null, clientFixtureId: null, label: 'Live' })]);
    const all = await db.select({ expiresAt: agents.expiresAt }).from(agents);
    expect(all.every((a) => a.expiresAt === null)).toBe(true);
  });
});

describe('migration 0008: quota of agents within the limits and users that can be disabled', () => {
  it('brings a quota of 378 (agents of the DAST scans) back to the maximum and then refuses it', async () => {
    const client = new PGlite();
    cleanup.push(() => client.close());
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: await migrationsUpTo('0006_club') });
    const [tenant] = await db.select({ id: tenants.id }).from(tenants);
    if (!tenant) throw new Error('no tenant');
    // 378 active agents: the migration 0007 gives the client a quota of 378, out of AgentQuotaSchema.
    const values = Array.from({ length: 378 }, (_, i) => `('${tenant.id}', 'dast-${i}', 'h${i}', false)`).join(', ');
    await client.exec(`
      insert into agents (tenant_id, name, token_hash, revoked) values ${values};
      insert into tenants (slug, name) values ('piccolo', 'Piccolo');
      insert into users (tenant_id, email, password_hash, role) values ('${tenant.id}', 'a@sir.test', 'x', 'admin');
    `);
    await migrate(db, { migrationsFolder: await migrationsUpTo('0007_ruoli_calendario') });
    const [before] = await db.select({ quota: tenants.agentQuota }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(before?.quota).toBe(378);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const rows = await db.select({ slug: tenants.slug, quota: tenants.agentQuota }).from(tenants);
    expect(rows.sort((a, b) => a.slug.localeCompare(b.slug))).toEqual([
      { slug: 'piccolo', quota: 1 },
      { slug: DEFAULT_TENANT_SLUG, quota: AGENT_QUOTA_MAX },
    ]);
    expect(AgentQuotaSchema.safeParse(rows.find((r) => r.slug === DEFAULT_TENANT_SLUG)?.quota).success).toBe(true);
    await expect(
      db
        .update(tenants)
        .set({ agentQuota: AGENT_QUOTA_MAX + 1 })
        .where(eq(tenants.id, tenant.id)),
    ).rejects.toThrow();
    await expect(db.update(tenants).set({ agentQuota: -1 }).where(eq(tenants.id, tenant.id))).rejects.toThrow();
    await db.update(tenants).set({ agentQuota: 0 }).where(eq(tenants.id, tenant.id));
    // The existing users stay active.
    const [user] = await db.select({ disabled: users.disabled }).from(users);
    expect(user?.disabled).toBe(false);
  });

  it('leaves a new installation with the default quota', async () => {
    const client = new PGlite();
    cleanup.push(() => client.close());
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const rows = await db.select({ slug: tenants.slug, quota: tenants.agentQuota }).from(tenants);
    expect(rows).toEqual([{ slug: DEFAULT_TENANT_SLUG, quota: DEFAULT_AGENT_QUOTA }]);
  });
});

describe('migration 0012: guided first setup', () => {
  it('marks the clients already configured as done and leaves the empty ones to do', async () => {
    const client = new PGlite();
    cleanup.push(() => client.close());
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: await migrationsUpTo('0011_posta_inviti') });
    await client.exec(`
      insert into tenants (slug, name) values ('vuoto', 'Vuoto');
      insert into tenants (slug, name, club_profile) values ('profilo', 'Profilo', '{"series":"SuperLega"}');
      insert into tenants (slug, name, branding) values ('grafica', 'Grafica', '{"template":"sir-volley"}');
      insert into tenants (slug, name) values ('campionato', 'Campionato');
      insert into leagues (provider, external_id, season) values ('legavolley', 999, 2026);
      insert into tenant_leagues (tenant_id, league_id)
        select t.id, l.id from tenants t, leagues l where t.slug = 'campionato';
    `);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const rows = await db.select({ slug: tenants.slug, at: tenants.onboardedAt }).from(tenants);
    const done = Object.fromEntries(rows.map((r) => [r.slug, r.at !== null]));
    expect(done).toEqual({
      [DEFAULT_TENANT_SLUG]: false,
      vuoto: false,
      profilo: true,
      grafica: true,
      campionato: true,
    });
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
