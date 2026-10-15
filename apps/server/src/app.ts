import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { FastifyError, FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import type { AppContext, RateLimits } from './context.js';
import type { Db } from './db/index.js';
import { LiveHub } from './hub.js';
import { IngestService } from './ingest.js';
import { HttpError } from './lib/errors.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { ingestRoutes } from './routes/ingest.js';
import { publicRoutes } from './routes/public.js';
import { registrationRoutes } from './routes/registration.js';
import { tenantRoutes } from './routes/tenants.js';
import { browserWriteGuard, rejectNulBody } from './security.js';

export interface AppOptions {
  config: Config;
  db: Db;
  /** Fastify logger option; default: pino at `config.logLevel` with secrets removed. */
  logger?: LoggerOption;
  rateLimits?: Partial<RateLimits>;
  now?: () => Date;
}

type LoggerOption = Exclude<FastifyServerOptions['logger'], undefined>;

/** Body limit of every route except the ingest (which has its own). */
const DEFAULT_BODY_LIMIT = 64 * 1024;
const WS_MAX_PAYLOAD = 4 * 1024;

/** Share tokens appear in public paths: they are masked in the logs. */
export function redactUrl(url: string): string {
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
};

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, db } = options;
  const app = Fastify({
    logger: options.logger ?? loggerOptions(config.logLevel),
    trustProxy: config.trustProxy,
    bodyLimit: DEFAULT_BODY_LIMIT,
  });
  const ctx: AppContext = {
    config,
    db,
    hub: new LiveHub(options.now),
    ingest: new IngestService(db, config.matchMaxLines),
    rateLimits: { ...config.rateLimits, ...options.rateLimits },
    now: options.now ?? (() => new Date()),
  };

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
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });
  await app.register(fastifyCookie);
  // Per client IP (behind a proxy, with TRUST_PROXY=true); a request without address shares one bucket.
  await app.register(fastifyRateLimit, { global: false, keyGenerator: (request) => request.ip || 'sconosciuto' });
  await app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD } });

  app.addHook('preValidation', rejectNulBody);
  healthRoutes(app, ctx);
  ingestRoutes(app, ctx);
  publicRoutes(app, ctx);
  registrationRoutes(app, ctx);
  // Checks with a cost or a rejection go in preParsing/preValidation/preHandler: the rate limit of a route is an
  // onRequest hook added after the others, so anything in onRequest would run before it and escape the count.
  await app.register((scope, _opts, done) => {
    scope.addHook('preParsing', browserWriteGuard(ctx));
    authRoutes(scope, ctx);
    adminRoutes(scope, ctx);
    tenantRoutes(scope, ctx);
    done();
  });

  app.addHook('onClose', () => ctx.hub.closeAll());
  return app;
}
