import type { MatchEventKind } from '@sir/volley-stats';
import { MATCH_EVENT_KINDS, MATCH_EVENT_PRIORITY } from '@sir/volley-stats';
import { z } from 'zod';
import { TENANT_CONFIG_VERSION } from './configVersion.js';
import type { LayoutDevice } from './layout.js';
import { plainText } from './strings.js';

/**
 * Overlays of the public page chosen by a client (jsonb `tenants.overlays`): short messages shown over the page for a
 * few seconds when an event of the match happens (`MatchState.events`, detected by `@sir/volley-stats` from the scout
 * lines only). For every kind of event: on/off, a plain text with controlled placeholders (never HTML), how many
 * seconds it stays, the devices that show it and its priority (the higher one is shown first).
 */

/** Kinds of event that can have an overlay: the events of `@sir/volley-stats`. */
export const OVERLAY_KINDS = MATCH_EVENT_KINDS;
export type OverlayKind = MatchEventKind;

/**
 * Placeholders of an overlay text, closed list (anything else between braces is refused):
 * `{giocatore}` name of the player, `{numero}` shirt number, `{squadra}` team of the event, `{punteggio}` score of the
 * set (home-away), `{set}` number of the set, `{serie}` points in a row (run), `{attacchi}` attacks of a long rally.
 * A placeholder without a value for the event (no player, no run) becomes empty.
 */
export const OVERLAY_PLACEHOLDERS = [
  'giocatore',
  'numero',
  'squadra',
  'punteggio',
  'set',
  'serie',
  'attacchi',
] as const;
export type OverlayPlaceholder = (typeof OVERLAY_PLACEHOLDERS)[number];

/** Seconds an overlay stays on screen: limits and default. */
export const OVERLAY_MIN_SECONDS = 2;
export const OVERLAY_MAX_SECONDS = 8;
export const OVERLAY_DEFAULT_SECONDS = 4;
/** Priority of an overlay: 1 (least important) to 10. */
export const OVERLAY_MIN_PRIORITY = 1;
export const OVERLAY_MAX_PRIORITY = 10;
/** Longest overlay text (placeholders included). */
export const OVERLAY_TEXT_MAX = 80;

const PLACEHOLDER = /\{([^{}]*)\}/g;

/**
 * Pure: the problem of an overlay text, null when it is fine. Refused: a placeholder not in OVERLAY_PLACEHOLDERS, a
 * brace outside a placeholder, the characters `<` and `>` (no HTML, not even as text).
 */
export function overlayTextProblem(text: string): string | null {
  if (/[<>]/.test(text)) return 'i caratteri < e > non sono ammessi';
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    if (!(OVERLAY_PLACEHOLDERS as readonly string[]).includes(name)) return `segnaposto sconosciuto: {${name}}`;
  }
  if (/[{}]/.test(text.replace(PLACEHOLDER, ''))) return 'parentesi graffa senza segnaposto';
  return null;
}

/** Text of an overlay: single line plain text with only the placeholders of the list. */
export const OverlayTextSchema = plainText(OVERLAY_TEXT_MAX).superRefine((text, ctx) => {
  const problem = overlayTextProblem(text);
  if (problem) ctx.addIssue({ code: 'custom', message: problem });
});

/**
 * Pure: `template` with every placeholder replaced by its value (missing value: empty), spaces collapsed and trimmed.
 * The result is plain text: the portal shows it as text, never as HTML.
 */
export function fillOverlayText(template: string, values: Partial<Record<OverlayPlaceholder, string>>): string {
  return template
    .replace(PLACEHOLDER, (_, name: string) =>
      Object.hasOwn(values, name) ? (values[name as OverlayPlaceholder] ?? '') : '',
    )
    .replace(/\s+/g, ' ')
    .replace(/\s+([!?.,:;])/g, '$1')
    .trim();
}

interface OverlayDefaults {
  enabled: boolean;
  text: string;
  devices: Record<LayoutDevice, boolean>;
}

const ALL: Record<LayoutDevice, boolean> = { tv: true, tablet: true, phone: true };
const LARGE: Record<LayoutDevice, boolean> = { tv: true, tablet: true, phone: false };

