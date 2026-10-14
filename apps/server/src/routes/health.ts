import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

/** The only route without protection: database reachable or not. */
export function healthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (request, reply) => {
    try {
      await ctx.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch (err) {
      request.log.error({ err }, 'database non raggiungibile');
      return reply.code(503).send({ status: 'error' });
    }
  });
}
