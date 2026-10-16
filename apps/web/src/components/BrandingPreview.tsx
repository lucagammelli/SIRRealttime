import type { BrandColorChoice, TemplateId } from '@sir/shared';
import { brandPalette, resolveBrandColors, templateOf } from '@sir/shared';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { TEMPLATE_LOGO_ALT } from './BrandMark.tsx';
import { useResolvedTheme } from '../lib/theme.ts';

/**
 * Small public page with example data, drawn with the template and the colours being edited: the element has its own
 * tokens (`data-sir-scope` with the `data-template` and the `data-theme` of the draft: tokens.css) and the variables of
 * `brandPalette` (inline style through the CSSOM), so the rest of the reserved area keeps its graphics. Standard
 * template: every colour, the defaults included (the dark variants of the colours left to the default are computed,
 * close to, not the same as, tokens.css); another template: only the colours chosen, over the ones of the template.
 */
export function BrandingPreview({
  colors,
  name,
  logoMain,
  logoMark,
  sponsorLogo,
  template = 'standard',
}: {
  colors: BrandColorChoice;
  name: string;
  logoMain: string | null;
  logoMark: string | null;
  sponsorLogo: string | null;
  template?: TemplateId;
}) {
  const resolved = useResolvedTheme();
  const definition = templateOf(template);
  const theme = definition.forcedTheme ?? resolved;
  const style = useMemo(
    () => brandPalette(template === 'standard' ? resolveBrandColors(colors) : colors, template)[theme] as CSSProperties,
    [colors, theme, template],
  );
  const navbarLogo = definition.images.navbarLogo;
  return (
    <div
      data-testid="anteprima-grafica"
      data-sir-scope=""
      data-template={template}
      data-theme={theme}
      style={style}
      aria-label="Anteprima della pagina pubblica"
      role="figure"
      className={`overflow-hidden rounded-panel border border-border bg-bg font-sans text-text ${
        template === 'standard' ? 'border-t-4 border-t-accent' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        {navbarLogo ? (
          <img src={navbarLogo} alt={TEMPLATE_LOGO_ALT} className="h-7 w-auto max-w-40 object-contain" />
        ) : logoMain ? (
          <img src={logoMain} alt={name} className="h-7 w-auto max-w-40 object-contain" />
        ) : (
          <span className="font-display text-base font-bold uppercase tracking-widest text-primary">{name}</span>
        )}
        <span className="rounded-full border border-badge-live-border bg-badge-live px-2 py-0.5 text-xs font-semibold text-on-badge-live">
          In diretta
        </span>
      </div>
      <div className="mx-3 mb-3 space-y-3 rounded-panel border border-border bg-surface p-3 shadow-card">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-card bg-home px-2 py-2 text-center text-on-home">
            <p className="text-xs font-semibold uppercase">Casa</p>
            <p className="tabular font-display text-3xl font-bold">2</p>
          </div>
          <p className="tabular text-center font-display text-xl font-bold text-text">
            <span className="text-home-ink">18</span>
            <span className="px-1 text-muted">-</span>
            <span className="text-away-ink">15</span>
          </p>
          <div className="rounded-card bg-away px-2 py-2 text-center text-on-away">
            <p className="text-xs font-semibold uppercase">Ospiti</p>
            <p className="tabular font-display text-3xl font-bold">1</p>
          </div>
        </div>
        <div className="space-y-1 text-xs text-muted">
          <p>Attacco</p>
          <div className="flex h-2 overflow-hidden rounded-full bg-surface-2">
            <span className="w-3/5 bg-home" />
            <span className="w-2/5 bg-away" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-card bg-home-soft px-2 py-1 text-home-ink">Break point casa</span>
          <span className="rounded-card bg-away-soft px-2 py-1 text-away-ink">Cambio palla ospiti</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-button bg-primary px-3 py-1.5 text-sm font-medium text-on-primary">Pulsante</span>
          <span className="flex items-center gap-2">
            {sponsorLogo && <img src={sponsorLogo} alt="Sponsor" className="h-6 w-auto max-w-24 object-contain" />}
            {logoMark && <img src={logoMark} alt="Logo quadrato" className="size-6 rounded object-contain" />}
          </span>
        </div>
      </div>
      {definition.images.footerLogo && definition.footerText && (
        <div className="flex justify-end px-3 pb-2">
          <img src={definition.images.footerLogo} alt={definition.footerText} className="h-3 w-auto max-w-full" />
        </div>
      )}
    </div>
  );
}
