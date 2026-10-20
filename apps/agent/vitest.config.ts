import { readFileSync } from 'node:fs';
import type { Plugin } from 'vitest/config';
import { defineConfig } from 'vitest/config';
import shared, { SOURCE_CONDITION } from '../../vitest.shared.ts';

// Vitest also hands these conditions to Node for CommonJS dependencies: with the `import` condition of the shared
// configuration, `require('ws')` inside @fastify/websocket would load the ESM wrapper of ws (no `WebSocket.Server`).
const conditions = [SOURCE_CONDITION, 'node', 'default'];

/** `import text from './x.ps1'` gives the text of the script, as esbuild `--loader:.ps1=text` in the bundle. */
const ps1Text: Plugin = {
  name: 'ps1-text',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0] ?? id;
    if (!file.endsWith('.ps1')) return null;
    return `export default ${JSON.stringify(readFileSync(file, 'utf8'))};`;
  },
};

/** `import bytes from './x.png'` (or `.ico`) gives the bytes, as esbuild `--loader:.png=binary` in the bundle. */
const binary: Plugin = {
  name: 'binary',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0] ?? id;
    if (!/\.(png|ico)$/.test(file)) return null;
    return `export default Uint8Array.from(Buffer.from(${JSON.stringify(readFileSync(file).toString('base64'))}, 'base64'));`;
  },
};

export default defineConfig({
  ...shared,
  plugins: [ps1Text, binary],
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { ...shared.test, testTimeout: 30_000, hookTimeout: 30_000 },
});
