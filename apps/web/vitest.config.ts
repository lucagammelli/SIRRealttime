import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { SOURCE_CONDITION } from '../../vitest.shared.ts';

const conditions = [SOURCE_CONDITION, 'module', 'browser', 'import', 'default'];

// Components run in jsdom; the pure chart and format functions do not need the DOM but share the same environment.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, 'node', 'import', 'default'] } },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'jsdom',
    testTimeout: 20_000,
  },
});
