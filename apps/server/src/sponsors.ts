import type { PublicSponsor, Sponsor } from '@sir/shared';
import { publicAssetPath, SPONSOR_IMAGES_MAX } from '@sir/shared';
import { asc, count, eq, inArray } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { assets, sponsors } from './db/index.js';
import { badRequest, conflict } from './lib/errors.js';
import type { Tx } from './matchLock.js';
import { tenantScope } from './tenancy.js';

/**
 * Sponsors of a client (`sponsors`) and their images (`assets.sponsor_id`): what the admin routes, the checks of the
 * page and the pauses and the public graphics share.
 */

type SponsorRow = typeof sponsors.$inferSelect;

/** Order of the list of a client: its position, then the name (two sponsors never share a name). */
const ORDER = [asc(sponsors.position), asc(sponsors.name)] as const;

/** Ids of the images of the sponsors `ids` of a client, by sponsor, in order of upload. */
async function imagesBySponsor(db: Db | Tx, tenantId: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({ id: assets.id, sponsorId: assets.sponsorId })
    .from(assets)
    .where(tenantScope(assets, tenantId, inArray(assets.sponsorId, ids)))
    .orderBy(asc(assets.createdAt), asc(assets.id));
  for (const r of rows) if (r.sponsorId) out.set(r.sponsorId, [...(out.get(r.sponsorId) ?? []), r.id]);
  return out;
}

const sponsorOf = (row: SponsorRow, imageIds: string[]): Sponsor => ({
  id: row.id,
  name: row.name,
  website: row.website,
  position: row.position,
  imageIds,
  createdAt: row.createdAt.toISOString(),
});

/** Every sponsor of a client, in the order of its list, with its images. */
export async function listSponsors(db: Db | Tx, tenantId: string): Promise<Sponsor[]> {
  const rows = await db
    .select()
    .from(sponsors)
    .where(tenantScope(sponsors, tenantId))
    .orderBy(...ORDER);
  const images = await imagesBySponsor(
    db,
    tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => sponsorOf(r, images.get(r.id) ?? []));
}

/** One sponsor of a client with its images; null when it is not one of the client. */
export async function findSponsor(db: Db | Tx, tenantId: string, id: string): Promise<Sponsor | null> {
  const [row] = await db
    .select()
    .from(sponsors)
    .where(tenantScope(sponsors, tenantId, eq(sponsors.id, id)))
    .limit(1);
  if (!row) return null;
  return sponsorOf(row, (await imagesBySponsor(db, tenantId, [row.id])).get(row.id) ?? []);
}

/** The sponsors `ids` of a client for the public pages, in the order of its list (the ones not found are left out). */
export async function publicSponsors(db: Db, tenantId: string, ids: string[]): Promise<PublicSponsor[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(sponsors)
    .where(tenantScope(sponsors, tenantId, inArray(sponsors.id, ids)))
    .orderBy(...ORDER);
  const images = await imagesBySponsor(
    db,
    tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    website: r.website,
    images: (images.get(r.id) ?? []).map(publicAssetPath),
  }));
}

/** Under the lock of the client: every sponsor of `ids` is of this client (400 otherwise). */
export async function requireOwnSponsors(tx: Tx, tenantId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await tx
    .select({ id: sponsors.id })
    .from(sponsors)
    .where(tenantScope(sponsors, tenantId, inArray(sponsors.id, ids)));
  if (rows.length !== ids.length) throw badRequest('Richiesta non valida: sponsor non trovato');
}

/**
 * Under the lock of the client: the sponsor `sponsorId` of the client can take one more image (400 when it is not one
 * of the client, 409 when it has SPONSOR_IMAGES_MAX already).
 */
export async function requireSponsorRoom(tx: Tx, tenantId: string, sponsorId: string): Promise<void> {
  await requireOwnSponsors(tx, tenantId, [sponsorId]);
  const [row] = await tx
    .select({ n: count() })
    .from(assets)
    .where(tenantScope(assets, tenantId, eq(assets.sponsorId, sponsorId)));
  if ((row?.n ?? 0) >= SPONSOR_IMAGES_MAX)
    throw conflict(`Uno sponsor può avere al massimo ${SPONSOR_IMAGES_MAX} immagini`);
}
