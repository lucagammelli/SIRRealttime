import { z } from 'zod';
import type { TemplateId } from './templates.js';
import { templateOf } from './templates.js';

/** Colour as written in a branding document: `#rrggbb`, lower case (upper case input is accepted and lowered). */
export const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;
export const HexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(HEX_COLOR_PATTERN, { message: 'colore non valido (#rrggbb)' });

/** Minimum contrast of text on its background (WCAG 2.x AA, normal text). */
export const MIN_TEXT_CONTRAST = 4.5;

export const TEXT_ON_DARK = '#ffffff';
export const TEXT_ON_LIGHT = '#000000';

type Rgb = [number, number, number];

/** Pure: channels 0-255 of a `#rrggbb` colour (any case); throws on another format. */
export function parseHexColor(hex: string): Rgb {
  const h = hex.trim().toLowerCase();
  if (!HEX_COLOR_PATTERN.test(h)) throw new Error(`colore non valido: ${hex}`);
  return [Number.parseInt(h.slice(1, 3), 16), Number.parseInt(h.slice(3, 5), 16), Number.parseInt(h.slice(5, 7), 16)];
}

const channelHex = (c: number): string =>
  Math.round(Math.min(255, Math.max(0, c)))
    .toString(16)
    .padStart(2, '0');

export function formatHexColor([r, g, b]: Rgb): string {
  return `#${channelHex(r)}${channelHex(g)}${channelHex(b)}`;
}

/** Pure: relative luminance of WCAG 2.x (0 black, 1 white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHexColor(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pure: WCAG contrast ratio of two colours, from 1 (same) to 21 (black on white); symmetric. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Pure: white or black, whichever has the higher contrast on `background` (always at least 4.5:1). */
export function textColorOn(background: string): string {
  return contrastRatio(TEXT_ON_DARK, background) >= contrastRatio(TEXT_ON_LIGHT, background)
    ? TEXT_ON_DARK
    : TEXT_ON_LIGHT;
}

/** Pure: `a` and `b` mixed channel by channel, `weight` of `a` from 0 (only b) to 1 (only a). */
export function mixColors(a: string, b: string, weight: number): string {
  const w = Math.min(1, Math.max(0, weight));
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  return formatHexColor([0, 1, 2].map((i) => (ca[i] ?? 0) * w + (cb[i] ?? 0) * (1 - w)) as Rgb);
}

/**
 * Pure: `color` moved towards white (on a dark background) or black (on a light one), by steps of 5%, until its
 * contrast on `background` is at least `min`; the colour itself when it is already enough.
 */
export function ensureContrast(color: string, background: string, min = MIN_TEXT_CONTRAST): string {
  const target = relativeLuminance(background) < 0.5 ? '#ffffff' : '#000000';
  for (let step = 0; step <= 20; step++) {
    const candidate = mixColors(target, color, step / 20);
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return target;
}

/** Colours a client chooses; a missing one keeps the portal default. */
export const BRAND_COLOR_KEYS = ['primary', 'accent', 'home', 'away', 'background'] as const;
export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];
export type BrandColors = Record<BrandColorKey, string>;
/** Colours chosen by a client: any of them may be missing (or undefined: the same). */
export type BrandColorChoice = { [K in BrandColorKey]?: string | undefined };

/**
 * Defaults of the client colours: the same values as apps/web/src/styles/tokens.css (light theme), which stays the
 * only source of the portal; a test of the portal checks that they match.
 */
export const DEFAULT_BRAND_COLORS: BrandColors = {
  primary: '#1d4ed8',
  accent: '#c2410c',
  home: '#1d4ed8',
  away: '#a21caf',
  background: '#eef2f7',
};

/** Reference surfaces of tokens.css the variants are computed against. */
export const LIGHT_SURFACE = '#ffffff';
export const DARK_BACKGROUND = '#070c17';
export const DARK_SURFACE = '#0f1729';
/** Default body text of the light theme (`--sir-text`): checked against a client background. */
export const LIGHT_TEXT = '#0f172a';

