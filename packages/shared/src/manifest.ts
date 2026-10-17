import type { BrandColorChoice } from './colors.js';
import { resolveBrandColors } from './colors.js';
import type { TemplateId } from './templates.js';
import { DEFAULT_BRAND_NAME } from './tenant.js';

/**
 * Manifest of the installable app (PWA) of a client, served by `GET /api/public/manifest.webmanifest` for the client
 * of the hostname: its name, its colours and, as icon, its square logo. No `start_url` and no `id`: the browser
 * reopens the link from which the app is installed (a match or the channel of the club).
 */

export interface WebManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: 'any' | 'maskable';
}

export interface WebManifest {
  name: string;
  short_name: string;
  description: string;
  lang: 'it';
  scope: '/';
  display: 'fullscreen';
  display_override: ['fullscreen', 'standalone'];
  orientation: 'any';
  background_color: string;
  theme_color: string;
  icons: WebManifestIcon[];
}

/** Icons of the portal (apps/web/public/icons), used when the client has no square logo. */
export const DEFAULT_MANIFEST_ICONS: readonly WebManifestIcon[] = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

/** Longest `short_name` (the launchers cut it about there). */
export const MANIFEST_SHORT_NAME_MAX = 12;

/**
 * Pure: the manifest of a client, with its colours over those of its template. `logo`: its square logo (public path, type and size of the image); an SVG has
 * `sizes: any`. The portal icons stay after it (a launcher that wants a PNG of 192 or 512 px finds one).
 */
export function webManifest(input: {
  name: string;
  colors: BrandColorChoice;
  /** Template of the client: its colours where the client has chosen none (missing: standard). */
  template?: TemplateId;
  logo: { url: string; mime: string; width: number; height: number } | null;
}): WebManifest {
  const colors = resolveBrandColors(input.colors, input.template);
  const name = input.name.trim() || DEFAULT_BRAND_NAME;
  const icons: WebManifestIcon[] = input.logo
    ? [
        {
          src: input.logo.url,
          sizes: input.logo.mime === 'image/svg+xml' ? 'any' : `${input.logo.width}x${input.logo.height}`,
          type: input.logo.mime,
          purpose: 'any',
        },
      ]
    : [];
  return {
    name,
    short_name: name.length > MANIFEST_SHORT_NAME_MAX ? name.slice(0, MANIFEST_SHORT_NAME_MAX).trim() : name,
    description: 'Punteggio e statistiche della partita in diretta.',
    lang: 'it',
    scope: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: colors.background,
    theme_color: colors.primary,
    icons: [...icons, ...DEFAULT_MANIFEST_ICONS],
  };
}
