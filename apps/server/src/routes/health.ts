import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@arenalive/shared';
import { buildInfo } from '../buildInfo.js';
import type { AppContext } from '../context.js';

/** The only route without protection: database reachable or not, and the running version (nothing else). */
export function healthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (request, reply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      const { version, commit } = buildInfo();
      const body: HealthResponse = { status: 'ok', version, ...(commit ? { commit } : {}) };
      return body;
    } catch (err) {
      request.log.error({ err }, 'database non raggiungibile');
      return reply.code(503).send({ status: 'error' });
    }
  });
}
