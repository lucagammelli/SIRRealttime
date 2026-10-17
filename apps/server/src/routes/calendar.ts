import { randomUUID } from 'node:crypto';
import type { CreatedFixtureResponse } from '@sir/shared';
import {
  FixtureDateRequestSchema,
  FixtureSettingsRequestSchema,
  IdParamSchema,
  MANUAL_FIXTURE_LABEL,
  ManualFixtureRequestSchema,
} from '@sir/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { fixtureLabel, ourTeamForManual } from '../club.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, clientFixtures, matches, shareTokens } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import type { Tx } from '../matchLock.js';
import { canStayLive, lockTenantMatches } from '../matchLock.js';
import { requireRole } from '../security.js';
import { announceFixture, closeNotBroadcast, forgetClubCaches, forgetShareToken, refreshClub } from '../state.js';
import { adminTenantId, tenantScope } from '../tenancy.js';

type FixtureRow = typeof clientFixtures.$inferSelect;

/** Under a lock: every image of `ids` is a logo of this client (400 otherwise). */
async function requireOwnLogos(tx: Tx, tenantId: string, ids: (string | null | undefined)[]): Promise<void> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (wanted.length === 0) return;
  const rows = await tx
    .select({ id: assets.id })
    .from(assets)
    .where(tenantScope(assets, tenantId, inArray(assets.id, wanted), eq(assets.kind, 'logo')))
    .limit(wanted.length);
  if (rows.length !== wanted.length) throw badRequest('Richiesta non valida: logo non trovato');
}

/** A match of the client, under the lock of its matches (404 for one of another client). */
async function fixtureOf(tx: Tx, tenantId: string, id: string): Promise<FixtureRow> {
  const [row] = await tx
    .select()
    .from(clientFixtures)
    .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, id)))
    .limit(1);
  if (!row) throw notFound();
  return row;
}

const onlyManual = () => badRequest('Si modificano e si cancellano solo le partite aggiunte a mano');

/**
 * The matches of the calendar of the client («Calendario», admin): matches added by hand (friendly, cup, other) with
 * their link and QR like the downloaded ones, changed or deleted only by the client; broadcast, hidden and logos of
 * every match. Every query goes through `tenantScope`; the changes run under the lock of the matches of the client
 * (the link of the `.dvw`), the logos are images `logo` of the client.
 */
