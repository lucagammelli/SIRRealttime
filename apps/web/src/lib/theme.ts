import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sir-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function readChoice(): ThemeChoice {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Theme imposed by the graphic template of the client (null: the choice of the viewer). */
let forced: ResolvedTheme | null = null;

/**
 * Writes the choice on `<html data-theme>`: the tokens of tokens.css follow it. With a theme imposed by the template
 * that one is written instead (the choice stays remembered for the other templates).
 */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  const theme = forced ?? choice;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/** Imposes a theme (template «SIR VOLLEY»: always dark) or gives the choice back to the viewer (null). */
export function setForcedTheme(theme: ResolvedTheme | null): void {
  if (forced === theme) return;
  forced = theme;
  applyThemeChoice(readChoice());
  window.dispatchEvent(new Event('sir-theme'));
}

/** Theme imposed now (null: the viewer chooses). */
export function forcedTheme(): ResolvedTheme | null {
  return forced;
}

/** Theme imposed by the template, followed (the light/dark switch hides itself when there is one). */
export function useForcedTheme(): ResolvedTheme | null {
  return useSyncExternalStore(subscribeThemeEvents, forcedTheme, () => null);
}

function subscribeMedia(query: string) {
  return (callback: () => void): (() => void) => {
    if (typeof window.matchMedia !== 'function') return () => undefined;
    const mql = window.matchMedia(query);
    mql.addEventListener('change', callback);
    return () => mql.removeEventListener('change', callback);
  };
}
const mediaMatches = (query: string) => (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

const subscribeDark = subscribeMedia(DARK_QUERY);
const getDark = mediaMatches(DARK_QUERY);
const subscribeMotion = subscribeMedia(MOTION_QUERY);
const getMotion = mediaMatches(MOTION_QUERY);

/** Light/dark switch: system preference by default, the choice is remembered in localStorage. */
export function useTheme(): { choice: ThemeChoice; resolved: ResolvedTheme; toggle: () => void } {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);
  const systemDark = useSyncExternalStore(subscribeDark, getDark, () => false);
  const imposed = useForcedTheme();
  const resolved: ResolvedTheme = imposed ?? (choice === 'system' ? (systemDark ? 'dark' : 'light') : choice);

  useEffect(() => {
    applyThemeChoice(choice);
    try {
      if (choice === 'system') window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Private mode: the choice lasts only for the page.
    }
    window.dispatchEvent(new Event('sir-theme'));
  }, [choice]);

  const toggle = useCallback(() => setChoice(resolved === 'dark' ? 'light' : 'dark'), [resolved]);
  return { choice, resolved, toggle };
}

/** Calls `callback` when the theme in use changes (switch or system preference). */
export function subscribeThemeEvents(callback: () => void): () => void {
  window.addEventListener('sir-theme', callback);
  const unsubscribeMedia = subscribeDark(callback);
  return () => {
    window.removeEventListener('sir-theme', callback);
    unsubscribeMedia();
  };
}
/** Theme in use now (choice on <html>, otherwise the system preference). */
export function currentTheme(): ResolvedTheme {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return getDark() ? 'dark' : 'light';
}

/** Theme in use, for the charts (canvas cannot read CSS variables: they are re-themed when it changes). */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeThemeEvents, currentTheme, () => 'light');
}

/** True with `prefers-reduced-motion: reduce`: no chart animations. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, getMotion, () => false);
}

/** Applies the remembered choice before the first render (no flash of the wrong theme). */
export function initTheme(): void {
  applyThemeChoice(readChoice());
}
