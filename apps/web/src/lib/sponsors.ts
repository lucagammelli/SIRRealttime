import type { BlockOptions, PublicSponsor, Sponsor } from '@sir/shared';
import { publicAssetPath } from '@sir/shared';

/** One image of the rotation of a sponsor block or slide. */
export interface SponsorItem {
  /** Public path of the image. */
  src: string;
  /** Name of its sponsor (alternative text); null for a single image chosen before the sponsors. */
  name: string | null;
  /** `https://` website of its sponsor (the image becomes a link); null: none. */
  website: string | null;
}

/**
 * Pure: the images a sponsor block or slide shows in turn: every image of the sponsors chosen, in the order of the
 * list of the sponsors (`sponsors`, already in that order), then the single images chosen before the sponsors.
 * Sponsors chosen but unknown (deleted, not loaded) are skipped.
 */
export function sponsorItems(
  options: Pick<BlockOptions<'sponsor'>, 'sponsors' | 'images'>,
  sponsors: readonly PublicSponsor[],
): SponsorItem[] {
  const chosen = new Set(options.sponsors);
  const fromSponsors = sponsors
    .filter((s) => chosen.has(s.id))
    .flatMap((s) => s.images.map((src) => ({ src, name: s.name, website: s.website })));
  const singles = options.images.map((id) => ({ src: publicAssetPath(id), name: null, website: null }));
  return [...fromSponsors, ...singles];
}

/** Pure: the sponsors of the admin list as the public pages see them (previews of the reserved area). */
export function publicSponsorsOf(list: readonly Sponsor[]): PublicSponsor[] {
  return list.map((s) => ({ id: s.id, name: s.name, website: s.website, images: s.imageIds.map(publicAssetPath) }));
}
