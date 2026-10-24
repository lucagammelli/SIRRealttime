import type { ImportRosterResponse, Player, PlayerEditableField, RosterResponse } from '@arenalive/shared';
import {
  CreatePlayerRequestSchema,
  IdParamSchema,
  isVideoMime,
  PLAYER_EDITABLE_FIELDS,
  PLAYER_VIDEOS_MAX,
  PlayerMediaRequestSchema,
  PLAYERS_MAX,
  RosterQuerySchema,
  UpdatePlayerRequestSchema,
} from '@arenalive/shared';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { assets, playerMedia, players } from '../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { LeagueFetchError } from '../leagues/fetcher.js';
import { LeagueFormatError } from '../leagues/legavolley.js';
import type { Tx } from '../matchLock.js';
import { editedAfter, findPlayer, listPlayers, mergeRoster, rosterContext, rosterSeasons } from '../roster.js';
import type { PhotoToDownload } from '../rosterImport.js';
import { RosterPhotoJobs } from '../rosterImport.js';
import { requireRole } from '../security.js';
import { isUniqueViolation } from '../shareCodes.js';
import { adminTenantId, tenantConfigChanged, tenantScope } from '../tenancy.js';
import { lockClientAssets } from './branding.js';

/** Small JSON bodies only: the data of a player, the ids of its files. */
const ROSTER_BODY_LIMIT = 16 * 1024;

const numberTaken = (n: number) => conflict(`Il numero ${n} è già di un altro giocatore della rosa`);
const noSeason = () => conflict('Scegli prima in «Club» la serie e la squadra del club');

/** The number of the next player at the end of the roster of a season. */
async function nextPosition(tx: Tx, tenantId: string, season: number): Promise<number> {
  const [row] = await tx
    .select({ last: sql<number | null>`max(${players.position})` })
    .from(players)
    .where(tenantScope(players, tenantId, eq(players.season, season)));
  return (row?.last ?? -1) + 1;
}

/**
 * «Squadra» of the reserved area: the roster of the team of the client of the session (reading for every user of the
 * client, changes only for `admin`), always under the lock of the images of the client (the files of the players are
 * files of its library). The import reads the page of the team on the site of the league; its photos come in the
 * background.
 */
