import { defineConfig } from 'vitest/config';

/**
 * Base configuration shared by every package's `vitest.config.ts`.
 *
 * The `@sir/source` export condition makes workspace packages resolve to their TypeScript sources
 * (`src/index.ts`), so tests never need a previous build of their dependencies.
 */
export const SOURCE_CONDITION = '@sir/source';

export default defineConfig({
  resolve: {
    conditions: [SOURCE_CONDITION, 'module', 'node', 'import', 'default'],
  },
  ssr: {
    resolve: {
      conditions: [SOURCE_CONDITION, 'module', 'node', 'import', 'default'],
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
