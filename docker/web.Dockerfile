# Immagine del portale (apps/web): build di Vite con pnpm, servizio con nginx non root (porta 8080).
# nginx serve la SPA e fa da proxy per /api e /ws verso il servizio `server` (docker/web.nginx.conf).
# Build dalla radice del repository: docker compose build web

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
# Vite legge i sorgenti dei pacchetti del monorepo (condizione @sir/source): non serve compilarli prima.
RUN pnpm --filter @sir/web build

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
# Configurazione principale con worker_connections e descrittori alzati per migliaia di WebSocket.
COPY docker/web.nginx.main.conf /etc/nginx/nginx.conf
COPY docker/web.nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/web.security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
