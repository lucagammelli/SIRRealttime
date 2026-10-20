import type { SystemLogo, SystemLogos } from '@sir/shared';
import { useSystemLogos } from '../lib/systemLogos.ts';

/**
 * Box of a system logo: at most 150 × 50 px (the limit of the upload), scaled down with the width of the screen (at
 * most a quarter of it each: no horizontal scroll on a 360 px phone), proportions kept (`object-contain`).
 */
function SystemLogoImage({ logo, side }: { logo: SystemLogo; side: 'sinistra' | 'destra' }) {
  return (
    <img
      src={logo.url}
      alt=""
      data-system-logo={side}
      width={logo.width}
      height={logo.height}
      className="block h-auto max-h-[min(50px,8.33vw)] w-auto max-w-[min(150px,25vw)] object-contain"
    />
  );
}

/**
 * Row of the logos of the platform, one at the left and one at the right of the header (public live page and reserved
 * area). Nothing at all when no logo is loaded; with one only, the other side stays empty. Decorative images (empty
 * `alt`): they carry no information for screen readers.
 */
export function SystemLogosBar({ logos, className = '' }: { logos?: SystemLogos; className?: string }) {
  const current = useSystemLogos();
  const { left, right } = logos ?? current;
  if (!left && !right) return null;
  return (
    <div className={`flex min-w-0 items-center justify-between gap-3 ${className}`} data-testid="loghi-di-sistema">
      {left ? <SystemLogoImage logo={left} side="sinistra" /> : <span />}
      {right ? <SystemLogoImage logo={right} side="destra" /> : <span />}
    </div>
  );
}
