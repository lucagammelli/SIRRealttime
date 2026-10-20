import type { SystemLogos } from '@sir/shared';
import { hasSystemLogo } from '@sir/shared';
import { useSystemLogos } from '../lib/systemLogos.ts';
import { SystemLogo } from './SystemLogo.tsx';

/**
 * Row of the logos of the platform, one at the left and one at the right of the header of the public live page, each
 * in the variant meant for the background behind it. Nothing at all when no logo is loaded; with one side only, the
 * other stays empty. Decorative images (empty `alt`): they carry no information for screen readers.
 */
export function SystemLogosBar({ logos, className = '' }: { logos?: SystemLogos; className?: string }) {
  const current = useSystemLogos();
  const { left, right } = logos ?? current;
  if (!hasSystemLogo(left) && !hasSystemLogo(right)) return null;
  return (
    <div className={`flex min-w-0 items-center justify-between gap-3 ${className}`} data-testid="loghi-di-sistema">
      {hasSystemLogo(left) ? <SystemLogo pair={left} side="sinistra" /> : <span />}
      {hasSystemLogo(right) ? <SystemLogo pair={right} side="destra" /> : <span />}
    </div>
  );
}
