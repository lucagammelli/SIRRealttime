import { PassThrough, Transform } from 'node:stream';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { INGEST_MAX_DECODED_BYTES, INGEST_MAX_WIRE_BYTES, IngestRequestSchema } from '@sir/shared';
import type { IngestResponse } from '@sir/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { payloadTooLarge, unauthorized, unsupportedMediaType } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { authenticateAgent } from '../security.js';

/**
 * preParsing of the ingest: at most INGEST_MAX_WIRE_BYTES on the wire, gzip decompressed on the fly;
 * the route `bodyLimit` caps the decompressed size (protection against zip bombs).
 */
function decodeBody(request: FastifyRequest, payload: Readable): Readable {
  const encoding = (request.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
  if (encoding !== 'identity' && encoding !== 'gzip') throw unsupportedMediaType();
  if (Number(request.headers['content-length']) > INGEST_MAX_WIRE_BYTES) throw payloadTooLarge();
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      received += chunk.length;
      if (received > INGEST_MAX_WIRE_BYTES) callback(payloadTooLarge());
      else callback(null, chunk);
    },
  });
  const out = encoding === 'gzip' ? createGunzip() : new PassThrough();
  counter.on('error', (err) => out.destroy(err));
  payload.pipe(counter).pipe(out);
  // Read by Fastify to check Content-Length against the bytes actually received.
  Object.defineProperty(out, 'receivedEncodedLength', { get: () => received });
  return out;
}

export function ingestRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/ingest',
    {
      bodyLimit: INGEST_MAX_DECODED_BYTES,
      config: perMinute(ctx.rateLimits.ingest),
      // After the rate limit (onRequest) and before the body is read.
      preParsing: [authenticateAgent(ctx), async (request, _reply, payload) => decodeBody(request, payload)],
    },
    async (request): Promise<IngestResponse> => {
      const agent = request.agent;
      if (!agent) throw unauthorized();
      const body = validate(IngestRequestSchema, request.body);
      // The match belongs to the client of the agent, whatever the hostname.
      const { response, published, route } = await ctx.ingest.ingest(agent, body);
      if (published) {
        ctx.publisher.publish(agent.tenantId, published, route);
        // A match that starts or ends changes «Prossima partita»: the public schedule is read again.
        if (route?.becameLive || published.state.status === 'finished') ctx.caches.schedule.delete(agent.tenantId);
      }
      request.log.info(
        { matchKey: body.matchKey, seq: body.seq, kind: body.kind, lines: body.lines.length, status: response.status },
        'ingest',
      );
      return response;
    },
  );
}