/** Pure: every colour of the client, those of its template (standard: the defaults) in place of the missing ones. */
export function resolveBrandColors(colors: BrandColorChoice, template: TemplateId = 'standard'): BrandColors {
  const all = { ...templateOf(template).colors };
  for (const key of BRAND_COLOR_KEYS) {
    const value = colors[key];
    if (value !== undefined) all[key] = value;
  }
  return all;
}

/** CSS variables of the portal (tokens.css) for the light and the dark theme. */
export interface BrandPalette {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Share of the colour in its soft variant (team backgrounds: `--sir-home-soft`). */
const SOFT_LIGHT = 0.16;
const SOFT_DARK = 0.22;
/** Share of the client background in the dark background (a tint of its hue). */
const DARK_BACKGROUND_TINT = 0.06;

/**
 * Pure: CSS variables for the colours given (only those: the others keep the tokens of the portal and of the
 * template). Light theme: the colour as chosen, its soft variant and the text on it (white or black). Dark theme: the
 * colour lightened until it has 4.5:1 on the dark surface of the template, its soft variant and its text; the team
 * colours also as small text (`-ink`: 4.5:1 on the lightest dark panel of the template, table rows included); the
 * background becomes a dark tint of its hue. The colour of our team (`--sir-our*`: the home colour or the accent,
 * as the template says) and of the opponent (`--sir-opponent*`: the away colour) follow the client too.
 */
export function brandPalette(colors: BrandColorChoice, template: TemplateId = 'standard'): BrandPalette {
  const { darkSurface, darkInkSurface, darkBackground, ourColor } = templateOf(template);
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  /** `team`: also the soft variant and the text variant (`-ink`, team colour as small text). */
  const solid = (name: string, color: string, team: boolean): void => {
    const onDark = ensureContrast(color, darkSurface);
    light[`--sir-${name}`] = color;
    light[`--sir-on-${name}`] = textColorOn(color);
    dark[`--sir-${name}`] = onDark;
    dark[`--sir-on-${name}`] = textColorOn(onDark);
    if (team) {
      light[`--sir-${name}-soft`] = mixColors(color, LIGHT_SURFACE, SOFT_LIGHT);
      dark[`--sir-${name}-soft`] = mixColors(onDark, darkSurface, SOFT_DARK);
      light[`--sir-${name}-ink`] = color;
      dark[`--sir-${name}-ink`] = ensureContrast(onDark, darkInkSurface);
    }
  };
  if (colors.primary) solid('primary', colors.primary, false);
  if (colors.accent) solid('accent', colors.accent, false);
  if (colors.home) solid('home', colors.home, true);
  if (colors.away) solid('away', colors.away, true);
  const ours = colors[ourColor];
  if (ours) solid('our', ours, true);
  if (colors.away) solid('opponent', colors.away, true);
  if (colors.background) {
    light['--sir-bg'] = colors.background;
    dark['--sir-bg'] = mixColors(colors.background, darkBackground, DARK_BACKGROUND_TINT);
  }
  return { light, dark };
}

/** A colour with too little contrast in the light theme (the dark one is corrected by `brandPalette`). */
export interface ContrastIssue {
  /** The colour used as text (`background`: the page text on the client background). */
  color: BrandColorKey | 'text';
  against: 'background';
  ratio: number;
}

/**
 * Pure: colours under 4.5:1 on the background of the client (both resolved with those of its template): the team and brand
 * colours are written as text on it, and the page text (dark in the light theme) must stay readable on it. None for
 * a template that is always dark: there `brandPalette` corrects every colour itself.
 */
export function brandContrastIssues(colors: BrandColorChoice, template: TemplateId = 'standard'): ContrastIssue[] {
  if (templateOf(template).forcedTheme === 'dark') return [];
  const all = resolveBrandColors(colors, template);
  const issues: ContrastIssue[] = [];
  for (const key of ['primary', 'accent', 'home', 'away'] as const) {
    const ratio = contrastRatio(all[key], all.background);
    if (ratio < MIN_TEXT_CONTRAST) issues.push({ color: key, against: 'background', ratio });
  }
  const text = contrastRatio(LIGHT_TEXT, all.background);
  if (text < MIN_TEXT_CONTRAST) issues.push({ color: 'text', against: 'background', ratio: text });
  return issues;
}
