# Immagine del server (apps/server): build multi-stage con pnpm, esecuzione con Node 24 slim e utente non root.
# Build dalla radice del repository: docker compose build server

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# Compila il server e i pacchetti da cui dipende (ordine topologico).
RUN pnpm --filter "@sir/server..." build
# Cartella autonoma con il solo server e le dipendenze di produzione.
RUN pnpm --filter @sir/server deploy --prod /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8090
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8090/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
