import type { SystemLogoPair } from '@arenalive/shared';
import { hasSystemLogo, pickSystemLogo } from '@arenalive/shared';
import { useRef } from 'react';
import { useBackgroundBehind } from '../lib/backgroundTone.ts';

/** Size of a system logo in a header row: at most 150 × 50 px, at most a quarter of the screen wide (360 px phones). */
export const SYSTEM_LOGO_ROW_SIZE =
  'max-h-[min(50px,calc(8.33*var(--sir-vw)))] max-w-[min(150px,calc(25*var(--sir-vw)))]';
/** Size of a system logo in its full box (150 × 50 px, the limit of the upload). */
export const SYSTEM_LOGO_FULL_SIZE = 'max-h-[50px] max-w-[150px]';

/**
 * A logo in two variants, the one meant for the background really behind it (negative on a dark one, positive on a
 * light one or when it cannot be told; the other variant when that one is missing). Nothing when there is none.
 * Proportions kept (`object-contain`); `marker`: data attributes of the image (tests, styles).
 */
export function VariantLogo({
  pair,
  alt,
  size,
  marker,
}: {
  pair: SystemLogoPair;
  alt: string;
  size: string;
  marker: (variant: string) => Record<`data-${string}`, string>;
}) {
  const box = useRef<HTMLSpanElement>(null);
  // The box is rendered only with a logo: read again when the pair goes from no logo to a logo.
  const background = useBackgroundBehind(box, hasSystemLogo(pair));
  const picked = pickSystemLogo(pair, background);
  if (!picked) return null;
  const { logo, variant } = picked;
  return (
    <span ref={box} className="inline-flex min-w-0 items-center">
      <img
        src={logo.url}
        alt={alt}
        {...marker(variant)}
        width={logo.width}
        height={logo.height}
        className={`block h-auto w-auto object-contain ${size}`}
      />
    </span>
  );
}

/**
 * One side of the system logos, in the variant meant for the background behind it (VariantLogo); decorative by
 * default (empty `alt`).
 */
export function SystemLogo({
  pair,
  side,
  alt = '',
  size = SYSTEM_LOGO_ROW_SIZE,
}: {
  pair: SystemLogoPair;
  side: 'sinistra' | 'destra';
  alt?: string;
  size?: string;
}) {
  return (
    <VariantLogo
      pair={pair}
      alt={alt}
      size={size}
      marker={(variant) => ({ 'data-system-logo': side, 'data-system-logo-variant': variant })}
    />
  );
}
