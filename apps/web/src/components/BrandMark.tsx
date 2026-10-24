import { DEFAULT_BRAND_NAME } from '@arenalive/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTemplate, useTenantLook } from '../lib/branding.ts';
import { clubLogoClass, useOurLogoSize } from '../lib/clubLogo.ts';
import { ProductLogo } from './ProductLogo.tsx';

/**
 * Brand in the header: the logo of the template (e.g. the navbar of a custom theme: no other logo next to it), otherwise the
 * horizontal logo of the client (an <img>, SVG included: never inline markup), otherwise its name, otherwise the
 * logo of ArenaLive (variant for the background behind it). `to`: link to the dashboard (reserved area; the public page has no link).
 * `clubSize`: the horizontal logo of the client follows «Dimensione del logo del club» (public page).
 */
export function BrandMark({
  className = '',
  to,
  clubSize = false,
}: {
  className?: string;
  to?: string;
  clubSize?: boolean;
}) {
  const look = useTenantLook();
  const template = useTemplate();
  const ourLogoSize = useOurLogoSize();
  let mark: ReactNode;
  if (template.images.navbarLogo) {
    mark = (
      <img
        src={template.images.navbarLogo}
        alt={template.images.navbarLogoAlt ?? look?.name ?? ''}
        className={`sir-navbar-logo h-8 w-auto max-w-none object-contain ${className}`}
      />
    );
  } else if (look?.images.logoMain) {
    mark = (
      <img
        src={look.images.logoMain}
        alt={look.name}
        className={`${clubLogoClass('header', clubSize ? ourLogoSize : 'medium', true)} w-auto object-contain ${className}`}
      />
    );
  } else if (look && look.name !== DEFAULT_BRAND_NAME) {
    mark = (
      <p className={`font-display text-lg font-bold uppercase tracking-widest text-primary ${className}`}>
        {look.name}
      </p>
    );
  } else {
    mark = <ProductLogo />;
  }
  if (!to) return mark;
  return (
    <Link to={to} className="inline-flex min-h-11 shrink-0 items-center" title="Partita live">
      {mark}
    </Link>
  );
}
