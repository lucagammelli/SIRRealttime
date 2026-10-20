import type { SystemLogoPair } from '@sir/shared';
import { hasSystemLogo, pickSystemLogo } from '@sir/shared';
import { useRef } from 'react';
import { useBackgroundBehind } from '../lib/backgroundTone.ts';

/** Size of a system logo in a header row: at most 150 × 50 px, at most a quarter of the screen wide (360 px phones). */
export const SYSTEM_LOGO_ROW_SIZE = 'max-h-[min(50px,8.33vw)] max-w-[min(150px,25vw)]';
/** Size of a system logo in its full box (150 × 50 px, the limit of the upload). */
export const SYSTEM_LOGO_FULL_SIZE = 'max-h-[50px] max-w-[150px]';

/**
 * One side of the system logos, in the variant meant for the background really behind it (negative on a dark one,
 * positive on a light one or when it cannot be told; the other variant when that one is missing). Nothing when the
 * side has no logo. Proportions kept (`object-contain`); decorative by default (empty `alt`).
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
  const box = useRef<HTMLSpanElement>(null);
  // The box is rendered only with a logo: read again when the side goes from no logo to a logo.
  const background = useBackgroundBehind(box, hasSystemLogo(pair));
  const picked = pickSystemLogo(pair, background);
  if (!picked) return null;
  const { logo, variant } = picked;
  return (
    <span ref={box} className="inline-flex min-w-0 items-center">
      <img
        src={logo.url}
        alt={alt}
        data-system-logo={side}
        data-system-logo-variant={variant}
        width={logo.width}
        height={logo.height}
        className={`block h-auto w-auto object-contain ${size}`}
      />
    </span>
  );
}
