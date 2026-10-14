import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Database } from './index.js';
import { MIGRATIONS_FOLDER } from './index.js';
import { schema } from './schema.js';

/** PGlite database (in memory without `dataDir`): tests and local development, never production. */
export function createPgliteDatabase(dataDir?: string): Database {
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema });
  return {
    db,
    migrate: () => migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    close: () => client.close(),
  };
}
