import { defineConfig } from 'vitest/config';
import shared, { SOURCE_CONDITION } from '../../vitest.shared.ts';

// Vitest also hands these conditions to Node for CommonJS dependencies: with the `import` condition of the shared
// configuration, `require('ws')` inside @fastify/websocket would load the ESM wrapper of ws (no `WebSocket.Server`).
const conditions = [SOURCE_CONDITION, 'node', 'default'];

export default defineConfig({
  ...shared,
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { ...shared.test, testTimeout: 30_000, hookTimeout: 30_000 },
});
