import { useEffect, useState } from 'react';

/** Inactivity after which the big screen hides the mouse pointer and the buttons. */
export const IDLE_CURSOR_MS = 3000;

/** Class on <html> that scales the text of the big screen with the viewport (styles/index.css). */
export const TV_ROOT_CLASS = 'sir-tv';

/** Variable of the font size of the big screen (tokens.css, one value per graphic template). */
export const TV_FONT_VAR = '--sir-tv-font-size';
/** Value of the default theme, used where the variable cannot be read. */
const TV_FONT_FALLBACK = 'clamp(16px, min(1.25vw, 2.2vh), 48px)';
const TV_FONT_CLAMP = /clamp\(\s*([\d.]+)px\s*,\s*min\(\s*([\d.]+)vw\s*,\s*([\d.]+)vh\s*\)\s*,\s*([\d.]+)px\s*\)/;

/**
 * Pure: 1 rem (px) of the big screen for a viewport of `width` × `height` px, from the text of the variable
 * `--sir-tv-font-size` (`clamp(min, min(Xvw, Yvh), max)`); the default theme's value when the text is not that form.
 * The preview of the Studio uses it for a 1920 × 1080 screen: the viewport of the reserved area is not the screen.
 */
export function tvRemPx(raw: string | null | undefined, width: number, height: number): number {
  const m = TV_FONT_CLAMP.exec(raw ?? '') ?? TV_FONT_CLAMP.exec(TV_FONT_FALLBACK);
  if (!m) return 16;
  const [lo, vw, vh, hi] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  return Math.min(hi, Math.max(lo, Math.min((vw * width) / 100, (vh * height) / 100)));
}

/**
 * True after `idleMs` without moving the mouse, touching or pressing a key (only while `enabled`): the big screen
 * hides the pointer and the buttons.
 */
export function useIdle(enabled: boolean, idleMs = IDLE_CURSOR_MS): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = (): void => {
      setIdle(false);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), idleMs);
    };
    const events = ['pointermove', 'pointerdown', 'mousemove', 'keydown', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, wake, { passive: true });
    wake();
    return () => {
      if (timer) clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [enabled, idleMs]);
  return idle;
}

/**
 * Keeps the screen on with the Screen Wake Lock API, where the browser has it, while `enabled` and the page is visible.
 * The lock is released when the page is hidden (the browser drops it anyway) and requested again when it comes back.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    let disposed = false;
    const release = (): void => {
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) void current.release().catch(() => undefined);
    };
    const request = (): void => {
      if (document.visibilityState !== 'visible' || sentinel || pending) return;
      pending = true;
      navigator.wakeLock.request('screen').then(
        (lock) => {
          pending = false;
          if (disposed || document.visibilityState !== 'visible') void lock.release().catch(() => undefined);
          else sentinel = lock;
        },
        // Denied (battery saver, policy): the page works anyway, the screen may turn off.
        () => {
          pending = false;
        },
      );
    };
    const onVisibility = (): void => (document.visibilityState === 'visible' ? request() : release());
    document.addEventListener('visibilitychange', onVisibility);
    request();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release();
    };
  }, [enabled]);
}

/** Puts the class of the big screen on <html> while `enabled` (fluid text size). */
export function useTvRootClass(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.add(TV_ROOT_CLASS);
    return () => root.classList.remove(TV_ROOT_CLASS);
  }, [enabled]);
}
