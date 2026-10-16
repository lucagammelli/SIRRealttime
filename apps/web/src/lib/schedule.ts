import type { BlockType, ScheduleFixture, ScheduleResponse, TenantIntermissions } from '@sir/shared';
import { allIntermissions, ScheduleResponseSchema } from '@sir/shared';
import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Matches and standings of the club for the blocks «Prossima partita» and «Classifica» (and their slides):
 * `GET /api/public/tenant/schedule`, read again every minute while a block or a slide that uses it is on the page, and
 * at the end of every set (the match that just started or ended changes «Prossima partita»). Public data of the
 * league, the same for every viewer: one copy for the whole page.
 */
export const SCHEDULE_PATH = '/api/public/tenant/schedule';
export const SCHEDULE_REFRESH_MS = 60_000;

/** Types of block and slide that read the schedule. */
export const SCHEDULE_TYPES: readonly string[] = ['nextMatch', 'standings'] satisfies BlockType[];
export const isScheduleType = (type: string): boolean => SCHEDULE_TYPES.includes(type);

/** Pure: the match «Prossima partita» shows: the first of the club that is not being played now. */
export function nextFixture(schedule: ScheduleResponse | null | undefined): ScheduleFixture | null {
  return schedule?.fixtures.find((f) => !f.live && f.startsAt !== null) ?? null;
}

/** Pure: whether a block or slide of `type` has something to show (otherwise it is left out: no club, no data). */
export function hasScheduleData(type: string, schedule: ScheduleResponse | null | undefined): boolean {
  if (type === 'nextMatch') return nextFixture(schedule) !== null;
  if (type === 'standings') return (schedule?.standings?.rows.length ?? 0) > 0;
  return true;
}

/** Pure: whether some pause of the client has a slide that reads the schedule. */
export function intermissionsUseSchedule(config: TenantIntermissions | null): boolean {
  return config ? allIntermissions(config).some((p) => p.slides.some((s) => isScheduleType(s.type))) : false;
}

/** Reads the schedule; null on any failure (the blocks stay hidden, the page works the same). */
export async function loadSchedule(
  options: { fetch?: typeof fetch; fresh?: boolean; signal?: AbortSignal } = {},
): Promise<ScheduleResponse | null> {
  try {
    const res = await (options.fetch ?? fetch)(SCHEDULE_PATH, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      ...(options.fresh ? { cache: 'no-cache' as const } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!res.ok) return null;
    const parsed = ScheduleResponseSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let current: ScheduleResponse | null = null;
let inFlight: Promise<void> | null = null;
let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function refresh(fresh: boolean): Promise<void> {
  if (!inFlight) {
    inFlight = loadSchedule({ fresh }).then((loaded) => {
      inFlight = null;
      // A failed read keeps what is on screen.
      if (loaded && JSON.stringify(loaded) !== JSON.stringify(current)) {
        current = loaded;
        for (const listener of listeners) listener();
      }
    });
  }
  return inFlight;
}

function acquire(): () => void {
  users += 1;
  if (users === 1) {
    void refresh(false);
    timer = setInterval(() => void refresh(false), SCHEDULE_REFRESH_MS);
  }
  return () => {
    users -= 1;
    if (users === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Forgets the schedule read (tests). */
export function resetSchedule(): void {
  current = null;
  inFlight = null;
  for (const listener of listeners) listener();
}

/**
 * The schedule of the club, kept up to date while `enabled` (a page without a block or slide that uses it never asks
 * for it). `refreshKey` changing (for example the end of a set) reads it again at once.
 */
export function useSchedule(enabled: boolean, refreshKey = ''): ScheduleResponse | null {
  const data = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  useEffect(() => (enabled ? acquire() : undefined), [enabled]);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (enabled) void refresh(true);
  }, [refreshKey, enabled]);
  return enabled ? data : null;
}