/**
 * Defaults: every event on, on every device, for OVERLAY_DEFAULT_SECONDS, with the priority of `@sir/volley-stats`;
 * substitutions and long rallies not on the phone; the time-out off (the time-out pause already says it).
 */
const DEFAULTS: Record<OverlayKind, OverlayDefaults> = {
  ace: { enabled: true, text: 'ACE! {giocatore}', devices: ALL },
  block: { enabled: true, text: 'Muro di {giocatore}', devices: ALL },
  run: { enabled: true, text: 'Break di {serie} punti per {squadra}', devices: ALL },
  longRally: { enabled: true, text: 'Scambio lungo: {attacchi} attacchi', devices: LARGE },
  setPoint: { enabled: true, text: 'SET POINT {squadra}', devices: ALL },
  matchPoint: { enabled: true, text: 'MATCH POINT {squadra}', devices: ALL },
  tie: { enabled: true, text: 'Pareggio {punteggio}', devices: ALL },
  lead: { enabled: true, text: 'Sorpasso {squadra} {punteggio}', devices: ALL },
  timeout: { enabled: false, text: 'Time-out {squadra}', devices: ALL },
  substitution: { enabled: true, text: 'Cambio {squadra}: entra {giocatore}', devices: LARGE },
  setEnd: { enabled: true, text: '{squadra} vince il {set}° set {punteggio}', devices: ALL },
  matchEnd: { enabled: true, text: '{squadra} vince la partita!', devices: ALL },
};

/** Default text of the overlay of `kind`. */
export const defaultOverlayText = (kind: OverlayKind): string => DEFAULTS[kind].text;

/** Schema of the overlay of `kind`: every missing field takes the default of that kind. */
const overlaySchema = (kind: OverlayKind) => {
  const d = DEFAULTS[kind];
  return z.strictObject({
    enabled: z.boolean().default(d.enabled),
    text: OverlayTextSchema.default(d.text),
    seconds: z.int().min(OVERLAY_MIN_SECONDS).max(OVERLAY_MAX_SECONDS).default(OVERLAY_DEFAULT_SECONDS),
    devices: z
      .strictObject({
        tv: z.boolean().default(d.devices.tv),
        tablet: z.boolean().default(d.devices.tablet),
        phone: z.boolean().default(d.devices.phone),
      })
      .prefault({}),
    priority: z.int().min(OVERLAY_MIN_PRIORITY).max(OVERLAY_MAX_PRIORITY).default(MATCH_EVENT_PRIORITY[kind]),
  });
};
export type Overlay = z.output<ReturnType<typeof overlaySchema>>;
export type OverlayInput = z.input<ReturnType<typeof overlaySchema>>;

const overlayShape = Object.fromEntries(OVERLAY_KINDS.map((kind) => [kind, overlaySchema(kind).prefault({})])) as {
  [K in OverlayKind]: z.ZodPrefault<ReturnType<typeof overlaySchema>>;
};

/** Overlays document of a client: `{}` (the database default) reads as the defaults of every event. */
export const TenantOverlaysSchema = z.strictObject({
  version: z.literal(TENANT_CONFIG_VERSION).default(TENANT_CONFIG_VERSION),
  ...overlayShape,
});
export type TenantOverlays = z.output<typeof TenantOverlaysSchema>;
export type TenantOverlaysInput = z.input<typeof TenantOverlaysSchema>;

/** Pure: the default overlays. */
export function defaultOverlays(): TenantOverlays {
  return TenantOverlaysSchema.parse({});
}

/** Pure: the default overlay of `kind` (a new object at every call). */
export function defaultOverlay(kind: OverlayKind): Overlay {
  return overlaySchema(kind).parse({});
}

/** Pure: a stored overlays document with the missing fields filled; an invalid one reads as the defaults. */
export function resolveOverlays(document: unknown): TenantOverlays {
  const parsed = TenantOverlaysSchema.safeParse(document ?? {});
  return parsed.success ? parsed.data : defaultOverlays();
}

/** `GET/PUT /api/admin/overlays`: the overlays of the client of the session (the body of PUT is the document). */
export const OverlaysResponseSchema = z.object({ tenantName: z.string(), overlays: TenantOverlaysSchema });
export type OverlaysResponse = z.infer<typeof OverlaysResponseSchema>;