export function manualFixtureRoutes(app: FastifyInstance, ctx: AppContext): void {
  const admin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'admin') };

  /** New match added by hand: then the links and the `.dvw` to confirm are looked at again (`refreshClub`). */
  app.post('/api/admin/calendar/fixtures', admin, async (request, reply): Promise<CreatedFixtureResponse> => {
    const tenantId = adminTenantId(request);
    const body = validate(ManualFixtureRequestSchema, request.body);
    const id = randomUUID();
    await ctx.db.transaction(async (tx) => {
      await lockTenantMatches(tx, tenantId);
      await requireOwnLogos(tx, tenantId, [body.opponentLogo]);
      const our = await ourTeamForManual(tx, tenantId);
      const home = body.ourSide === 'home';
      await tx.insert(clientFixtures).values({
        id,
        tenantId,
        leagueId: null,
        fixtureExternalId: `manual:${id}`,
        origin: 'manual',
        manualKind: body.kind,
        startsAt: new Date(body.startsAt),
        ourSide: body.ourSide,
        homeName: home ? our.name : body.opponent,
        awayName: home ? body.opponent : our.name,
        homeCity: home ? our.city : null,
        awayCity: home ? null : our.city,
        opponentLogoAssetId: body.opponentLogo,
        venue: body.venue,
        venueCity: body.venueCity,
        roundLabel: MANUAL_FIXTURE_LABEL[body.kind],
        leagueName: null,
        status: 'scheduled',
      });
    });
    await refreshClub(ctx, tenantId);
    request.log.info({ tenantId, clientFixtureId: id, userId: request.user?.id }, 'partita aggiunta al calendario');
    void reply.code(201);
    return { id };
  });

  app.put('/api/admin/calendar/fixtures/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(ManualFixtureRequestSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockTenantMatches(tx, tenantId);
      const row = await fixtureOf(tx, tenantId, id);
      if (row.origin !== 'manual') throw onlyManual();
      await requireOwnLogos(tx, tenantId, [body.opponentLogo]);
      const home = body.ourSide === 'home';
      const ourName = row.ourSide === 'home' ? row.homeName : row.awayName;
      const ourCity = row.ourSide === 'home' ? row.homeCity : row.awayCity;
      const values = {
        manualKind: body.kind,
        startsAt: new Date(body.startsAt),
        ourSide: body.ourSide,
        homeName: home ? ourName : body.opponent,
        awayName: home ? body.opponent : ourName,
        homeCity: home ? ourCity : null,
        awayCity: home ? null : ourCity,
        opponentLogoAssetId: body.opponentLogo,
        venue: body.venue,
        venueCity: body.venueCity,
        roundLabel: MANUAL_FIXTURE_LABEL[body.kind],
        updatedAt: ctx.now(),
      };
      await tx
        .update(clientFixtures)
        .set(values)
        .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, id)));
      await tx
        .update(shareTokens)
        .set({ label: fixtureLabel({ ...values, ourSide: body.ourSide }) })
        .where(tenantScope(shareTokens, tenantId, eq(shareTokens.clientFixtureId, id)));
    });
    await refreshClub(ctx, tenantId);
    await closeNotBroadcast(ctx, tenantId);
    await announceFixture(ctx, tenantId, id);
    request.log.info({ tenantId, clientFixtureId: id, userId: request.user?.id }, 'partita del calendario modificata');
    return reply.code(204).send();
  });

  /**
   * Date and time of any match. A downloaded match keeps its official date (`starts_at`, rewritten by the updates of
   * the calendar) and gets the date chosen by hand beside it (`override_*`, never touched by the updates) with the
   * official date of that moment, to tell if the league moves the match later; null goes back to the official date.
   * A match added by hand has only its own date (null is not possible).
   */
  app.put('/api/admin/calendar/fixtures/:id/date', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(FixtureDateRequestSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockTenantMatches(tx, tenantId);
      const row = await fixtureOf(tx, tenantId, id);
      const now = ctx.now();
      let values: Partial<FixtureRow>;
      if (row.origin === 'manual') {
        if (body.startsAt === null) throw badRequest('Una partita aggiunta a mano ha sempre una data');
        values = { startsAt: new Date(body.startsAt) };
      } else if (
        body.startsAt === null ||
        (row.startsAt && new Date(body.startsAt).getTime() === row.startsAt.getTime())
      ) {
        // Same as the official date: nothing to freeze, back to the automatic one.
        values = { overrideStartsAt: null, overriddenAt: null, overrideOfficialStartsAt: null };
      } else {
        values = {
          overrideStartsAt: new Date(body.startsAt),
          overriddenAt: now,
          overrideOfficialStartsAt: row.startsAt,
        };
      }
      await tx
        .update(clientFixtures)
        .set({ ...values, updatedAt: now })
        .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, id)));
      await tx
        .update(shareTokens)
        .set({ label: fixtureLabel({ ...row, ...values }) })
        .where(tenantScope(shareTokens, tenantId, eq(shareTokens.clientFixtureId, id)));
    });
    // The date decides which match a `.dvw` belongs to and which one is next: links and channel look again.
    await refreshClub(ctx, tenantId);
    await closeNotBroadcast(ctx, tenantId);
    await announceFixture(ctx, tenantId, id);
    request.log.info({ tenantId, clientFixtureId: id, userId: request.user?.id }, 'data della partita modificata');
    return reply.code(204).send();
  });

  /**
   * Deletes a match added by hand with its link (its spectators are disconnected); a `.dvw` linked to it goes back
   * among the ones to confirm (it stays live only if no other `.dvw` without a match of the calendar is live).
   */
  app.delete('/api/admin/calendar/fixtures/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const links = await ctx.db.transaction(async (tx) => {
      await lockTenantMatches(tx, tenantId);
      const row = await fixtureOf(tx, tenantId, id);
      if (row.origin !== 'manual') throw onlyManual();
      const linked = await tx
        .select({ id: matches.id, live: matches.live })
        .from(matches)
        .where(tenantScope(matches, tenantId, eq(matches.clientFixtureId, id)));
      for (const m of linked) {
        const live = m.live && (await canStayLive(tx, tenantId, m.id, null));
        await tx
          .update(matches)
          .set({ clientFixtureId: null, fixtureLink: 'pending', fixtureCandidates: [], live })
          .where(tenantScope(matches, tenantId, eq(matches.id, m.id)));
      }
      const tokens = await tx
        .select({ id: shareTokens.id })
        .from(shareTokens)
        .where(tenantScope(shareTokens, tenantId, eq(shareTokens.clientFixtureId, id)));
      await tx.delete(clientFixtures).where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, id)));
      return tokens.map((t) => t.id);
    });
    for (const linkId of links) {
      forgetShareToken(ctx, linkId);
      ctx.hub.closeShareToken(linkId);
    }
    forgetClubCaches(ctx, tenantId);
    request.log.info({ tenantId, clientFixtureId: id, userId: request.user?.id }, 'partita del calendario cancellata');
    return reply.code(204).send();
  });

  /**
   * Broadcast («Trasmessa» / «Non trasmessa» / as the coverage), hidden (downloaded matches only) and logos of one
   * match (null: back to the default one). The spectators of a link no longer broadcast are disconnected; the others
   * see the new logos at once.
   */
  app.patch('/api/admin/calendar/fixtures/:id/settings', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(FixtureSettingsRequestSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockTenantMatches(tx, tenantId);
      const row = await fixtureOf(tx, tenantId, id);
      if (body.hidden !== undefined && row.origin === 'manual')
        throw badRequest('Le partite aggiunte a mano non si nascondono: si cancellano');
      await requireOwnLogos(tx, tenantId, [body.ourLogo, body.opponentLogo]);
      await tx
        .update(clientFixtures)
        .set({
          ...(body.broadcast === undefined ? {} : { broadcast: body.broadcast }),
          ...(body.hidden === undefined ? {} : { hidden: body.hidden }),
          ...(body.ourLogo === undefined ? {} : { ourLogoAssetId: body.ourLogo }),
          ...(body.opponentLogo === undefined ? {} : { opponentLogoAssetId: body.opponentLogo }),
          updatedAt: ctx.now(),
        })
        .where(tenantScope(clientFixtures, tenantId, eq(clientFixtures.id, id)));
    });
    // A match broadcast again (or no longer) changes the link of the `.dvw` still to confirm: looked for again at once.
    await refreshClub(ctx, tenantId);
    await closeNotBroadcast(ctx, tenantId);
    await announceFixture(ctx, tenantId, id);
    request.log.info({ tenantId, clientFixtureId: id, userId: request.user?.id }, 'impostazioni della partita salvate');
    return reply.code(204).send();
  });
}
