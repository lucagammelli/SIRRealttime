import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { schema } from './schema.js';

export * from './schema.js';

export type Schema = typeof schema;
/** Drizzle database, whatever the driver (node-postgres in production, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export interface Database {
  db: Db;
  /** Applies the migrations of `apps/server/drizzle`. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** Folder of the drizzle-kit migrations (same relative path from `src/db` and `dist/db`). */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Postgres via node-postgres (`postgres://…`), or in-memory/on-disk PGlite with `pglite:memory` / `pglite:<dir>` (development and tests only). */
export async function createDatabase(url: string): Promise<Database> {
  if (url.startsWith('pglite:')) {
    const { createPgliteDatabase } = await import('./pglite.js');
    const target = url.slice('pglite:'.length);
    return createPgliteDatabase(target === 'memory' || target === '' ? undefined : target);
  }
  const [{ drizzle }, { migrate }, pg] = await Promise.all([
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm/node-postgres/migrator'),
    import('pg'),
  ]);
  const pool = new pg.default.Pool({ connectionString: url, max: 10 });
  const db = drizzle({ client: pool, schema });
  return {
    db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => pool.end(),
  };
}
