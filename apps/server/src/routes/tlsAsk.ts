import { isValidHostname } from '@arenalive/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { isTenantHostname } from '../tenancy.js';

/** Path asked by Caddy (`on_demand_tls { ask … }` in docker/Caddyfile) before a certificate for a new hostname. */
export const TLS_ASK_PATH = '/internal/tls/ask';

/**
 * Requests per minute: Caddy asks only for a hostname without a certificate, once per handshake. Over the limit the
 * answer is 429, which Caddy reads as «no certificate» (safe side).
 */
export const TLS_ASK_PER_MINUTE = 600;

/** Headers set by nginx and Caddy when they forward a request: the ask of Caddy never has them. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip', 'forwarded'];

/** Dotted IPv4 (valid as a hostname by the label rules, never a client's hostname). */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Hostname of the ask, as Caddy sends it: already lower case, without port, trailing dot or IP literal. Anything
 * else is invalid (never normalized: a certificate is only for the exact name stored for a client).
 */
export const TlsAskQuerySchema = z.object({
  domain: z
    .string()
    .max(253)
    .refine((d) => d === d.toLowerCase() && isValidHostname(d) && !IPV4.test(d)),
});

/** True when the request went through a proxy (so it did not come from Caddy's ask on the internal network). */
function forwarded(request: FastifyRequest): boolean {
  return PROXY_HEADERS.some((name) => request.headers[name] !== undefined);
}

/**
 * Permission of Caddy's on-demand certificates: 200 only for a hostname listed by a client (the hostnames are the
 * ones of the admin area, cache emptied by `forgetTenants`), 404 otherwise, 400 for an invalid `domain`. Reachable only on
 * the internal Docker network: nginx forwards `/api/` and `/ws/` only, and a forwarded request gets 404 anyway.
 */
export function tlsAskRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(TLS_ASK_PATH, { config: perMinute(TLS_ASK_PER_MINUTE) }, async (request, reply) => {
    if (forwarded(request)) return reply.code(404).send({ error: 'Non trovato' });
    const query = TlsAskQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Richiesta non valida' });
    const { domain } = query.data;
    if (!(await isTenantHostname(ctx, domain))) return reply.code(404).send({ error: 'Non trovato' });
    request.log.info({ domain }, 'certificato on demand consentito');
    return reply.code(200).send({ status: 'ok' });
  });
}
