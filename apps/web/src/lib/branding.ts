import type {
  BrandPalette,
  OurTeam,
  PublicTenantResponse,
  TemplateDefinition,
  TemplateId,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@arenalive/shared';
import {
  brandPalette,
  DEFAULT_BRAND_NAME,
  DEFAULT_TEMPLATE,
  defaultIntermissions,
  defaultOverlays,
  ourTeamSide,
  PublicTenantResponseSchema,
  TemplateIdSchema,
  templateOf,
} from '@arenalive/shared';
import type { Side, TeamRef } from '@arenalive/volley-stats';
import { useEffect, useSyncExternalStore } from 'react';
import { teamColorVars } from './teamColors.ts';
import type { ResolvedTheme } from './theme.ts';
import { currentTheme, setForcedTheme, subscribeThemeEvents } from './theme.ts';

/**
 * Graphics of the client of the hostname (`GET /api/public/tenant`), loaded once at start for the public page and the
 * reserved area. Its colours become CSS variables on <html>, over the defaults of styles/tokens.css: Tailwind
 * (`@theme inline`) and the ECharts theme read the variables, so the components do not change.
 */
export interface TenantLook {
  name: string;
  /** Graphic template (base look: tokens of `[data-template]`, fonts, logos, default page). */
  template: TemplateId;
  /** Team of the client in the `.dvw` files: our colour when it is on court. */
  ourTeam: OurTeam;
  images: PublicTenantResponse['images'];
  palette: BrandPalette;
  /** Blocks of the public page chosen by the client, for every device. */
  layout: TenantLayout;
  /** Pauses of the public page (time-out, end of set, end of match). */
  intermissions: TenantIntermissions;
  /** Overlays of the events of the match (ace, set point, ...). */
  overlays: TenantOverlays;
  /** Sponsors chosen by the page or the pauses, with their images. */
  sponsors: PublicTenantResponse['sponsors'];
}

let look: TenantLook | null = null;
/** Load of the graphics: still loading, loaded (`look` set), or failed (the portal defaults). */
export type TenantLookStatus = 'loading' | 'loaded' | 'failed';
let status: TenantLookStatus = 'loading';
/** Pauses used when the graphics cannot be loaded: the defaults of the shared contract. */
const DEFAULT_INTERMISSIONS: TenantIntermissions = defaultIntermissions();
/** Overlays used when the graphics cannot be loaded: the defaults of the shared contract. */
const DEFAULT_OVERLAYS: TenantOverlays = defaultOverlays();
/** Bumped at every change of the variables: the charts read the palette again. */
let revision = 0;
const listeners = new Set<() => void>();
let written: string[] = [];
let unsubscribeTheme: (() => void) | null = null;
/** Side of the team of the client in the match on screen (null: none, or no match). */
let ourSide: Side | null = null;

/** Template applied at start (the one of the last visit), used until the graphics of the client arrive. */
let startTemplate: TemplateId = DEFAULT_TEMPLATE;

/** Key of localStorage with the template of the last visit: applied before the first render (no flash). */
const TEMPLATE_STORAGE_KEY = 'sir-template';

/**
 * Writes the variables of `palette` for `theme` on `root` (inline style, set through the CSSOM: allowed by the CSP
 * without 'unsafe-inline'), then `extra` over them (colours of our team), and removes the ones written before that are
 * no longer there.
 */
export function writePalette(
  palette: BrandPalette | null,
  theme: ResolvedTheme,
  root: HTMLElement = document.documentElement,
  previous: readonly string[] = [],
  extra: Record<string, string> = {},
): string[] {
  const vars = { ...(palette ? palette[theme] : {}), ...extra };
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
  written = writePalette(
    look?.palette ?? null,
    currentTheme(),
    document.documentElement,
    written,
    teamColorVars(ourSide),
  );
  revision += 1;
  for (const listener of listeners) listener();
}

/**
 * Applies a graphic template on <html>: `data-template` (none for the standard one) and the theme it imposes. It is
 * remembered for the next visit (applied by `initTemplate` before the graphics arrive).
 */
export function applyTemplate(id: TemplateId): void {
  const root = document.documentElement;
  if (id === DEFAULT_TEMPLATE) root.removeAttribute('data-template');
  else root.setAttribute('data-template', id);
  setForcedTheme(templateOf(id).forcedTheme);
  try {
    if (id === DEFAULT_TEMPLATE) window.localStorage.removeItem(TEMPLATE_STORAGE_KEY);
    else window.localStorage.setItem(TEMPLATE_STORAGE_KEY, id);
  } catch {
    // Private mode: nothing remembered.
  }
}

/** Applies the template of the last visit before the first render (the graphics of the client confirm it later). */
export function initTemplate(): void {
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const parsed = TemplateIdSchema.safeParse(stored);
  startTemplate = parsed.success ? parsed.data : DEFAULT_TEMPLATE;
  if (parsed.success) applyTemplate(parsed.data);
}

/**
 * Applies the graphics of a client and follows the light/dark switch. Null: back to the defaults, as before any load
 * (status `loading`).
 */
export function setTenantLook(next: TenantLook | null): void {
  look = next;
  status = next ? 'loaded' : 'loading';
  setFavicon(next?.images.logoMark ?? null);
  unsubscribeTheme ??= subscribeThemeEvents(refresh);
  applyTemplate(next?.template ?? DEFAULT_TEMPLATE);
  refresh();
}

/** Sides claimed by the match views on screen (the last one wins: a preview inside a page, ...). */
const claims: { side: Side | null }[] = [];

function updateOurSide(): void {
  const side = claims.at(-1)?.side ?? null;
  if (ourSide === side) return;
  ourSide = side;
  refresh();
}

/**
 * Side of the team of the client in the match on screen, claimed by the match view until the returned function is
 * called: the colours of the two sides follow our team and the opponent (null: home and away colours).
 */
export function claimOurSide(side: Side | null): () => void {
  const claim = { side };
  claims.push(claim);
  updateOurSide();
  return () => {
    const index = claims.indexOf(claim);
    if (index >= 0) claims.splice(index, 1);
    updateOurSide();
  };
}

/** Side of our team now (null: none on screen). */
export function currentOurSide(): Side | null {
  return ourSide;
}

/** Reactive side of our team: the component redraws when a match view claims or releases it. */
export function useOurSide(): Side | null {
  return useSyncExternalStore(
    subscribe,
    () => ourSide,
    () => null,
  );
}

/**
 * Side of the team of the client in a match (`ourTeamSide` of @arenalive/shared with the team chosen in «Grafica»), claimed
 * while the component is mounted: every view of the page follows the colours of our team.
 */
export function useOurTeamColors(teams: Record<Side, TeamRef>): Side | null {
  const ourTeam = useTenantLook()?.ourTeam ?? null;
  const side = ourTeamSide(teams, ourTeam);
  useEffect(() => claimOurSide(side), [side]);
  return side;
}

/** Graphics of a client from the public answer. */
export function tenantLookOf(tenant: PublicTenantResponse): TenantLook {
  return {
    name: tenant.name,
    template: tenant.branding.template,
    ourTeam: tenant.branding.ourTeam,
    images: tenant.images,
    palette: brandPalette(tenant.branding.colors, tenant.branding.template),
    layout: tenant.layout,
    intermissions: tenant.intermissions,
    overlays: tenant.overlays,
    sponsors: tenant.sponsors,
  };
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

/**
 * Loads and applies the graphics of the client (at start, and again after a save). A failure keeps graphics already
 * loaded; without them the status becomes `failed` (the portal defaults, pauses included).
 */
export async function initBranding(options: LoadOptions = {}): Promise<void> {
  const loaded = await loadTenantLook(options);
  if (loaded) setTenantLook(loaded);
  else if (status !== 'loaded') {
    status = 'failed';
    for (const listener of listeners) listener();
  }
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

/** Status of the load of the graphics of the client. */
export function useTenantLookStatus(): TenantLookStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => 'loading',
  );
}

/**
 * Pauses of the public page: the ones of the client once its graphics are loaded, the defaults when the load failed,
 * none (null) while it is still loading.
 */
export function useTenantIntermissions(): TenantIntermissions | null {
  const current = useTenantLook();
  const state = useTenantLookStatus();
  if (current) return current.intermissions;
  return state === 'failed' ? DEFAULT_INTERMISSIONS : null;
}

/**
 * Overlays of the events of the match: the ones of the client once its graphics are loaded, the defaults when the
 * load failed, none (null) while it is still loading.
 */
export function useTenantOverlays(): TenantOverlays | null {
  const current = useTenantLook();
  const state = useTenantLookStatus();
  if (current) return current.overlays;
  return state === 'failed' ? DEFAULT_OVERLAYS : null;
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

/** Graphic template in use (the standard one until the graphics of the client arrive). */
export function useTemplate(): TemplateDefinition {
  return templateOf(useTenantLook()?.template ?? startTemplate);
}
