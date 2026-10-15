import type { BrandPalette, PublicTenantResponse } from '@sir/shared';
import { brandPalette, DEFAULT_BRAND_NAME, PublicTenantResponseSchema } from '@sir/shared';
import { useSyncExternalStore } from 'react';
import type { ResolvedTheme } from './theme.ts';
import { currentTheme, subscribeThemeEvents } from './theme.ts';

/**
 * Graphics of the client of the hostname (`GET /api/public/tenant`), loaded once at start for the public page and the
 * reserved area. Its colours become CSS variables on <html>, over the defaults of styles/tokens.css: Tailwind
 * (`@theme inline`) and the ECharts theme read the variables, so the components do not change.
 */
export interface TenantLook {
  name: string;
  images: PublicTenantResponse['images'];
  palette: BrandPalette;
}

let look: TenantLook | null = null;
/** Bumped at every change of the variables: the charts read the palette again. */
let revision = 0;
const listeners = new Set<() => void>();
let written: string[] = [];
let unsubscribeTheme: (() => void) | null = null;

/**
 * Writes the variables of `palette` for `theme` on `root` (inline style, set through the CSSOM: allowed by the CSP
 * without 'unsafe-inline') and removes the ones written before that are no longer there.
 */
export function writePalette(
  palette: BrandPalette | null,
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
  previous: readonly string[] = [],
): string[] {
  const vars = palette ? palette[theme] : {};
  for (const name of previous) if (!(name in vars)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  return Object.keys(vars);
}

function setFavicon(href: string | null): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')) {
    // The default icon of index.html is remembered on the element, to go back to it.
    if (link.dataset.sirHref === undefined) {
      link.dataset.sirHref = link.getAttribute('href') ?? '';
      link.dataset.sirType = link.getAttribute('type') ?? '';
    }
    const type = href ? '' : (link.dataset.sirType ?? '');
    link.setAttribute('href', href ?? link.dataset.sirHref);
    // The type of a client image is not known here: the browser reads it from the response.
    if (type) link.setAttribute('type', type);
    else link.removeAttribute('type');
  }
}

function refresh(): void {
  written = writePalette(look?.palette ?? null, currentTheme(), document.documentElement, written);
  revision += 1;
  for (const listener of listeners) listener();
}

/** Applies the graphics of a client (null: back to the defaults) and follows the light/dark switch. */
export function setTenantLook(next: TenantLook | null): void {
  look = next;
  setFavicon(next?.images.logoMark ?? null);
  unsubscribeTheme ??= subscribeThemeEvents(refresh);
  refresh();
}

/** Graphics of a client from the public answer. */
export function tenantLookOf(tenant: PublicTenantResponse): TenantLook {
  return { name: tenant.name, images: tenant.images, palette: brandPalette(tenant.branding.colors) };
}

/** Options of a load: `fresh` skips the HTTP cache (after a save in the reserved area). */
export interface LoadOptions {
  fetch?: typeof fetch;
  fresh?: boolean;
}

/**
 * Loads the graphics of the client of the hostname. Any failure (no client, network down, invalid answer) leaves the
 * portal defaults: the page works the same.
 */
export async function loadTenantLook(options: LoadOptions = {}): Promise<TenantLook | null> {
  try {
    const res = await (options.fetch ?? fetch)('/api/public/tenant', {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      ...(options.fresh ? { cache: 'no-cache' as const } : {}),
    });
    if (!res.ok) return null;
    const parsed = PublicTenantResponseSchema.safeParse(await res.json());
    return parsed.success ? tenantLookOf(parsed.data) : null;
  } catch {
    return null;
  }
}

/** Loads and applies the graphics of the client (at start, and again after a save). */
export async function initBranding(options: LoadOptions = {}): Promise<void> {
  const loaded = await loadTenantLook(options);
  if (loaded) setTenantLook(loaded);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Graphics of the client in use (null: the defaults). */
export function useTenantLook(): TenantLook | null {
  return useSyncExternalStore(
    subscribe,
    () => look,
    () => null,
  );
}

/** Changes at every new set of variables (graphics or theme): key for re-reading the palette of the charts. */
export function useBrandingRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  );
}

/** Name of the client for titles and texts. */
export function useBrandName(): string {
  return useTenantLook()?.name ?? DEFAULT_BRAND_NAME;
}
