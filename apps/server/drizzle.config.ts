import { defineConfig } from 'drizzle-kit';

// Only `generate` is used (no database connection): migrations are applied by the server at startup.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
