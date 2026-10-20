import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defaultClientConditions, defineConfig } from 'vite';
import { leggiCommit, leggiVersione } from '../../scripts/versione.mjs';

/** Export condition of the workspace packages pointing to their TypeScript sources (as in vitest.shared.ts). */
const SOURCE_CONDITION = '@arenalive/source';

/** Sources of the monorepo packages (`packages/*`, `tools/*`). */
const WORKSPACE_SOURCE = /[\\/](packages|tools)[\\/][^\\/]+[\\/]src[\\/]/;

/** Address of `@arenalive/server` in development (`pnpm --filter @arenalive/server dev` or `pnpm --filter @arenalive/web demo`). */
const SERVER = process.env.ARENALIVE_SERVER_URL ?? 'http://localhost:8090';

/**
 * Id of every build (`__ARENALIVE_BUILD__`), also written to `dist/version.json` (`{"build": "<id>"}`): a page opened before a
 * new release reads the file again and knows it is outdated (`newBuildAvailable` in src/lib/version.ts). Empty in
 * development, where no file is written.
 */
function buildIdPlugin(build: string): Plugin {
  return {
    name: 'sir-build-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ build })}\n` });
    },
  };
}

// Same-origin in development: the portal proxies `/api` and `/ws`, so the session cookie and the Origin check work
// with CORS_ORIGIN=http://localhost:5173 on the server.
export default defineConfig(({ command }) => {
  const build = command === 'build' ? randomUUID() : '';
  return {
    plugins: [react(), tailwindcss(), buildIdPlugin(build)],
    // Version of the root package.json (single source), short commit (ARENALIVE_COMMIT in Docker builds, else git) and id of
    // the build.
    define: {
      __ARENALIVE_VERSION__: JSON.stringify(leggiVersione()),
      __ARENALIVE_COMMIT__: JSON.stringify(leggiCommit()),
      __ARENALIVE_BUILD__: JSON.stringify(build),
    },
    resolve: {
      conditions: [SOURCE_CONDITION, ...defaultClientConditions],
      alias: { 'iconv-lite': fileURLToPath(new URL('./src/lib/iconv-browser.ts', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: SERVER },
        '/ws': { target: SERVER, ws: true },
      },
    },
    preview: { port: 5173, strictPort: true },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        // zod ships `@__PURE__` comments Rollup cannot place: harmless noise in every build.
        onwarn(warning, warn) {
          if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
          warn(warning);
        },
        // The workspace packages are pure modules (CLAUDE.md): an unused one is dropped with its imports. This keeps
        // the DVW parser and iconv-lite, reached through the ingest schemas of @arenalive/shared, out of the browser bundle.
        treeshake: { moduleSideEffects: (id) => !WORKSPACE_SOURCE.test(id) },
        output: {
          // ECharts is most of the weight and changes rarely: its own chunk stays cached across releases.
          manualChunks: (id) => (/[\\/]node_modules[\\/].*(echarts|zrender)[\\/]/.test(id) ? 'echarts' : undefined),
        },
      },
    },
  };
});
