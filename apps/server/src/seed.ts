import { DEFAULT_TENANT_SLUG } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { tenants, users } from './db/index.js';
import { hashPassword } from './lib/passwords.js';

/** The client «Predefinito» always exists (the migration creates it; this recreates it if it was removed). */
export async function seedDefaultTenant(db: Db, config: Config, log: FastifyBaseLogger): Promise<void> {
  await db
    .insert(tenants)
    .values({ slug: DEFAULT_TENANT_SLUG, name: 'Predefinito' })
    .onConflictDoNothing({ target: tenants.slug });
  const slug = config.defaultTenantSlug;
  if (slug) {
    const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!row)
      log.warn({ slug }, 'DEFAULT_TENANT_SLUG non corrisponde a nessun cliente: gli hostname sconosciuti avranno 404');
  }
}

/**
 * First superadmin from ADMIN_EMAIL/ADMIN_PASSWORD, only while no superadmin exists: a user with that email (the
 * first admin of an installation before the clients) becomes superadmin, keeping its password; otherwise it is
 * created. Also makes sure the client «Predefinito» exists.
 */
export async function seedAdmin(db: Db, config: Config, log: FastifyBaseLogger): Promise<boolean> {
  await seedDefaultTenant(db, config, log);
  if (!config.admin) return false;
  const [superadmin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'superadmin')).limit(1);
  if (superadmin) return false;
  const email = config.admin.email;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ role: 'superadmin', tenantId: null }).where(eq(users.id, existing.id));
    log.info({ email }, 'utente esistente promosso a superadmin');
    return true;
  }
  const passwordHash = await hashPassword(config.admin.password);
  await db
    .insert(users)
    .values({ email, passwordHash, role: 'superadmin', tenantId: null })
    .onConflictDoNothing({ target: users.email });
  log.info({ email }, 'creato il primo superadmin');
  return true;
}
