import { createHash } from 'node:crypto';
import type { SystemLogo, SystemLogoPair, SystemLogos, SystemLogoSlot } from '@arenalive/shared';
import {
  ASSET_MAX_BASE64_LENGTH,
  ASSET_MAX_BYTES,
  AssetMimeSchema,
  IdParamSchema,
  SYSTEM_LOGO_MAX_HEIGHT,
  SYSTEM_LOGO_MAX_WIDTH,
  SystemLogoSlotParamSchema,
  systemLogoFits,
  systemLogoPath,
  UploadSystemLogoRequestSchema,
} from '@arenalive/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { readSystemLogoFile, removeSystemLogoFile, writeSystemLogoFile } from '../assetStore.js';
import type { AppContext } from '../context.js';
import { perMinute } from '../context.js';
import { systemLogos } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { ImageRejected, inspectImage } from '../lib/images.js';
import { validate } from '../lib/validate.js';
import { requireRole } from '../security.js';
import { IMMUTABLE_CACHE, SVG_CSP } from './branding.js';

type Row = typeof systemLogos.$inferSelect;
type Tx = Parameters<Parameters<AppContext['db']['transaction']>[0]>[0];

/** Key of the transaction lock that serializes the changes of the system logos (and of their files). */
const SYSTEM_LOGO_LOCK_KEY = 0x5349534c;
/** The logos change rarely: the public list stays in a cache for 30 s, as the graphics of a client. */
const LIST_CACHE = 'public, max-age=30';
/** Body limit of the upload: the base64 text of a 2 MB image plus the rest of the JSON. */
const UPLOAD_BODY_LIMIT = ASSET_MAX_BASE64_LENGTH + 1024;

const RawDataSchema = z.object({ data: z.string() });
const tooLarge = (): HttpError => new HttpError(413, 'TOO_LARGE', 'Immagine troppo grande (massimo 2 MB)');
const rejected = (message: string): HttpError => new HttpError(422, 'IMAGE_REJECTED', message);

const logoOf = (row: Row): SystemLogo | null => {
  const mime = AssetMimeSchema.safeParse(row.mime);
  return mime.success ? { url: systemLogoPath(row.id), mime: mime.data, width: row.width, height: row.height } : null;
};

/** The two variants of the two sides (null where none is loaded). */
async function listSystemLogos(db: AppContext['db'] | Tx): Promise<SystemLogos> {
  const rows = await db.select().from(systemLogos);
  const of = (slot: SystemLogoSlot): SystemLogoPair => {
    const find = (variant: string): SystemLogo | null => {
      const row = rows.find((r) => r.slot === slot && r.variant === variant);
      return row ? logoOf(row) : null;
    };
    return { positive: find('positive'), negative: find('negative') };
  };
  return { left: of('left'), right: of('right') };
}

/** Removes the file of `sha256` when no slot and variant uses it any more (the four places may share a file). */
async function dropFileIfUnused(ctx: AppContext, tx: Tx, sha256: string): Promise<void> {
  const [still] = await tx
    .select({ slot: systemLogos.slot })
    .from(systemLogos)
    .where(eq(systemLogos.sha256, sha256))
    .limit(1);
  if (!still) await removeSystemLogoFile(ctx.config.assetsDir, sha256);
}

/**
 * Public: the list of the system logos (same for every hostname, short cache) and their files (type from the
 * database, recognized from the bytes at upload, never sniffed; SVG with a CSP that blocks scripts and loads; the id
 * changes with the file: cached a year).
 */
export function systemLogoPublicRoutes(app: FastifyInstance, ctx: AppContext): void {
  const config = perMinute(ctx.rateLimits.public);

  app.get('/api/public/system-logos', { config }, async (_request, reply): Promise<SystemLogos> => {
    void reply.header('cache-control', LIST_CACHE);
    return listSystemLogos(ctx.db);
  });

  app.get('/api/public/system-logos/:id', { config }, async (request, reply) => {
    const params = IdParamSchema.safeParse(request.params);
    if (!params.success) throw notFound();
    const [row] = await ctx.db.select().from(systemLogos).where(eq(systemLogos.id, params.data.id)).limit(1);
    const mime = row ? AssetMimeSchema.safeParse(row.mime) : null;
    if (!row || !mime?.success) throw notFound();
    const file = await readSystemLogoFile(ctx.config.assetsDir, row.sha256);
    if (!file) {
      request.log.warn({ slot: row.slot, variant: row.variant }, 'file di un logo di sistema mancante');
      throw notFound();
    }
    void reply
      .header('content-type', mime.data === 'image/svg+xml' ? 'image/svg+xml; charset=utf-8' : mime.data)
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', 'inline')
      .header('cache-control', IMMUTABLE_CACHE);
    if (mime.data === 'image/svg+xml') void reply.header('content-security-policy', SVG_CSP);
    return reply.send(file);
  });
}

