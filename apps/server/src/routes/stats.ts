import type { StatsCurve, StatsNow, StatsOverview } from '@sir/shared';
import { StatsPeriodQuerySchema } from '@sir/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { matches, shareTokens } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { addDays, romeDay } from '../stats/days.js';
import { buildOverview, matchLabelsOf, readCurve, readStats } from '../stats/store.js';
import { adminTenantId, tenantScope } from '../tenancy.js';

/** Days of the period when the request has none. */
const DEFAULT_PERIOD_DAYS = 30;

const MatchParamSchema = z.object({ matchId: z.uuid() });

/**
 * «Statistiche» (`/admin/statistiche`): read-only routes for admin and viewer, always on the client of the session
 * (the superadmin on the client chosen). Period in days of Rome, validated with the shared schema.
 */
export function statsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const read = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'viewer') };

  app.get('/api/admin/stats', read, async (request, reply): Promise<StatsOverview> => {
    const tenantId = adminTenantId(request);
    const query = validate(StatsPeriodQuerySchema, request.query);
    const today = romeDay(ctx.now());
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
    // Buffered visits are written before reading, so a page opened a moment ago is already counted.
    await ctx.stats.flush();
    void reply.header('cache-control', 'no-store');
    return buildOverview(await readStats(ctx.db, tenantId, from, to), from, to);
  });

  app.get('/api/admin/stats/now', read, async (request, reply): Promise<StatsNow> => {
    const tenantId = adminTenantId(request);
    const counts = ctx.stats.currently(tenantId);
    const matchIds = [...counts.matches.keys()].filter((id): id is string => id !== null);
    const [live] = await ctx.db
      .select({ id: matches.id })
      .from(matches)
      .where(tenantScope(matches, tenantId, eq(matches.live, true), eq(matches.simulated, false)))
      .limit(1);
    const labels = await matchLabelsOf(ctx.db, tenantId, [...new Set([...matchIds, ...(live ? [live.id] : [])])]);
    const linkRows = await ctx.db
      .select({ id: shareTokens.id, label: shareTokens.label })
      .from(shareTokens)
      .where(tenantScope(shareTokens, tenantId, eq(shareTokens.revoked, false)));
    const linkLabel = new Map(linkRows.map((l) => [l.id, l.label]));
    void reply.header('cache-control', 'no-store');
    return {
      viewers: counts.viewers,
      live: live ? { matchId: live.id, label: labels.get(live.id) ?? '' } : null,
      matches: [...counts.matches]
        .map(([matchId, viewers]) => ({
          matchId,
          label: matchId ? (labels.get(matchId) ?? 'Partita') : 'Prima dell’inizio della partita',
          viewers,
        }))
        .sort((a, b) => b.viewers - a.viewers),
      links: [...counts.links]
        .map(([id, viewers]) => ({ label: linkLabel.get(id) ?? 'Link', viewers }))
        .sort((a, b) => b.viewers - a.viewers),
    };
  });

  app.get('/api/admin/stats/matches/:matchId/curve', read, async (request, reply): Promise<StatsCurve> => {
    const tenantId = adminTenantId(request);
    const { matchId } = validate(MatchParamSchema, request.params);
    await ctx.stats.flush();
    const curve = await readCurve(ctx.db, tenantId, matchId);
    if (!curve) throw notFound();
    void reply.header('cache-control', 'no-store');
    return curve;
  });
}
