import { count } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/index.js';
import { users } from './db/index.js';
import { hashPassword } from './lib/passwords.js';

/** First admin from ADMIN_EMAIL/ADMIN_PASSWORD, only if there are no users yet. */
export async function seedAdmin(db: Db, config: Config, log: FastifyBaseLogger): Promise<boolean> {
  if (!config.admin) return false;
  const [row] = await db.select({ n: count() }).from(users);
  if ((row?.n ?? 0) > 0) return false;
  const passwordHash = await hashPassword(config.admin.password);
  await db
    .insert(users)
    .values({ email: config.admin.email, passwordHash, role: 'admin' })
    .onConflictDoNothing({ target: users.email });
  log.info({ email: config.admin.email }, 'creato il primo utente admin');
  return true;
}
