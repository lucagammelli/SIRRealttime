import type {
  Intermission,
  IntermissionKind,
  IntermissionSlide,
  MilestoneIntermission,
  SetBreakSet,
  SlideType,
  TenantIntermissions,
} from '@sir/shared';
import {
  defaultIntermission,
  INTERMISSION_MAX_SLIDES,
  IntermissionSlideSchema,
  SET_BREAK_SETS,
  TenantIntermissionsSchema,
} from '@sir/shared';

/**
 * Pure editing of the pauses (editor «Pause»): every function returns a new value. A pause is addressed by
 * its kind, or `setBreak-N` for the own end-of-set pause of the set N.
 */
export type PauseTarget = IntermissionKind | `setBreak-${SetBreakSet}`;

/** Set of a per-set target, null for the generic pauses. */
export function targetSet(target: PauseTarget): SetBreakSet | null {
  const match = /^setBreak-([1-4])$/.exec(target);
  const set = match?.[1];
  return set && (SET_BREAK_SETS as readonly string[]).includes(set) ? (set as SetBreakSet) : null;
}

/** Pause at `target`; undefined for a set without its own pause (it uses the generic one). */
export function pauseAt(config: TenantIntermissions, target: PauseTarget): Intermission | undefined {
  const set = targetSet(target);
  if (set) return config.setBreakBySet[set];
  return config[target as IntermissionKind];
}

/** Replaces the pause at `target` (the «ogni N punti» keeps its rule unless `pause` has one). */
export function withPause(config: TenantIntermissions, target: PauseTarget, pause: Intermission): TenantIntermissions {
  const set = targetSet(target);
  if (set) return { ...config, setBreakBySet: { ...config.setBreakBySet, [set]: pause } };
  if (target === 'milestone') return { ...config, milestone: { ...config.milestone, ...pause } };
  return { ...config, [target as IntermissionKind]: pause };
}

/** Changes the rule of the «ogni N punti»: every how many points, not in the last K points of the set. */
export function withMilestoneRule(
  config: TenantIntermissions,
  rule: Partial<Pick<MilestoneIntermission, 'every' | 'stopBeforeEnd'>>,
): TenantIntermissions {
  return { ...config, milestone: { ...config.milestone, ...rule } };
}

/** Gives the set its own pause (a copy of the generic end of set) or takes it away (back to the generic one). */
export function setOwnPause(config: TenantIntermissions, set: SetBreakSet, own: boolean): TenantIntermissions {
  const bySet = { ...config.setBreakBySet };
  if (own) bySet[set] = structuredClone(config.setBreak);
  else delete bySet[set];
  return { ...config, setBreakBySet: bySet };
}

/** Back to the default pause (for a set with its own pause: the default end of set). */
export function resetPause(config: TenantIntermissions, target: PauseTarget): TenantIntermissions {
  const kind: IntermissionKind = targetSet(target) ? 'setBreak' : (target as IntermissionKind);
  return withPause(config, target, defaultIntermission(kind));
}

/** First free id `<type>-<n>` among the slides. */
export function freeSlideId(slides: readonly IntermissionSlide[], type: SlideType): string {
  const used = new Set(slides.map((s) => s.id));
  if (!used.has(type)) return type;
  for (let n = 2; ; n++) if (!used.has(`${type}-${n}`)) return `${type}-${n}`;
}

export const canAddSlide = (pause: Intermission): boolean => pause.slides.length < INTERMISSION_MAX_SLIDES;

/** Adds a slide of `type` at the end, with the default options and duration. */
export function addSlide(pause: Intermission, type: SlideType): Intermission {
  if (!canAddSlide(pause)) return pause;
  const slide = IntermissionSlideSchema.parse({ id: freeSlideId(pause.slides, type), type });
  return { ...pause, slides: [...pause.slides, slide] };
}

/** Moves the slide at `from` to the position `to` (clamped to the list). */
export function moveSlide(pause: Intermission, from: number, to: number): Intermission {
  const slides = [...pause.slides];
  const target = Math.max(0, Math.min(slides.length - 1, to));
  const [moved] = slides.splice(from, 1);
  if (!moved || from === target) return pause;
  slides.splice(target, 0, moved);
  return { ...pause, slides };
}

export function removeSlide(pause: Intermission, id: string): Intermission {
  return { ...pause, slides: pause.slides.filter((s) => s.id !== id) };
}

/** Changes the slide with `id` (its type stays the same). */
export function updateSlide(
  pause: Intermission,
  id: string,
  change: (slide: IntermissionSlide) => IntermissionSlide,
): Intermission {
  return { ...pause, slides: pause.slides.map((s) => (s.id === id ? change(s) : s)) };
}

/** Targets with a problem (empty text, active pause without slides, ...); empty when the document can be saved. */
export function pauseProblems(config: TenantIntermissions): Set<PauseTarget> {
  const parsed = TenantIntermissionsSchema.safeParse(config);
  const out = new Set<PauseTarget>();
  if (parsed.success) return out;
  for (const issue of parsed.error.issues) {
    const [first, second] = issue.path;
    if (first === 'setBreakBySet' && typeof second === 'string') {
      const set = targetSet(`setBreak-${second}` as PauseTarget);
      if (set) out.add(`setBreak-${set}`);
    } else if (first === 'timeout' || first === 'setBreak' || first === 'matchEnd' || first === 'milestone')
      out.add(first);
  }
  return out;
}
