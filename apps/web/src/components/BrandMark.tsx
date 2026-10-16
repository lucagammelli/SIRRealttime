import { DEFAULT_BRAND_NAME } from '@sir/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTemplate, useTenantLook } from '../lib/branding.ts';

/** Alternative text of the logo of the platform in the template «SIR VOLLEY». */
export const TEMPLATE_LOGO_ALT = 'SIR Real Time';

/**
 * Brand in the header: the logo of the template (navbar of «SIR VOLLEY»: no other logo next to it), otherwise the
 * horizontal logo of the client (an <img>, SVG included: never inline markup), otherwise its name, otherwise the
 * SIRREALTIME wordmark. `to`: link to the dashboard (reserved area; the public page has no link).
 */
export function BrandMark({ className = '', to }: { className?: string; to?: string }) {
  const look = useTenantLook();
  const template = useTemplate();
  let mark: ReactNode;
  if (template.images.navbarLogo) {
    mark = (
      <img
        src={template.images.navbarLogo}
        alt={TEMPLATE_LOGO_ALT}
        className={`sir-navbar-logo h-8 w-auto max-w-none object-contain ${className}`}
      />
    );
  } else if (look?.images.logoMain) {
    mark = (
      <img src={look.images.logoMain} alt={look.name} className={`h-8 w-auto max-w-48 object-contain ${className}`} />
    );
  } else if (look && look.name !== DEFAULT_BRAND_NAME) {
    mark = (
      <p className={`font-display text-lg font-bold uppercase tracking-widest text-primary ${className}`}>
        {look.name}
      </p>
    );
  } else {
    mark = (
      <p className={`font-display text-lg font-bold uppercase tracking-widest text-muted ${className}`}>
        SIR<span className="text-primary">Realtime</span>
      </p>
    );
  }
  if (!to) return mark;
  return (
    <Link to={to} className="inline-flex min-h-11 shrink-0 items-center" title="Partita live">
      {mark}
    </Link>
  );
}
