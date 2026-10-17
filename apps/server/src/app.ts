import { createRequire } from 'node:module';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { AppContext, RateLimits, SocketLimits } from './context.js';
import { LOOKUP_CACHE_TTL_MS, SCHEDULE_CACHE_TTL_MS } from './context.js';
import type { Db } from './db/index.js';
import { LiveHub } from './hub.js';
import { IngestService } from './ingest.js';
import { HttpError } from './lib/errors.js';
import { FailureLimiter } from './lib/failureLimiter.js';
import { ResyncScheduler } from './lib/resync.js';
import type { LeagueFetcherOptions } from './leagues/fetcher.js';
import { LeagueFetcher, leagueUserAgent } from './leagues/fetcher.js';
import { LeagueScheduler } from './leagues/scheduler.js';
import { LeagueService } from './leagues/sync.js';
import { TtlCache } from './lib/ttlCache.js';
import { adminRoutes } from './routes/admin.js';
import { agentDownloadRoutes } from './routes/agentDownload.js';
import { authRoutes } from './routes/auth.js';
import { brandingAdminRoutes, brandingPublicRoutes } from './routes/branding.js';
import { clubPublicRoutes, clubRoutes } from './routes/club.js';
import { manualFixtureRoutes } from './routes/calendar.js';
import { manifestRoutes } from './routes/manifest.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { leaguePublicRoutes, leagueRoutes } from './routes/leagues.js';
import { publicRoutes } from './routes/public.js';
import { registrationRoutes } from './routes/registration.js';
import { tenantRoutes } from './routes/tenants.js';
import { userRoutes } from './routes/users.js';
import { browserWriteGuard, rejectNulBody } from './security.js';
import { tenantsOfLeague } from './club.js';
import { ChannelWatcher, refreshClub } from './state.js';

export interface AppOptions {
  config: Config;
  db: Db;
  /** Fastify logger option; default: pino at `config.logLevel` with secrets removed. */
  logger?: LoggerOption;
  rateLimits?: Partial<RateLimits>;
  socketLimits?: Partial<SocketLimits>;
  now?: () => Date;
  /** Downloads from the league sites (tests: fake fetch, no pacing). */
  leagueFetcher?: Partial<Omit<LeagueFetcherOptions, 'userAgent'>>;
  /** Called for every route registered (tests: the list of the routes, e.g. every admin route that writes). */
  onRoute?: (route: { method: string; url: string }) => void;
}

type LoggerOption = Exclude<FastifyServerOptions['logger'], undefined>;

/** Body limit of every route except the ingest (which has its own). */
const DEFAULT_BODY_LIMIT = 64 * 1024;
const WS_MAX_PAYLOAD = 4 * 1024;
/** Hostnames and share tokens kept in the lookup caches (the oldest go first). */
const LOOKUP_CACHE_ENTRIES = 10_000;

/** Version of the server package (in the User-Agent of the downloads from the league sites). */
function serverVersion(): string {
  try {
    const pkg: unknown = createRequire(import.meta.url)('../package.json');
    return typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string'
      ? pkg.version
      : '0';
  } catch {
    return '0';
  }
}

