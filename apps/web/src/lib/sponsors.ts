import type { BlockOptions, PublicSponsor, Sponsor } from '@arenalive/shared';
import { adminAssetPath, publicAssetPath } from '@arenalive/shared';

/** One image of the rotation of a sponsor block or slide. */
export interface SponsorItem {
  /** Path of the image (public, or of the reserved area in its previews). */
  src: string;
  /** Name of its sponsor (alternative text); null for a single image chosen before the sponsors. */
  name: string | null;
  /** `https://` website of its sponsor (the image becomes a link); null: none. */
  website: string | null;
}

/**
 * Pure: the images a sponsor block or slide shows in turn: every image of the sponsors chosen, in the order of the
 * list of the sponsors (`sponsors`, already in that order), then the single images chosen before the sponsors.
 * Sponsors chosen but unknown (deleted, not loaded) are skipped. `assetPath` gives the path of a single image
 * (default: the public one; the previews of the reserved area pass adminAssetPath).
 */
export function sponsorItems(
  options: Pick<BlockOptions<'sponsor'>, 'sponsors' | 'images'>,
  sponsors: readonly PublicSponsor[],
  assetPath: (id: string) => string = publicAssetPath,
): SponsorItem[] {
  const chosen = new Set(options.sponsors);
  const fromSponsors = sponsors
    .filter((s) => chosen.has(s.id))
    .flatMap((s) => s.images.map((src) => ({ src, name: s.name, website: s.website })));
  const singles = options.images.map((id) => ({ src: assetPath(id), name: null, website: null }));
  return [...fromSponsors, ...singles];
}

/**
 * Pure: the sponsors of the admin list as the public pages see them, for the previews of the reserved area: images
 * through adminAssetPath (the hostname of the reserved area may belong to another client).
 */
export function publicSponsorsOf(list: readonly Sponsor[]): PublicSponsor[] {
  return list.map((s) => ({ id: s.id, name: s.name, website: s.website, images: s.imageIds.map(adminAssetPath) }));
}

/**
 * Pure: columns of the grid of «tutti in una pagina» for `count` images: as square as possible, never more columns
 * than images (1 → 1, 2 → 2, 3-4 → 2, 5-6 → 3, 7-9 → 3, 10-12 → 4).
 */
export function sponsorGridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  return Math.ceil(Math.sqrt(count));
}
