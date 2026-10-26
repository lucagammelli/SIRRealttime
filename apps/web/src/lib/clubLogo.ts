import type { ClubLogoSize } from '@arenalive/shared';
import { useTenantLook } from './branding.ts';

/**
 * Places of the public page where the logo of our team (the logo of the club) follows «Dimensione del logo del club»:
 * the scoreboard (phone, tablet, big screen, template), the next match (blocks and full page) and the header.
 */
export type ClubLogoPlace =
  | 'scoreboardPhone'
  | 'scoreboardTablet'
  | 'scoreboardTv'
  | 'scoreboardTemplate'
  | 'nextMatchBlock'
  | 'nextMatchBlockTv'
  | 'nextMatchBlockFull'
  | 'nextMatchPage'
  | 'nextMatchPageBig'
  | 'header';

/**
 * Tailwind classes of the size of the logo for every place (written in full: Tailwind finds only literal classes).
 * `medium` is the size every logo had before the choice; the logo of the opponent always keeps it.
 */
const CLASSES: Record<ClubLogoPlace, Record<ClubLogoSize, string>> = {
  scoreboardPhone: { small: 'size-5', medium: 'size-7', large: 'size-10' },
  scoreboardTablet: { small: 'size-8', medium: 'size-10', large: 'size-14' },
  scoreboardTv: { small: 'size-12', medium: 'size-16', large: 'size-24' },
  scoreboardTemplate: { small: 'size-10 sm:size-12', medium: 'size-12 sm:size-14', large: 'size-16 sm:size-20' },
  nextMatchBlock: { small: 'size-12', medium: 'size-16', large: 'size-20' },
  nextMatchBlockTv: { small: 'size-20', medium: 'size-24', large: 'size-32' },
  nextMatchBlockFull: {
    small: 'size-20 tall:size-32',
    medium: 'size-28 tall:size-44',
    large: 'size-36 tall:size-56',
  },
  nextMatchPage: { small: 'size-16 sm:size-20', medium: 'size-20 sm:size-28', large: 'size-28 sm:size-36' },
  nextMatchPageBig: { small: 'size-32 lg:size-40', medium: 'size-40 lg:size-56', large: 'size-48 lg:size-72' },
  header: { small: 'h-6 max-w-36', medium: 'h-8 max-w-48', large: 'h-12 max-w-64' },
};

/** Pure: the size classes of a logo in a place: the size chosen for our team, the medium one for the opponent. */
export function clubLogoClass(place: ClubLogoPlace, size: ClubLogoSize, ours: boolean): string {
  return CLASSES[place][ours ? size : 'medium'];
}

/** The size chosen for the logo of the club (medium while the graphics are loading or without them). */
export function useOurLogoSize(): ClubLogoSize {
  return useTenantLook()?.ourLogoSize ?? 'medium';
}