/**
 * Superadmin only: loads (or replaces) and removes the logo of a slot and variant; the answer is the new public list.
 */
export function systemLogoAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const superadmin = { config: perMinute(ctx.rateLimits.admin), preHandler: requireRole(ctx, 'superadmin') };

  /**
   * Upload as base64 JSON: type and size recognized from the bytes (PNG, JPEG, WebP, strictly checked SVG; anything
   * else 422), at most 2 MB (413) and 150×50 px (422 with the size found; an SVG by its declared size).
   */
  app.put(
    '/api/admin/system-logos/:slot/:variant',
    { ...superadmin, bodyLimit: UPLOAD_BODY_LIMIT },
    async (request): Promise<SystemLogos> => {
      const { slot, variant } = validate(SystemLogoSlotParamSchema, request.params);
      const raw = RawDataSchema.safeParse(request.body);
      if (raw.success && raw.data.data.length > ASSET_MAX_BASE64_LENGTH) throw tooLarge();
      const body = validate(UploadSystemLogoRequestSchema, request.body);
      const data = Buffer.from(body.data, 'base64');
      if (data.length > ASSET_MAX_BYTES) throw tooLarge();
      let info;
      try {
        info = inspectImage(data);
      } catch (err) {
        if (err instanceof ImageRejected) {
          request.log.info({ reason: err.message }, 'logo di sistema rifiutato');
          throw rejected(err.message);
        }
        throw err;
      }
      if (!systemLogoFits(info.width, info.height))
        throw rejected(
          `Logo troppo grande: al massimo ${SYSTEM_LOGO_MAX_WIDTH}×${SYSTEM_LOGO_MAX_HEIGHT} px, questo è ${info.width}×${info.height} px`,
        );
      const sha256 = createHash('sha256').update(data).digest('hex');
      const logos = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${SYSTEM_LOGO_LOCK_KEY})`);
        const [old] = await tx
          .select()
          .from(systemLogos)
          .where(and(eq(systemLogos.slot, slot), eq(systemLogos.variant, variant)))
          .limit(1);
        await writeSystemLogoFile(ctx.config.assetsDir, sha256, data);
        const values = { sha256, mime: info.mime, width: info.width, height: info.height, bytes: data.length };
        // A new id at every upload: the public path changes, so the immutable cache never shows the old file.
        await tx
          .insert(systemLogos)
          .values({ slot, variant, ...values })
          .onConflictDoUpdate({
            target: [systemLogos.slot, systemLogos.variant],
            set: { ...values, id: sql`gen_random_uuid()`, updatedAt: sql`now()` },
          });
        if (old && old.sha256 !== sha256) await dropFileIfUnused(ctx, tx, old.sha256);
        return listSystemLogos(tx);
      });
      request.log.info({ slot, variant, mime: info.mime, bytes: data.length }, 'logo di sistema caricato');
      return logos;
    },
  );

  app.delete('/api/admin/system-logos/:slot/:variant', superadmin, async (request): Promise<SystemLogos> => {
    const { slot, variant } = validate(SystemLogoSlotParamSchema, request.params);
    const logos = await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${SYSTEM_LOGO_LOCK_KEY})`);
      const [old] = await tx
        .delete(systemLogos)
        .where(and(eq(systemLogos.slot, slot), eq(systemLogos.variant, variant)))
        .returning();
      if (old) await dropFileIfUnused(ctx, tx, old.sha256);
      return listSystemLogos(tx);
    });
    request.log.info({ slot, variant }, 'logo di sistema rimosso');
    return logos;
  });
}
