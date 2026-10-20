import type { Sponsor, SponsorListResponse } from '@arenalive/shared';
import {
  CreateSponsorRequestSchema,
  IdParamSchema,
  intermissionSponsorIds,
  layoutSponsorIds,
  resolveIntermissions,
  resolveLayout,
  SponsorOrderRequestSchema,
  SPONSORS_MAX,
  UpdateSponsorRequestSchema,
} from '@arenalive/shared';
import { count, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, sponsors, tenants } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { isUniqueViolation } from '../shareCodes.js';
import { findSponsor, listSponsors } from '../sponsors.js';
import { adminTenantId, forgetTenants, tenantScope } from '../tenancy.js';
import { assetUse, deleteAssetRow, lockClientAssets } from './branding.js';

/** Small JSON bodies only: names, websites and the list of the ids. */
const SPONSOR_BODY_LIMIT = 16 * 1024;

const nameTaken = () => conflict('Esiste già uno sponsor con questo nome');

/**
 * «Sponsor» of the reserved area: the sponsors of the client of the session (reading for every user of the client,
 * changes only for `admin`), always under the lock of the images and graphics of the client.
 */
export function sponsorRoutes(app: FastifyInstance, ctx: AppContext): void {
  const config = perMinute(ctx.rateLimits.admin);
  const admin = { config, bodyLimit: SPONSOR_BODY_LIMIT, preHandler: requireRole(ctx, 'admin') };
  const viewer = { config, preHandler: requireRole(ctx, 'viewer') };

  app.get('/api/admin/sponsors', viewer, async (request): Promise<SponsorListResponse> => ({
    sponsors: await listSponsors(ctx.db, adminTenantId(request)),
  }));

  /** A new sponsor, last in the list (409 for a name already used or past SPONSORS_MAX). */
  app.post('/api/admin/sponsors', admin, async (request, reply): Promise<Sponsor> => {
    const tenantId = adminTenantId(request);
    const body = validate(CreateSponsorRequestSchema, request.body);
    const id = await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const [stats] = await tx
        .select({ n: count(), last: sql<number | null>`max(${sponsors.position})` })
        .from(sponsors)
        .where(tenantScope(sponsors, tenantId));
      if ((stats?.n ?? 0) >= SPONSORS_MAX) throw conflict(`Al massimo ${SPONSORS_MAX} sponsor per cliente`);
      const [row] = await tx
        .insert(sponsors)
        .values({ tenantId, name: body.name, website: body.website, position: (stats?.last ?? -1) + 1 })
        .onConflictDoNothing({ target: [sponsors.tenantId, sponsors.name] })
        .returning({ id: sponsors.id });
      if (!row) throw nameTaken();
      return row.id;
    });
    const created = await findSponsor(ctx.db, tenantId, id);
    if (!created) throw notFound();
    request.log.info({ tenantId, sponsorId: id, userId: request.user?.id }, 'sponsor creato');
    void reply.code(201);
    return created;
  });

  /** Name and/or website of a sponsor (409 for a name of another sponsor of the client). */
  app.patch('/api/admin/sponsors/:id', admin, async (request): Promise<Sponsor> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(UpdateSponsorRequestSchema, request.body);
    try {
      const updated = await ctx.db
        .update(sponsors)
        .set({
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.website === undefined ? {} : { website: body.website }),
        })
        .where(tenantScope(sponsors, tenantId, eq(sponsors.id, id)))
        .returning({ id: sponsors.id });
      if (updated.length === 0) throw notFound();
    } catch (err) {
      if (isUniqueViolation(err)) throw nameTaken();
      throw err;
    }
    // The public pages show name and website of the sponsors chosen.
    forgetTenants(ctx);
    const sponsor = await findSponsor(ctx.db, tenantId, id);
    if (!sponsor) throw notFound();
    request.log.info({ tenantId, sponsorId: id, userId: request.user?.id }, 'sponsor modificato');
    return sponsor;
  });

  /** New order of the list: every sponsor of the client exactly once (400 otherwise). */
  app.put('/api/admin/sponsors/order', admin, async (request): Promise<SponsorListResponse> => {
    const tenantId = adminTenantId(request);
    const { ids } = validate(SponsorOrderRequestSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const rows = await tx.select({ id: sponsors.id }).from(sponsors).where(tenantScope(sponsors, tenantId));
      const known = new Set(rows.map((r) => r.id));
      if (rows.length !== ids.length || ids.some((i) => !known.has(i)))
        throw badRequest('Richiesta non valida: l’ordine deve contenere tutti gli sponsor una volta');
      for (const [position, sponsorId] of ids.entries())
        await tx
          .update(sponsors)
          .set({ position })
          .where(tenantScope(sponsors, tenantId, eq(sponsors.id, sponsorId)));
    });
    forgetTenants(ctx);
    request.log.info({ tenantId, userId: request.user?.id }, 'ordine degli sponsor cambiato');
    return { sponsors: await listSponsors(ctx.db, tenantId) };
  });

  /**
   * Deletes a sponsor not chosen by the page or the pauses (409 otherwise) with its images not used elsewhere; the
   * ones still used (branding, single images of a block) stay, without sponsor.
   */
  app.delete('/api/admin/sponsors/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const removed = await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const [row] = await tx
        .select({ id: sponsors.id })
        .from(sponsors)
        .where(tenantScope(sponsors, tenantId, eq(sponsors.id, id)))
        .limit(1);
      if (!row) throw notFound();
      const [tenant] = await tx
        .select({ layout: tenants.layout, intermissions: tenants.intermissions })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      if (layoutSponsorIds(resolveLayout(tenant?.layout)).includes(id))
        throw conflict('Sponsor in uso nella pagina pubblica: toglilo dal blocco sponsor prima di eliminarlo');
      if (intermissionSponsorIds(resolveIntermissions(tenant?.intermissions)).includes(id))
        throw conflict('Sponsor in uso nelle pause: toglilo dalla diapositiva sponsor prima di eliminarlo');
      const images = await tx
        .select()
        .from(assets)
        .where(tenantScope(assets, tenantId, eq(assets.sponsorId, id)));
      let deleted = 0;
      for (const image of images) {
        if (await assetUse(tx, tenantId, image.id)) continue;
        await deleteAssetRow(ctx, tx, image);
        deleted++;
      }
      // The images still used elsewhere stay without sponsor (ON DELETE SET NULL).
      await tx.delete(sponsors).where(tenantScope(sponsors, tenantId, eq(sponsors.id, id)));
      return deleted;
    });
    request.log.info(
      { tenantId, sponsorId: id, imagesDeleted: removed, userId: request.user?.id },
      'sponsor eliminato',
    );
    return reply.code(204).send();
  });
}
