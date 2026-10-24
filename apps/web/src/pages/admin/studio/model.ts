import type {
  BrandColorKey,
  BrandingImageSlot,
  Intermission,
  IntermissionFullscreenSize,
  IntermissionKind,
  IntermissionMode,
  IntermissionSlide,
  IntermissionSlideInput,
  LayoutBlock,
  LayoutDevice,
  OurTeam,
  Overlay,
  OverlayBackground,
  OverlayKind,
  OverlayPlaceholder,
  OverlayPosition,
  OverlaySize,
  Player,
  PublicPlayerMedia,
  SetBreakSet,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@arenalive/shared';
import {
  BRAND_COLOR_KEYS,
  defaultBranding,
  defaultIntermission,
  defaultIntermissions,
  defaultLayout,
  defaultOverlay,
  defaultOverlays,
  IntermissionSlideSchema,
  LAYOUT_DEVICES,
  newBlock,
  OVERLAY_KINDS,
  backgroundForTeam,
  playerBackground,
  SET_BREAK_SETS,
  TEMPLATES,
  THANKS_MESSAGE,
} from '@arenalive/shared';
import type { MatchEvent, MatchState, Side } from '@arenalive/volley-stats';
import { sampleEvent } from '../../../lib/overlay.ts';
import { COMEBACK_MIN_POINTS, LONG_RALLY_MIN_ATTACKS, RUN_MIN_POINTS } from '@arenalive/volley-stats';
import { BLOCKS } from '../../../blocks/registry.tsx';
import type { PauseTarget } from '../intermissionEditor.ts';
import { pauseAt } from '../intermissionEditor.ts';

/**
 * «Studio grafico» (pure, no DOM): sections, scenes of the preview, what changed in a section, ready-made models of
 * the pauses and of the overlays, the texts «Compare: …» and the marks that find an element in the preview.
 */

export type StudioSection = 'colori' | 'pagina' | 'pause' | 'avvisi' | 'esporta';

export const STUDIO_SECTIONS: readonly { id: StudioSection; label: string; short: string; description: string }[] = [
  { id: 'colori', label: 'Colori e loghi', short: 'Colori', description: 'Aspetto di tutta la pagina' },
  { id: 'pagina', label: 'Pagina live', short: 'Pagina', description: 'Blocchi di TV, tablet e telefono' },
  { id: 'pause', label: 'Pause', short: 'Pause', description: 'Fine set, time-out, sponsor' },
  { id: 'avvisi', label: 'Avvisi', short: 'Avvisi', description: 'Ace, muro, set point' },
  {
    id: 'esporta',
    label: 'Esporta / Importa',
    short: 'Esporta',
    description: 'Salva o carica tutta la grafica',
  },
];

export const SECTION_LABELS: Record<StudioSection, string> = {
  colori: 'Colori e loghi',
  pagina: 'Pagina live',
  pause: 'Pause',
  avvisi: 'Avvisi',
  esporta: 'Esporta / Importa',
};

export const isStudioSection = (value: string | undefined): value is StudioSection =>
  value === 'colori' || value === 'pagina' || value === 'pause' || value === 'avvisi' || value === 'esporta';

/** Old pages of the reserved area and the section of the Studio that took their place (redirects). */
export const LEGACY_PAGES: Record<'grafica' | 'pagina' | 'pause' | 'avvisi', StudioSection> = {
  grafica: 'colori',
  pagina: 'pagina',
  pause: 'pause',
  avvisi: 'avvisi',
};

export const studioPath = (section: StudioSection): string => `/admin/studio/${section}`;

/** Moments of the match the preview can show. */
export type StudioScene = 'play' | 'setBreak' | 'timeout' | 'milestone' | 'matchEnd' | 'afterMatch' | 'overlay';

export const SCENES: readonly { id: StudioScene; label: string }[] = [
  { id: 'play', label: 'In gioco' },
  { id: 'setBreak', label: 'Fine set' },
  { id: 'timeout', label: 'Time-out' },
  { id: 'milestone', label: 'Ogni N punti' },
  { id: 'matchEnd', label: 'Fine partita' },
  { id: 'afterMatch', label: 'Dopo la partita' },
  { id: 'overlay', label: 'Avviso' },
];

export const SCENE_LABELS: Record<StudioScene, string> = Object.fromEntries(
  SCENES.map((s) => [s.id, s.label]),
) as Record<StudioScene, string>;

/** Pause shown by a scene (null: in play or an overlay). */
export function pauseKindOf(scene: StudioScene): IntermissionKind | null {
  return scene === 'play' || scene === 'overlay' || scene === 'afterMatch' ? null : scene;
}

/**
 * Scene the preview takes by itself when a section (or a pause, or an overlay) is opened: the colours and the page
 * in play, a pause on its own moment, the overlays on the one being edited. The user can always pick another one.
 */
export function autoScene(section: StudioSection, pauseKind: IntermissionKind): StudioScene {
  if (section === 'pause') return pauseKind;
  if (section === 'avvisi') return 'overlay';
  return 'play';
}

export const DEVICE_LABELS: Record<LayoutDevice, string> = { tv: 'TV', tablet: 'Tablet', phone: 'Telefono' };
const DEVICE_WORDS: Record<LayoutDevice, string> = { tv: 'TV', tablet: 'tablet', phone: 'telefono' };

/** Pure: Italian list «a, b e c». */
export function listText(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1) ?? ''}`;
}

/** Pure: the devices as words («TV, tablet e telefono»). */
export const devicesText = (devices: readonly LayoutDevice[]): string => listText(devices.map((d) => DEVICE_WORDS[d]));

export const ALL_DEVICES_TEXT = devicesText(LAYOUT_DEVICES);

// ---------------------------------------------------------------- labels shared by the sections

export const COLOR_LABELS: Record<BrandColorKey, { label: string; hint: string }> = {
  primary: { label: 'Colore principale', hint: 'Pulsanti e nome nella testata.' },
  accent: { label: 'Colore di risalto', hint: 'Barra in alto e indicatori.' },
  home: { label: 'Squadra di casa', hint: 'Tabellone, grafici e statistiche della squadra di casa.' },
  away: { label: 'Squadra ospite', hint: 'Tabellone, grafici e statistiche della squadra ospite.' },
  background: { label: 'Sfondo della pagina', hint: 'Nel tema scuro diventa una tinta scura dello stesso colore.' },
};

export const IMAGE_LABELS: Record<BrandingImageSlot, { label: string; hint: string }> = {
  logoMain: { label: 'Logo orizzontale', hint: 'Nella testata della pagina pubblica e dell’area riservata.' },
  logoMark: { label: 'Logo quadrato', hint: 'Icona della scheda del browser e spazi piccoli.' },
  sponsorLogo: { label: 'Logo dello sponsor', hint: 'Facoltativo.' },
};

export const KIND_LABELS: Record<IntermissionKind, string> = {
  timeout: 'Time-out',
  setBreak: 'Fine set',
  matchEnd: 'Fine partita',
  milestone: 'Ogni N punti',
};
export const PAUSE_KINDS: readonly IntermissionKind[] = ['timeout', 'setBreak', 'matchEnd', 'milestone'];
export const MODE_LABELS: Record<IntermissionMode, string> = { fullscreen: 'Tutto schermo', banner: 'Banda in basso' };

/** Names of the sizes of the slides on full screen, in the order of the menu. */
export const FULLSCREEN_SIZE_LABELS: Record<IntermissionFullscreenSize, string> = {
  normal: 'Normale',
  large: 'Grande',
  fill: 'Riempi lo schermo',
};

export const OVERLAY_LABELS: Record<OverlayKind, { label: string; hint: string }> = {
  matchEnd: { label: 'Fine partita', hint: 'Alla fine dell’ultimo set, prima della pausa di fine partita.' },
  matchPoint: { label: 'Match point', hint: 'Come il set point, per la squadra che ha già vinto 2 set.' },
  setEnd: { label: 'Fine set', hint: 'Alla fine di ogni set (non l’ultimo), prima della pausa di fine set.' },
  setPoint: {
    label: 'Set point',
    hint: 'Quando una squadra arriva a un punto dal set, anche ai vantaggi e al tie-break; non si ripete finché resta in vantaggio.',
  },
  ace: { label: 'Ace', hint: 'Punto diretto in battuta.' },
  block: { label: 'Muro punto', hint: 'Punto diretto a muro.' },
  lead: {
    label: 'Sorpasso',
    hint: `La squadra che era dietro passa avanti: dal 15-15 (9-9 al tie-break) o dopo una rimonta di ${COMEBACK_MIN_POINTS} punti.`,
  },
  tie: {
    label: 'Pareggio',
    hint: `Dal 15-15 (9-9 al tie-break) o dopo una rimonta di ${COMEBACK_MIN_POINTS} punti.`,
  },
  run: { label: 'Break', hint: `Dal ${RUN_MIN_POINTS}° punto di fila della stessa squadra, a ogni punto in più.` },
  timeout: { label: 'Time-out', hint: 'Alla chiamata del time-out (la pausa del time-out lo mostra già).' },
  longRally: { label: 'Scambio lungo', hint: `Scambio con almeno ${LONG_RALLY_MIN_ATTACKS} attacchi.` },
  substitution: { label: 'Cambio', hint: 'Sostituzione: {giocatore} e {numero} sono di chi entra.' },
};

export const PLACEHOLDER_LABELS: Record<OverlayPlaceholder, string> = {
  giocatore: 'nome del giocatore',
  numero: 'numero di maglia',
  squadra: 'squadra dell’evento',
  punteggio: 'punteggio del set',
  set: 'numero del set',
  serie: 'punti di fila (break)',
  attacchi: 'attacchi dello scambio',
};

export const POSITION_LABELS: Record<OverlayPosition, string> = {
  top: 'In alto',
  center: 'Al centro',
  bottom: 'In basso',
};
export const SIZE_LABELS: Record<OverlaySize, string> = { small: 'Piccolo', medium: 'Medio', large: 'Grande' };

// ---------------------------------------------------------------- comparisons

/** Pure: JSON with the keys of every object in order, to compare two documents whatever the order of their keys. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, sort(x)]),
      );
    return v;
  };
  return JSON.stringify(sort(value)) ?? 'undefined';
}

export const sameValue = (a: unknown, b: unknown): boolean => stableJson(a) === stableJson(b);

/** Pure: whether a block has options of its own (not the defaults of its type): removing it loses them. */
export const blockHasSettings = (block: LayoutBlock): boolean =>
  !sameValue(block.options, newBlock(block.type, block.id).options);

/** Pure: whether a slide has options of its own (not the defaults of its type): removing it loses them. */
export const slideHasSettings = (slide: IntermissionSlide): boolean =>
  !sameValue(slide.options, IntermissionSlideSchema.parse({ id: slide.id, type: slide.type }).options);

/** The documents of the four sections, as saved or as being edited. */
export interface StudioDocs {
  branding: TenantBranding;
  layout: TenantLayout;
  intermissions: TenantIntermissions;
  overlays: TenantOverlays;
}

/**
 * Pure: true when the client has never saved anything in the Studio (every document is the default one; the page
 * follows the default of its template): the guided setup opens by itself.
 */
export function isFirstAccess(saved: StudioDocs): boolean {
  return (
    sameValue(saved.branding, defaultBranding()) &&
    sameValue(saved.layout, defaultLayout(saved.branding.template)) &&
    sameValue(saved.intermissions, defaultIntermissions()) &&
    sameValue(saved.overlays, defaultOverlays())
  );
}

/** One change of a section, for the list «Vedi modifiche». */
export interface StudioChange {
  label: string;
  detail: string;
}

const onOff = (on: boolean): string => (on ? 'attivo' : 'spento');
const textOrDefault = (text: string | null | undefined, empty: string): string =>
  text === null || text === undefined || text === '' ? empty : text;

/** Pure: what changed in «Colori e loghi». */
export function brandingChanges(base: TenantBranding, draft: TenantBranding): StudioChange[] {
  const out: StudioChange[] = [];
  if (base.template !== draft.template)
    out.push({
      label: 'Modello grafico',
      detail: `${TEMPLATES[base.template].label} → ${TEMPLATES[draft.template].label}`,
    });
  if (base.displayName !== draft.displayName)
    out.push({
      label: 'Nome visualizzato',
      detail: `${textOrDefault(base.displayName, 'nome del cliente')} → ${textOrDefault(draft.displayName, 'nome del cliente')}`,
    });
  for (const key of BRAND_COLOR_KEYS)
    if (base.colors[key] !== draft.colors[key])
      out.push({
        label: COLOR_LABELS[key].label,
        detail: `${base.colors[key] ?? 'modello'} → ${draft.colors[key] ?? 'modello'}`,
      });
  if (base.ourTeam.code !== draft.ourTeam.code)
    out.push({
      label: 'Nostra squadra: codice',
      detail: `${textOrDefault(base.ourTeam.code, 'nessuno')} → ${textOrDefault(draft.ourTeam.code, 'nessuno')}`,
    });
  if (base.ourTeam.name !== draft.ourTeam.name)
    out.push({
      label: 'Nostra squadra: nome',
      detail: `${textOrDefault(base.ourTeam.name, 'nessuno')} → ${textOrDefault(draft.ourTeam.name, 'nessuno')}`,
    });
  for (const slot of ['logoMain', 'logoMark', 'sponsorLogo'] as const)
    if (base[slot] !== draft[slot])
      out.push({
        label: IMAGE_LABELS[slot].label,
        detail: draft[slot] === null ? 'tolto' : base[slot] === null ? 'aggiunto' : 'cambiato',
      });
  return out;
}

const blockName = (block: LayoutBlock): string => BLOCKS[block.type].label;

/** Pure: what changed in «Pagina live», device by device. */
export function layoutChanges(base: TenantLayout, draft: TenantLayout): StudioChange[] {
  const out: StudioChange[] = [];
  for (const device of LAYOUT_DEVICES) {
    const label = DEVICE_LABELS[device];
    const before = new Map(base[device].map((b) => [b.id, b]));
    const after = new Map(draft[device].map((b) => [b.id, b]));
    for (const block of draft[device]) {
      const old = before.get(block.id);
      if (!old) {
        out.push({ label, detail: `aggiunto «${blockName(block)}»` });
        continue;
      }
      const what: string[] = [];
      if (old.visible !== block.visible) what.push(block.visible ? 'visibile' : 'nascosto');
      if (old.width !== block.width) what.push(`larghezza ${old.width}/12 → ${block.width}/12`);
      if (old.collapsed !== block.collapsed) what.push(block.collapsed ? 'chiuso all’apertura' : 'aperto all’apertura');
      if (!sameValue(old.options, block.options)) what.push('opzioni');
      if (what.length > 0) out.push({ label, detail: `«${blockName(block)}»: ${what.join(', ')}` });
    }
    for (const block of base[device])
      if (!after.has(block.id)) out.push({ label, detail: `tolto «${blockName(block)}»` });
    const kept = (list: readonly LayoutBlock[], other: Map<string, LayoutBlock>) =>
      list.filter((b) => other.has(b.id)).map((b) => b.id);
    if (kept(base[device], after).join(',') !== kept(draft[device], before).join(','))
      out.push({ label, detail: 'ordine dei blocchi' });
  }
  return out;
}

/** Every pause of the document: the generic ones and the own end of set of every set. */
export const PAUSE_TARGETS: readonly PauseTarget[] = [
  'setBreak',
  ...SET_BREAK_SETS.map((s) => `setBreak-${s}` as const),
  'timeout',
  'matchEnd',
  'milestone',
];

/** Pure: name of a pause («Fine set, 3° set»). */
export function pauseTargetLabel(target: PauseTarget): string {
  const set = /^setBreak-(\d)$/.exec(target)?.[1];
  return set ? `${KIND_LABELS.setBreak}, ${set}° set` : KIND_LABELS[target as IntermissionKind];
}

/** Pure: what changed in «Pause», pause by pause. */
export function intermissionChanges(base: TenantIntermissions, draft: TenantIntermissions): StudioChange[] {
  const out: StudioChange[] = [];
  for (const target of PAUSE_TARGETS) {
    const label = pauseTargetLabel(target);
    const old = pauseAt(base, target);
    const now = pauseAt(draft, target);
    if (!old && !now) continue;
    if (!old) {
      out.push({ label, detail: 'pausa propria' });
      continue;
    }
    if (!now) {
      out.push({ label, detail: 'usa la pausa di tutti i set' });
      continue;
    }
    if (old.enabled !== now.enabled) out.push({ label, detail: now.enabled ? 'attivata' : 'disattivata' });
    for (const device of LAYOUT_DEVICES)
      if (old.modes[device] !== now.modes[device])
        out.push({
          label,
          detail: `${DEVICE_LABELS[device]}: ${MODE_LABELS[old.modes[device]]} → ${MODE_LABELS[now.modes[device]]}`,
        });
    if (old.delaySeconds !== now.delaySeconds)
      out.push({ label, detail: `ritardo ${old.delaySeconds} s → ${now.delaySeconds} s` });
    if (!sameValue(old.slides, now.slides)) out.push({ label, detail: 'diapositive' });
  }
  if (base.milestone.every !== draft.milestone.every)
    out.push({ label: KIND_LABELS.milestone, detail: `ogni ${base.milestone.every} → ${draft.milestone.every} punti` });
  if (base.milestone.stopBeforeEnd !== draft.milestone.stopBeforeEnd)
    out.push({
      label: KIND_LABELS.milestone,
      detail: `non negli ultimi ${base.milestone.stopBeforeEnd} → ${draft.milestone.stopBeforeEnd} punti`,
    });
  return out;
}

/** Pure: what changed in «Avvisi». */
export function overlayChanges(base: TenantOverlays, draft: TenantOverlays): StudioChange[] {
  const out: StudioChange[] = [];
  if (base.position !== draft.position)
    out.push({
      label: 'Posizione di tutti gli avvisi',
      detail: `${POSITION_LABELS[base.position]} → ${POSITION_LABELS[draft.position]}`,
    });
  if (base.size !== draft.size)
    out.push({
      label: 'Dimensione di tutti gli avvisi',
      detail: `${SIZE_LABELS[base.size]} → ${SIZE_LABELS[draft.size]}`,
    });
  for (const kind of OVERLAY_KINDS) {
    const old: Overlay = base[kind];
    const now: Overlay = draft[kind];
    const what: string[] = [];
    if (old.enabled !== now.enabled) what.push(onOff(now.enabled));
    if (old.text !== now.text) what.push(`testo «${now.text}»`);
    if (old.seconds !== now.seconds) what.push(`${old.seconds} s → ${now.seconds} s`);
    if (old.priority !== now.priority) what.push(`priorità ${old.priority} → ${now.priority}`);
    if (!sameValue(old.devices, now.devices)) what.push('dispositivi');
    if (old.position !== now.position) what.push('posizione');
    if (old.size !== now.size) what.push('dimensione');
    if (what.length > 0) out.push({ label: OVERLAY_LABELS[kind].label, detail: what.join(', ') });
  }
  return out;
}

// ---------------------------------------------------------------- ready-made models

export type StudioModel = 'essenziale' | 'completo' | 'sponsor';
export const STUDIO_MODELS: readonly StudioModel[] = ['essenziale', 'completo', 'sponsor'];

export const PAUSE_MODEL_LABELS: Record<StudioModel, { label: string; hint: string }> = {
  essenziale: { label: 'Essenziale', hint: 'poche cose, sobrio' },
  completo: { label: 'Completo', hint: 'tutte le informazioni' },
  sponsor: { label: 'Sponsor in evidenza', hint: 'sponsor grande' },
};
export const OVERLAY_MODEL_LABELS: Record<StudioModel, { label: string; hint: string }> = {
  essenziale: { label: 'Essenziale', hint: 'solo i momenti chiave' },
  completo: { label: 'Completo', hint: 'tutti gli eventi' },
  sponsor: { label: 'Sponsor in evidenza', hint: 'piccoli e brevi' },
};

type SlideSpec = IntermissionSlideInput;

/** Images of the first sponsor slide of the pauses that has some: a model keeps them on its sponsor slides. */
function sponsorImages(config: TenantIntermissions): string[] {
  for (const target of PAUSE_TARGETS)
    for (const slide of pauseAt(config, target)?.slides ?? [])
      if (slide.type === 'sponsor' && slide.options.images.length > 0) return slide.options.images;
  return [];
}

function pauseOf(
  kind: IntermissionKind,
  slides: readonly SlideSpec[] | null,
  images: readonly string[],
  change: Partial<Pick<Intermission, 'enabled' | 'modes' | 'delaySeconds'>> = {},
): Intermission {
  const base = defaultIntermission(kind);
  const list = (slides ?? base.slides).map((s) => {
    const slide = IntermissionSlideSchema.parse(s);
    return slide.type === 'sponsor' ? { ...slide, options: { ...slide.options, images: [...images] } } : slide;
  });
  return { ...base, ...change, slides: list };
}

const SPONSOR_FIRST = { tv: 'fullscreen', tablet: 'fullscreen', phone: 'banner' } as const;

/**
 * Pure: the pauses of a ready-made model. «Essenziale»: few slides, no «ogni N punti»; «Completo»: the defaults;
 * «Sponsor in evidenza»: the sponsors on their own slides, big, also every N points. On the phone the end of set stays a
 * banner at the bottom, as by default. The sponsor images, the rule of the «ogni N punti» and «Dopo la partita» of
 * `config` are kept; the own pauses of the sets are taken away.
 */
export function applyPauseModel(config: TenantIntermissions, model: StudioModel): TenantIntermissions {
  const images = sponsorImages(config);
  const rule = { every: config.milestone.every, stopBeforeEnd: config.milestone.stopBeforeEnd };
  const thanks: SlideSpec = {
    id: 'thanks',
    type: 'message',
    seconds: 8,
    options: { text: THANKS_MESSAGE, size: 'large' },
  };
  // «Dopo la partita» is not part of the models: it stays as it is.
  const defaults = { ...defaultIntermissions(), afterMatch: config.afterMatch };
  const milestoneDefault = defaults.milestone;
  if (model === 'completo') {
    return {
      ...defaults,
      timeout: pauseOf('timeout', null, images),
      setBreak: pauseOf('setBreak', null, images),
      matchEnd: pauseOf('matchEnd', null, images),
      milestone: { ...milestoneDefault, ...pauseOf('milestone', null, images), ...rule },
    };
  }
  if (model === 'essenziale') {
    return {
      ...defaults,
      timeout: pauseOf('timeout', null, images),
      setBreak: pauseOf(
        'setBreak',
        [
          { id: 'setSummary', type: 'setSummary', seconds: 12 },
          { id: 'sponsor', type: 'sponsor', seconds: 8 },
        ],
        images,
      ),
      matchEnd: pauseOf(
        'matchEnd',
        [{ id: 'finalResult', type: 'finalResult', seconds: 10 }, { id: 'mvp', type: 'mvp', seconds: 10 }, thanks],
        images,
      ),
      milestone: { ...milestoneDefault, ...pauseOf('milestone', null, images, { enabled: false }), ...rule },
    };
  }
  return {
    ...defaults,
    timeout: pauseOf('timeout', [{ id: 'sponsor', type: 'sponsor', seconds: 10 }], images, { modes: SPONSOR_FIRST }),
    setBreak: pauseOf(
      'setBreak',
      [
        { id: 'sponsor', type: 'sponsor', seconds: 12 },
        { id: 'setSummary', type: 'setSummary', seconds: 10 },
        { id: 'setScorers', type: 'setScorers', seconds: 8 },
      ],
      images,
    ),
    matchEnd: pauseOf(
      'matchEnd',
      [
        { id: 'finalResult', type: 'finalResult', seconds: 10 },
        { id: 'sponsor', type: 'sponsor', seconds: 12 },
        { id: 'mvp', type: 'mvp', seconds: 10 },
        thanks,
      ],
      images,
    ),
    milestone: {
      ...milestoneDefault,
      ...pauseOf('milestone', [{ id: 'sponsor', type: 'sponsor', seconds: 8 }], images),
      ...rule,
    },
  };
}

/** Pure: the model the pauses are now (null: «Personalizzato», something was changed). */
export function activePauseModel(config: TenantIntermissions): StudioModel | null {
  return STUDIO_MODELS.find((m) => sameValue(applyPauseModel(config, m), config)) ?? null;
}

const OVERLAY_MODEL_KINDS: Record<Exclude<StudioModel, 'completo'>, readonly OverlayKind[]> = {
  essenziale: ['matchEnd', 'matchPoint', 'setEnd', 'setPoint'],
  sponsor: ['matchEnd', 'matchPoint', 'setEnd', 'setPoint', 'ace', 'block'],
};

/**
 * Pure: the overlays of a ready-made model. «Completo»: every event as by default; «Essenziale»: only the end and the
 * points of set and match; «Sponsor in evidenza»: also ace and block, small and short, so the page and its sponsors
 * stay in view. The texts, the devices, the priorities and the own position and size of every overlay are kept.
 */
export function applyOverlayModel(config: TenantOverlays, model: StudioModel): TenantOverlays {
  const next: TenantOverlays = { ...config };
  const set = <K extends OverlayKind>(kind: K, enabled: boolean, seconds: number): void => {
    next[kind] = { ...config[kind], enabled, seconds };
  };
  for (const kind of OVERLAY_KINDS) {
    if (model === 'completo') set(kind, defaultOverlay(kind).enabled, defaultOverlay(kind).seconds);
    else set(kind, OVERLAY_MODEL_KINDS[model].includes(kind), model === 'sponsor' ? 3 : 4);
  }
  next.position = 'top';
  next.size = model === 'sponsor' ? 'small' : 'medium';
  return next;
}

/** Pure: the model the overlays are now (null: «Personalizzato»). */
export function activeOverlayModel(config: TenantOverlays): StudioModel | null {
  return STUDIO_MODELS.find((m) => sameValue(applyOverlayModel(config, m), config)) ?? null;
}

// ---------------------------------------------------------------- «Compare: …»

/** Pure: where and how a pause appears («a tutto schermo su TV e tablet, banda in basso sul telefono»). */
export function pauseWhere(pause: Intermission | undefined, kind: IntermissionKind): string {
  if (!pause) return `come «Tutti i set», a fine set`;
  if (!pause.enabled) return 'spenta, non compare';
  const by = (mode: IntermissionMode) => LAYOUT_DEVICES.filter((d) => pause.modes[d] === mode);
  const parts = [
    by('fullscreen').length > 0 ? `a tutto schermo su ${devicesText(by('fullscreen'))}` : '',
    by('banner').length > 0 ? `banda in basso su ${devicesText(by('banner'))}` : '',
  ].filter(Boolean);
  const when: Record<IntermissionKind, string> = {
    timeout: 'durante il time-out',
    setBreak: 'a fine set',
    matchEnd: 'a fine partita',
    milestone: 'ogni N punti del set',
  };
  return `${parts.join(', ')}, ${when[kind]}`;
}

/** Pure: where an overlay appears («TV e tablet, in alto, medio»). */
export function overlayWhere(config: TenantOverlays, overlay: Overlay): string {
  if (!overlay.enabled) return 'spento, non compare';
  const devices = LAYOUT_DEVICES.filter((d) => overlay.devices[d]);
  if (devices.length === 0) return 'nessun dispositivo';
  const position = overlay.position ?? config.position;
  const size = overlay.size ?? config.size;
  return `${devicesText(devices)}, ${POSITION_LABELS[position].toLowerCase()}, ${SIZE_LABELS[size].toLowerCase()}, sopra la partita`;
}

/** Pure: where a block appears («TV, in gioco» or «TV, nascosto»). */
export function blockWhere(device: LayoutDevice, block: LayoutBlock): string {
  return `${DEVICE_LABELS[device]}, ${block.visible ? 'in gioco' : 'nascosto'}`;
}

// ---------------------------------------------------------------- marks of the preview

/**
 * What an element of the preview is: the page, a block (`block:<id>`, or every block of a type: `type:<type>`), the
 * pause on screen, one of its slides
 * (`slide:<id>`) or an overlay. The public components carry inert marks for it (`data-studio-block`,
 * `data-studio-slide`, `data-intermission`, `data-overlay`).
 */
export type StudioTarget = 'page' | 'pause' | 'overlay' | `block:${string}` | `type:${string}` | `slide:${string}`;

const cssValue = (value: string): string => value.replace(/["\\]/g, '\\$&');

/** Pure: CSS selector of the elements of a target in the preview. */
export function targetSelector(target: StudioTarget): string {
  if (target === 'page') return '[data-studio-page]';
  if (target === 'pause') return '[data-intermission]';
  if (target === 'overlay') return '[data-overlay]';
  if (target.startsWith('block:')) return `[data-studio-block="${cssValue(target.slice(6))}"]`;
  if (target.startsWith('type:')) return `[data-studio-type="${cssValue(target.slice(5))}"]`;
  // A player duel «a rotazione» is a slide for every role: `<id>:<role>`.
  const id = cssValue(target.slice(6));
  return `[data-studio-slide="${id}"], [data-studio-slide^="${id}:"]`;
}

/** Selector of every element of the preview that can be picked. */
export const PICKABLE =
  '[data-studio-page], [data-studio-block], [data-intermission], [data-studio-slide], [data-overlay]';

/** Pure: the target of a marked element (from its attributes). */
export function targetOf(attrs: {
  block?: string | undefined;
  slide?: string | undefined;
  intermission?: boolean;
  overlay?: boolean;
}): StudioTarget {
  if (attrs.overlay) return 'overlay';
  if (attrs.slide !== undefined) return `slide:${attrs.slide.split(':')[0] ?? attrs.slide}`;
  if (attrs.intermission) return 'pause';
  if (attrs.block !== undefined) return `block:${attrs.block}`;
  return 'page';
}

export interface PickBox {
  target: StudioTarget;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Pure: the smallest marked box under the point (the most precise element clicked); null when none. */
export function pickAt(boxes: readonly PickBox[], x: number, y: number): StudioTarget | null {
  let best: PickBox | null = null;
  for (const box of boxes) {
    if (box.width <= 0 || box.height <= 0) continue;
    if (x < box.left || y < box.top || x > box.left + box.width || y > box.top + box.height) continue;
    if (!best || box.width * box.height < best.width * best.height) best = box;
  }
  return best?.target ?? null;
}

/**
 * Pure: the example match of the preview with the team of the client as the home team (its name and code), so the
 * colours of «nostra squadra» show in the preview as in a real match. Nothing to do without a team of the client.
 */
export function sampleWithOurTeam(state: MatchState, ourTeam: OurTeam, fallbackName: string): MatchState {
  if (!ourTeam.code && !ourTeam.name) return state;
  const home = { ...state.teams.home, name: ourTeam.name ?? fallbackName, code: ourTeam.code ?? state.teams.home.code };
  return { ...state, teams: { ...state.teams, home } };
}

export type { PauseTarget, SetBreakSet };

/** A player of the roster with a photo or video, to show in the preview of the overlays of a player. */
export interface RosterSample {
  player: { number: number; firstName: string; lastName: string };
  media: PublicPlayerMedia;
}

/** Pure: the first player of the roster (not removed) with a photo or a video; null when none. */
export function rosterSample(players: readonly Player[]): RosterSample | null {
  const p = players.find((x) => !x.removed && (x.photo !== null || x.media.length > 0));
  if (!p) return null;
  return {
    player: { number: p.number, firstName: p.firstName, lastName: p.lastName },
    media: {
      number: p.number,
      photo: p.photo?.assetId ?? null,
      images: p.media.filter((m) => !m.video).map((m) => m.assetId),
      videos: p.media.filter((m) => m.video).map((m) => m.assetId),
    },
  };
}

/**
 * Pure: the example event of an overlay for the preview and its background. For the overlays of a player with the photo
 * or video of the player chosen, the event is of the player of `sample` (a different one for every `key`, so that «Casuale»
 * varies) and the background is its file (a video not on the phone), else the fixed background of the overlay.
 */
export function overlayPreview(
  kind: OverlayKind,
  overlay: Overlay,
  state: MatchState,
  side: Side,
  sample: RosterSample | null,
  key: number,
  device: LayoutDevice,
): { event: MatchEvent; background: OverlayBackground | undefined; player?: { showText: boolean } } {
  const base = sampleEvent(kind, state, side);
  // The fixed background only for our team (the event of the preview is always of `side`, our team).
  const fixed = backgroundForTeam(overlay.background, base.team, side);
  if (!sample || !overlay.playerMedia) return { event: base, background: fixed };
  const event: MatchEvent = { ...base, id: `${base.id}-${key}`, player: sample.player };
  const background = playerBackground(overlay, event, side, [sample.media], { videos: device !== 'phone' });
  return background
    ? { event, background, player: { showText: overlay.playerMedia.showText } }
    : { event, background: fixed };
}
