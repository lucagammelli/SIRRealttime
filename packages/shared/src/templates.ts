import { z } from 'zod';
import type { TemplateDocument } from './templateDefinition.js';
import { parseCustomTheme } from './templateDefinition.js';
import sirVolleyTheme from './themes/sir-volley.json' with { type: 'json' };

export {
  OurTeamColorSchema,
  parseCustomTheme,
  TemplateDefinitionSchema,
  ThemeCssSchema,
} from './templateDefinition.js';
export type { OurTeamColor, TemplateDocument, TemplateDocumentInput, ThemeCss } from './templateDefinition.js';

/**
 * Graphic templates of the portal: closed list. A template is the base look of every page of a client (tokens of
 * apps/web/src/styles/tokens.css under `[data-template]`, fonts, logos of the template, default page blocks); the
 * colours chosen by the client in «Grafica» go over it. `standard` is the look of the portal without a template.
 * The models offered to every client are the built-in ones below; a custom theme of one client (`custom: true`, its
 * definition is a JSON document in `themes/`) is assigned by the superadmin and never listed to the clients.
 */
export const TEMPLATE_IDS = ['standard', 'pulito', 'notte', 'contrasto', 'sir-volley'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const TemplateIdSchema = z.enum(TEMPLATE_IDS);
export const DEFAULT_TEMPLATE: TemplateId = 'standard';

/** A template of the closed list: its document (see `TemplateDefinitionSchema`) with the id narrowed. */
export type TemplateDefinition = Omit<TemplateDocument, 'id'> & { id: TemplateId };

/** Pure: a custom theme document read and checked to be the one of `id`. */
function customTheme(id: TemplateId, document: unknown): TemplateDefinition {
  const theme = parseCustomTheme(document);
  if (theme.id !== id) throw new Error(`tema ${theme.id} al posto di ${id}`);
  return { ...theme, id };
}

export const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  standard: {
    id: 'standard',
    custom: false,
    label: 'Standard',
    description: 'Aspetto predefinito del portale, tema chiaro o scuro a scelta.',
    forcedTheme: null,
    ourColor: 'home',
    colors: { primary: '#1d4ed8', accent: '#c2410c', home: '#1d4ed8', away: '#a21caf', background: '#eef2f7' },
    darkSurface: '#0f1729',
    darkInkSurface: '#0f1729',
    darkBackground: '#070c17',
    fonts: { sans: null },
    images: { navbarLogo: null, navbarLogoAlt: null },
    courtArrows: 'evaluation',
    scoreboard: 'standard',
  },
  pulito: {
    id: 'pulito',
    custom: false,
    label: 'Chiaro e pulito',
    description: 'Sempre chiaro, bianco e verde acqua, schede piatte e sobrie: leggibile anche in sala stampa.',
    forcedTheme: 'light',
    ourColor: 'home',
    colors: { primary: '#0b6b63', accent: '#a04a06', home: '#0b6b63', away: '#6d28d9', background: '#f8fafc' },
    darkSurface: '#0f1729',
    darkInkSurface: '#0f1729',
    darkBackground: '#070c17',
    fonts: { sans: null },
    images: { navbarLogo: null, navbarLogoAlt: null },
    courtArrows: 'evaluation',
    scoreboard: 'standard',
  },
  notte: {
    id: 'notte',
    custom: false,
    label: 'Scuro sportivo',
    description: 'Sempre scuro, grafite con verde e arancio acceso: l’atmosfera di una partita serale.',
    forcedTheme: 'dark',
    ourColor: 'home',
    colors: { primary: '#22c55e', accent: '#f59e0b', home: '#22c55e', away: '#f59e0b', background: '#0a0f0d' },
    darkSurface: '#111a16',
    darkInkSurface: '#1a2620',
    darkBackground: '#0a0f0d',
    fonts: { sans: null },
    images: { navbarLogo: null, navbarLogoAlt: null },
    courtArrows: 'evaluation',
    scoreboard: 'standard',
  },
  contrasto: {
    id: 'contrasto',
    custom: false,
    label: 'Alto contrasto per TV',
    description: 'Sempre scuro, nero con giallo e azzurro: si legge da lontano su un maxischermo.',
    forcedTheme: 'dark',
    ourColor: 'home',
    colors: { primary: '#ffd400', accent: '#00e5ff', home: '#ffd400', away: '#00e5ff', background: '#000000' },
    darkSurface: '#0a0a0a',
    darkInkSurface: '#141414',
    darkBackground: '#000000',
    fonts: { sans: null },
    images: { navbarLogo: null, navbarLogoAlt: null },
    courtArrows: 'evaluation',
    scoreboard: 'standard',
  },
  'sir-volley': customTheme('sir-volley', sirVolleyTheme),
};

/** Pure: the definition of a template (the standard one for an unknown id). */
export function templateOf(id: string | null | undefined): TemplateDefinition {
  const parsed = TemplateIdSchema.safeParse(id);
  return TEMPLATES[parsed.success ? parsed.data : DEFAULT_TEMPLATE];
}

/** Ids offered to every client (guided setup, «Grafica»): the built-in models, never a custom theme. */
/** Pure: true for a custom theme of one client (not offered to the clients). */
export function isCustomTemplate(id: string | null | undefined): boolean {
  const parsed = TemplateIdSchema.safeParse(id);
  return parsed.success && TEMPLATES[parsed.data].custom;
}

export const SELECTABLE_TEMPLATE_IDS: readonly TemplateId[] = TEMPLATE_IDS.filter((id) => !isCustomTemplate(id));

/**
 * Pure: the templates a user can pick in «Grafica». Everybody gets the built-in models; a superadmin also the custom
 * themes, and the client that already has a custom theme keeps seeing it (`current`) so it can stay on it.
 */
export function templateChoices(opts: { current: TemplateId; superadmin: boolean }): readonly TemplateId[] {
  return TEMPLATE_IDS.filter((id) => !isCustomTemplate(id) || opts.superadmin || id === opts.current);
}