/** Share tokens appear in public paths: they are masked in the logs (not the graphics routes of the client). */
export function redactUrl(url: string): string {
  if (/^\/api\/public\/(?:tenant(?:[?#]|$)|manifest\.webmanifest(?:[?#]|$)|assets\/|team-logos\/)/.test(url))
    return url;
  return url.replace(/^\/(api|ws)\/public\/[^/?#]+/, '/$1/public/[token]');
}

export function loggerOptions(level: string): LoggerOption {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.secret',
      ],
      censor: '[omesso]',
    },
    serializers: {
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: redactUrl(req.url),
        remoteAddress: req.ip,
      }),
    },
  };
}

const MESSAGES: Record<number, string> = {
  400: 'Richiesta non valida',
  401: 'Non autorizzato',
  403: 'Accesso negato',
  404: 'Non trovato',
  405: 'Metodo non consentito',
  413: 'Richiesta troppo grande',
  415: 'Formato della richiesta non supportato',
  429: 'Troppe richieste, riprova più tardi',
  503: 'Servizio non disponibile, riprova tra poco',
};

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger: options.logger ?? loggerOptions(config.logLevel),
    trustProxy: config.trustProxy,
    bodyLimit: DEFAULT_BODY_LIMIT,
  });
  const now = options.now ?? (() => new Date());
  const rateLimits = { ...config.rateLimits, ...options.rateLimits };
  const hub = new LiveHub(now);
  const leagues = new LeagueService({
    db,
    fetcher: new LeagueFetcher({
      userAgent: leagueUserAgent(serverVersion(), config.leagueContact),
      ...options.leagueFetcher,
    }),
    assetsDir: config.assetsDir,
    now,
    log: app.log,
    // After a good update the clubs that play the championship copy their matches again (and their links).
    onUpdated: async (leagueId) => {
      for (const tenantId of await tenantsOfLeague(db, leagueId)) await refreshClub(ctx, tenantId);
    },
  });
  const ctx: AppContext = {
    config,
    db,
    hub,
    publisher: hub,
    ingest: new IngestService(db, config.matchMaxLines),
    rateLimits,
    socketLimits: { ...config.socketLimits, ...options.socketLimits },
    caches: {
      hosts: new TtlCache(LOOKUP_CACHE_TTL_MS, LOOKUP_CACHE_ENTRIES, now),
      shares: new TtlCache(LOOKUP_CACHE_TTL_MS, LOOKUP_CACHE_ENTRIES, now),
      schedule: new TtlCache(SCHEDULE_CACHE_TTL_MS, LOOKUP_CACHE_ENTRIES, now),
      logos: new TtlCache(SCHEDULE_CACHE_TTL_MS, LOOKUP_CACHE_ENTRIES, now),
      broadcast: new TtlCache(SCHEDULE_CACHE_TTL_MS, LOOKUP_CACHE_ENTRIES, now),
    },
    publicFailures: new FailureLimiter(rateLimits.publicInvalid, 60_000, now),
    shortCodeFailures: new FailureLimiter(rateLimits.shortCodeInvalidTotal, 60_000, now),
    resync: new ResyncScheduler(now),
    leagues,
    now,
  };

  const onRoute = options.onRoute;
  if (onRoute) {
    app.addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) onRoute({ method, url: route.url });
    });
  }
  app.decorateRequest('user', null);
  app.decorateRequest('sessionExpiresAt', null);
  app.decorateRequest('adminTenantId', null);
  app.decorateRequest('agent', null);
  app.decorateRequest('shareToken', null);
  // Only JSON bodies are accepted.
  app.removeContentTypeParser('text/plain');

  app.setErrorHandler((err: FastifyError | HttpError, request, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (status >= 500) request.log.error({ err }, 'errore interno');
    else request.log.info({ code: err.code, status }, 'richiesta rifiutata');
    return reply
      .code(status)
      .send({ error: MESSAGES[status] ?? (status >= 500 ? 'Errore interno' : 'Richiesta non valida') });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: MESSAGES[404] }));

  await app.register(fastifyHelmet);
  await app.register(fastifyCors, {
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(fastifyCookie);
  // Per client IP (behind a proxy, with TRUST_PROXY=true); a request without address shares one bucket.
  await app.register(fastifyRateLimit, { global: false, keyGenerator: (request) => request.ip || 'sconosciuto' });
  await app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD } });

  app.addHook('preValidation', rejectNulBody);
  healthRoutes(app, ctx);
  ingestRoutes(app, ctx);
  brandingPublicRoutes(app, ctx);
  leaguePublicRoutes(app, ctx);
  clubPublicRoutes(app, ctx);
  manifestRoutes(app, ctx);
  publicRoutes(app, ctx);
  registrationRoutes(app, ctx);
  // Checks with a cost or a rejection go in preParsing/preValidation/preHandler: the rate limit of a route is an
  // onRequest hook added after the others, so anything in onRequest would run before it and escape the count.
  await app.register((scope, _opts, done) => {
    scope.addHook('preParsing', browserWriteGuard(ctx));
    authRoutes(scope, ctx);
    adminRoutes(scope, ctx);
    userRoutes(scope, ctx);
    tenantRoutes(scope, ctx);
    brandingAdminRoutes(scope, ctx);
    agentDownloadRoutes(scope, ctx);
    leagueRoutes(scope, ctx);
    clubRoutes(scope, ctx);
    manualFixtureRoutes(scope, ctx);
    done();
  });

  // Automatic updates of the championships only when the server is ready (LEAGUE_SYNC=off: never).
  const scheduler = config.leagueSync ? new LeagueScheduler({ db, leagues, now, log: app.log }) : null;
  // The channels of the clubs move to the next match after the end of the last one, without a reload.
  const channels = new ChannelWatcher(ctx, app.log);
  app.addHook('onReady', (done) => {
    scheduler?.start();
    channels.start();
    done();
  });
  app.addHook('onClose', async () => {
    channels.stop();
    ctx.hub.closeAll();
    leagues.close();
    await scheduler?.stop();
    await leagues.idle();
  });
  return app;
}
