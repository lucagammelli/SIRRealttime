import { z } from 'zod';

/**
 * Graphic templates of the portal: closed list. A template is the base look of every page of a client (tokens of
 * apps/web/src/styles/tokens.css under `[data-template]`, fonts, logos of the template, default page blocks); the
 * colours chosen by the client in «Grafica» go over it. `standard` is the look of the portal without a template.
 */
export const TEMPLATE_IDS = ['standard', 'sir-volley'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];
export const TemplateIdSchema = z.enum(TEMPLATE_IDS);
export const DEFAULT_TEMPLATE: TemplateId = 'standard';

/** Colour of the client that the team of the client («nostra squadra») takes when it is on court. */
export type OurTeamColor = 'home' | 'accent';

export interface TemplateDefinition {
  id: TemplateId;
  /** Name in the selector of «Grafica». */
  label: string;
  /** One line under the name. */
  description: string;
  /** Theme imposed by the template (no light/dark switch); null: the choice of the viewer. */
  forcedTheme: 'dark' | null;
  /** Colour of our team: the colour of the home team (standard) or the accent of the client. */
  ourColor: OurTeamColor;
  /**
   * Colours of the template where the client has chosen none (the same values as tokens.css, checked by a test of the
   * portal): shown by the colour fields of «Grafica».
   */
  colors: { primary: string; accent: string; home: string; away: string; background: string };
  /** Surface and background of the dark theme in tokens.css (the dark variants of the client colours use them). */
  darkSurface: string;
  /** Lightest dark panel with coloured small text on it (table header and rows): the `-ink` colours have 4.5:1 on it. */
  darkInkSurface: string;
  darkBackground: string;
  /** Images of the template (files of apps/web/public), null: none. */
  images: { navbarLogo: string | null; footerLogo: string | null };
  /** Text of the footer image (alternative text, and the text shown in its place). */
  footerText: string | null;
  /**
   * Arrows of the court maps: `evaluation` coloured by the evaluation and as thick as their share; `team` thin (1.5 px),
   * in the colour of the attacking team, 85% opaque, with a small head.
   */
  courtArrows: 'evaluation' | 'team';
}

export const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    description: 'Aspetto predefinito del portale, tema chiaro o scuro a scelta.',
    forcedTheme: null,
    ourColor: 'home',
    colors: { primary: '#1d4ed8', accent: '#c2410c', home: '#1d4ed8', away: '#a21caf', background: '#eef2f7' },
    darkSurface: '#0f1729',
    darkInkSurface: '#0f1729',
    darkBackground: '#070c17',
    images: { navbarLogo: null, footerLogo: null },
    footerText: null,
    courtArrows: 'evaluation',
  },
  'sir-volley': {
    id: 'sir-volley',
    label: 'SIR VOLLEY',
    description: 'Tema scuro, rosso e bianco, font Google Sans Code, logo SIR Real Time e «Powered by Istante®».',
    forcedTheme: 'dark',
    ourColor: 'accent',
    colors: { primary: '#e30613', accent: '#e30613', home: '#e30613', away: '#ffffff', background: '#0b0b0d' },
    darkSurface: '#151518',
    darkInkSurface: '#202024',
    darkBackground: '#0b0b0d',
    images: {
      navbarLogo: '/templates/sir-volley/logo-sir-realtime.png',
      footerLogo: '/templates/sir-volley/powered-by-istante.png',
    },
    footerText: 'Powered by Istante®',
    courtArrows: 'team',
  },
};

/** Pure: the definition of a template (the standard one for an unknown id). */
export function templateOf(id: string | null | undefined): TemplateDefinition {
  const parsed = TemplateIdSchema.safeParse(id);
  return TEMPLATES[parsed.success ? parsed.data : DEFAULT_TEMPLATE];
}
