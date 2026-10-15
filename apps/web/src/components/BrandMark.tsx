import { DEFAULT_BRAND_NAME } from '@sir/shared';
import { useTenantLook } from '../lib/branding.ts';

/**
 * Brand in the header: the horizontal logo of the client (an <img>, SVG included: never inline markup), otherwise its
 * name, otherwise the SIRREALTIME wordmark.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  const look = useTenantLook();
  if (look?.images.logoMain) {
    return (
      <img src={look.images.logoMain} alt={look.name} className={`h-8 w-auto max-w-48 object-contain ${className}`} />
    );
  }
  if (look && look.name !== DEFAULT_BRAND_NAME) {
    return (
      <p className={`font-display text-lg font-bold uppercase tracking-widest text-primary ${className}`}>
        {look.name}
      </p>
    );
  }
  return (
    <p className={`font-display text-lg font-bold uppercase tracking-widest text-muted ${className}`}>
      SIR<span className="text-primary">Realtime</span>
    </p>
  );
}