export function rosterRoutes(app: FastifyInstance, ctx: AppContext): void {
  const config = perMinute(ctx.rateLimits.admin);
  const admin = { config, bodyLimit: ROSTER_BODY_LIMIT, preHandler: requireRole(ctx, 'admin') };
  const viewer = { config, preHandler: requireRole(ctx, 'viewer') };
  const photos = new RosterPhotoJobs(ctx, app.log);
  app.addHook('onClose', async () => photos.close());

  app.get('/api/admin/roster', viewer, async (request): Promise<RosterResponse> => {
    const tenantId = adminTenantId(request);
    const query = validate(RosterQuerySchema, request.query);
    const context = await rosterContext(ctx.db, tenantId);
    const stored = await rosterSeasons(ctx.db, tenantId);
    const seasons = [...new Set([...(context.season === null ? [] : [context.season]), ...stored])].sort(
      (a, b) => b - a,
    );
    const season = query.season ?? context.season ?? stored[0] ?? null;
    return {
      season,
      seasons,
      team: context.team ? { id: context.team.id, name: context.team.name } : null,
      players: season === null ? [] : await listPlayers(ctx.db, tenantId, season),
      import: photos.state(tenantId),
    };
  });

  /** A player added by hand to the roster of the current season (409: no season, number used, roster full). */
  app.post('/api/admin/roster/players', admin, async (request, reply): Promise<Player> => {
    const tenantId = adminTenantId(request);
    const body = validate(CreatePlayerRequestSchema, request.body);
    const { season } = await rosterContext(ctx.db, tenantId);
    if (season === null) throw noSeason();
    let id: string;
    try {
      id = await ctx.db.transaction(async (tx) => {
        await lockClientAssets(tx, tenantId);
        const [active] = await tx
          .select({ n: count() })
          .from(players)
          .where(tenantScope(players, tenantId, eq(players.season, season), isNull(players.removedAt)));
        if ((active?.n ?? 0) >= PLAYERS_MAX) throw conflict(`Al massimo ${PLAYERS_MAX} giocatori nella rosa`);
        const [row] = await tx
          .insert(players)
          .values({ tenantId, season, ...body, source: 'manual', position: await nextPosition(tx, tenantId, season) })
          .returning({ id: players.id });
        if (!row) throw new Error('player not inserted');
        return row.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw numberTaken(body.number);
      throw err;
    }
    const created = await findPlayer(ctx.db, tenantId, id);
    if (!created) throw notFound();
    request.log.info({ tenantId, playerId: id, userId: request.user?.id }, 'giocatore aggiunto alla rosa');
    void reply.code(201);
    return created;
  });

  /**
   * Changes the data of a player: the fields sent become «changed by hand» (a new import never overwrites them);
   * `removed: false` puts a removed player back (409 when its number is now used).
   */
  app.patch('/api/admin/roster/players/:id', admin, async (request): Promise<Player> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(UpdatePlayerRequestSchema, request.body);
    const { removed, ...fields } = body;
    const changed = (Object.keys(fields) as (keyof typeof fields)[]).filter(
      (k): k is keyof typeof fields & PlayerEditableField =>
        fields[k] !== undefined && (PLAYER_EDITABLE_FIELDS as readonly string[]).includes(k),
    );
    try {
      await ctx.db.transaction(async (tx) => {
        await lockClientAssets(tx, tenantId);
        const [row] = await tx
          .select()
          .from(players)
          .where(tenantScope(players, tenantId, eq(players.id, id)))
          .limit(1);
        if (!row) throw notFound();
        await tx
          .update(players)
          .set({
            ...Object.fromEntries(changed.map((k) => [k, fields[k]])),
            editedFields: editedAfter(row.editedFields, changed),
            ...(removed === false ? { removedAt: null } : {}),
            updatedAt: ctx.now(),
          })
          .where(tenantScope(players, tenantId, eq(players.id, id)));
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const current = await findPlayer(ctx.db, tenantId, id);
        throw numberTaken(fields.number ?? current?.number ?? 0);
      }
      throw err;
    }
    tenantConfigChanged(ctx, tenantId);
    const player = await findPlayer(ctx.db, tenantId, id);
    if (!player) throw notFound();
    request.log.info({ tenantId, playerId: id, userId: request.user?.id, fields: changed }, 'giocatore modificato');
    return player;
  });

  /**
   * Takes a player out of the roster: one added by hand is deleted, an imported one is marked removed (a new import does
   * not bring it back; `PATCH removed: false` does). Its files stay in the library.
   */
  app.delete('/api/admin/roster/players/:id', admin, async (request, reply) => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const [row] = await tx
        .select({ source: players.source })
        .from(players)
        .where(tenantScope(players, tenantId, eq(players.id, id)))
        .limit(1);
      if (!row) throw notFound();
      if (row.source === 'manual') await tx.delete(players).where(tenantScope(players, tenantId, eq(players.id, id)));
      else
        await tx
          .update(players)
          .set({ removedAt: ctx.now(), updatedAt: ctx.now() })
          .where(tenantScope(players, tenantId, eq(players.id, id)));
    });
    tenantConfigChanged(ctx, tenantId);
    request.log.info({ tenantId, playerId: id, userId: request.user?.id }, 'giocatore tolto dalla rosa');
    return reply.code(204).send();
  });

  /**
   * Main photo and other photos and videos of a player: only files of the library of the client for the players (kind
   * `player`), the main photo an image, at most PLAYER_VIDEOS_MAX videos (400 otherwise). A main photo chosen here is
   * «changed by hand»: a new import does not replace it.
   */
  app.put('/api/admin/roster/players/:id/media', admin, async (request): Promise<Player> => {
    const tenantId = adminTenantId(request);
    const { id } = validate(IdParamSchema, request.params);
    const body = validate(PlayerMediaRequestSchema, request.body);
    await ctx.db.transaction(async (tx) => {
      await lockClientAssets(tx, tenantId);
      const [row] = await tx
        .select()
        .from(players)
        .where(tenantScope(players, tenantId, eq(players.id, id)))
        .limit(1);
      if (!row) throw notFound();
      const ids = [...new Set([...(body.photoAssetId ? [body.photoAssetId] : []), ...body.mediaIds])];
      const files = ids.length
        ? await tx
            .select({ id: assets.id, mime: assets.mime })
            .from(assets)
            .where(tenantScope(assets, tenantId, inArray(assets.id, ids), eq(assets.kind, 'player')))
        : [];
      if (files.length !== ids.length)
        throw badRequest('Richiesta non valida: file non trovato tra le foto e i video dei giocatori');
      const mime = new Map(files.map((f) => [f.id, f.mime]));
      if (body.photoAssetId && isVideoMime(mime.get(body.photoAssetId) ?? ''))
        throw badRequest('La foto principale deve essere un’immagine');
      if (body.mediaIds.filter((m) => isVideoMime(mime.get(m) ?? '')).length > PLAYER_VIDEOS_MAX)
        throw badRequest(`Al massimo ${PLAYER_VIDEOS_MAX} video per giocatore`);
      await tx.delete(playerMedia).where(tenantScope(playerMedia, tenantId, eq(playerMedia.playerId, id)));
      if (body.mediaIds.length > 0)
        await tx
          .insert(playerMedia)
          .values(body.mediaIds.map((assetId, position) => ({ tenantId, playerId: id, assetId, position })));
      const photoChanged = row.photoAssetId !== body.photoAssetId;
      await tx
        .update(players)
        .set({
          photoAssetId: body.photoAssetId,
          ...(photoChanged ? { editedFields: editedAfter(row.editedFields, ['photo']) } : {}),
          updatedAt: ctx.now(),
        })
        .where(tenantScope(players, tenantId, eq(players.id, id)));
    });
    tenantConfigChanged(ctx, tenantId);
    const player = await findPlayer(ctx.db, tenantId, id);
    if (!player) throw notFound();
    request.log.info({ tenantId, playerId: id, userId: request.user?.id }, 'foto e video del giocatore salvati');
    return player;
  });

  /**
   * «Importa dal sito della Lega»: the roster of the page of the team of the club (`mergeRoster`: the fields changed by
   * hand stay, the removed players stay removed, nobody is deleted), then the missing photos in the background. 409
   * without the team of the club or with an import still running, 502 when the site does not answer or changed.
   */
  app.post(
    '/api/admin/roster/import',
    { config: perMinute(ctx.rateLimits.rosterImport), preHandler: admin.preHandler },
    async (request): Promise<ImportRosterResponse> => {
      const tenantId = adminTenantId(request);
      const { season, team } = await rosterContext(ctx.db, tenantId);
      if (!team || season === null) throw conflict('Scegli prima in «Club» la squadra del club');
      if (photos.isRunning(tenantId)) throw conflict('Importazione già in corso: aspetta che finiscano le foto');
      let site;
      try {
        site = await ctx.leagues.fetchRoster(team.externalId);
      } catch (err) {
        if (err instanceof LeagueFormatError) throw new HttpError(502, 'LEAGUE_FORMAT', err.message);
        if (err instanceof LeagueFetchError)
          throw new HttpError(502, 'LEAGUE_UNAVAILABLE', 'Il sito della Lega non risponde: riprova tra poco');
        throw err;
      }
      const { merge, queue } = await ctx.db.transaction(async (tx) => {
        await lockClientAssets(tx, tenantId);
        const existing = await tx
          .select()
          .from(players)
          .where(tenantScope(players, tenantId, eq(players.season, season)));
        const merge = mergeRoster(existing, site);
        // First the players already in the roster (their new numbers may be the ones of the new players): the ones
        // that change number leave the index of the numbers for a moment, so that two of them can swap.
        const renumbered = merge.updates.filter((u) => u.renumbered).map((u) => u.id);
        if (renumbered.length > 0)
          await tx
            .update(players)
            .set({ removedAt: ctx.now() })
            .where(tenantScope(players, tenantId, inArray(players.id, renumbered)));
        for (const u of merge.updates)
          await tx
            .update(players)
            .set({ ...u.set, ...(u.renumbered ? { removedAt: null } : {}), updatedAt: ctx.now() })
            .where(tenantScope(players, tenantId, eq(players.id, u.id)));
        let position = await nextPosition(tx, tenantId, season);
        for (const p of merge.inserts)
          await tx.insert(players).values({
            tenantId,
            season,
            number: p.number,
            firstName: p.firstName,
            lastName: p.lastName,
            role: p.role,
            birthYear: p.birthYear,
            heightCm: p.heightCm,
            birthplace: p.birthplace,
            nationality: p.nationality,
            externalKey: p.key,
            source: 'league',
            position: position++,
          });
        const missing = await tx
          .select()
          .from(players)
          .where(
            tenantScope(
              players,
              tenantId,
              and(eq(players.season, season), isNull(players.removedAt), isNull(players.photoAssetId)),
            ),
          );
        const queue: PhotoToDownload[] = missing.flatMap((p) =>
          p.externalKey && !p.editedFields.includes('photo')
            ? [{ playerId: p.id, key: p.externalKey, firstName: p.firstName, lastName: p.lastName }]
            : [],
        );
        return { merge, queue };
      });
      photos.start(tenantId, team.externalId, queue);
      tenantConfigChanged(ctx, tenantId);
      request.log.info(
        {
          tenantId,
          userId: request.user?.id,
          season,
          added: merge.inserts.length,
          updated: merge.updates.length,
          skipped: merge.skipped.length,
          photos: queue.length,
        },
        'rosa importata dal sito della Lega',
      );
      return {
        season,
        added: merge.inserts.length,
        updated: merge.updates.length,
        unchanged: merge.unchanged,
        skipped: merge.skipped,
        notOnSite: merge.notOnSite,
        photosQueued: queue.length,
      };
    },
  );
}
