import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { leggiVersione } from '../../scripts/versione.mjs';
import { SOURCE_CONDITION } from '../../vitest.shared.ts';

const conditions = [SOURCE_CONDITION, 'module', 'browser', 'import', 'default'];

// Components run in jsdom; the pure chart and format functions do not need the DOM but share the same environment.
export default defineConfig({
  plugins: [react()],
  define: {
    __ARENALIVE_VERSION__: JSON.stringify(leggiVersione()),
    __ARENALIVE_COMMIT__: JSON.stringify(''),
    __ARENALIVE_BUILD__: JSON.stringify('build-dei-test'),
  },
  resolve: { conditions },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, 'node', 'import', 'default'] } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    testTimeout: 20_000,
  },
});
