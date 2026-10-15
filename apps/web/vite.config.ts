import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/** Export condition of the workspace packages pointing to their TypeScript sources (as in vitest.shared.ts). */
const SOURCE_CONDITION = '@sir/source';

/** Sources of the monorepo packages (`packages/*`, `tools/*`). */
const WORKSPACE_SOURCE = /[\\/](packages|tools)[\\/][^\\/]+[\\/]src[\\/]/;

/** Address of `@sir/server` in development (`pnpm --filter @sir/server dev` or `pnpm --filter @sir/web demo`). */
const SERVER = process.env.SIR_SERVER_URL ?? 'http://localhost:8090';

// Same-origin in development: the portal proxies `/api` and `/ws`, so the session cookie and the Origin check work
// with CORS_ORIGIN=http://localhost:5173 on the server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
      // the DVW parser and iconv-lite, reached through the ingest schemas of @sir/shared, out of the browser bundle.
      treeshake: { moduleSideEffects: (id) => !WORKSPACE_SOURCE.test(id) },
      output: {
        // ECharts is most of the weight and changes rarely: its own chunk stays cached across releases.
        manualChunks: (id) => (/[\\/]node_modules[\\/].*(echarts|zrender)[\\/]/.test(id) ? 'echarts' : undefined),
      },
    },
  },
});
