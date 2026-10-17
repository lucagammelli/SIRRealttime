import { useCallback, useEffect, useState } from 'react';

/**
 * Public page as an app (PWA) and full screen: service worker registration, «Installa come app», full screen at the
 * first touch. Everything is optional: where a browser lacks an API, nothing happens and the page works as before.
 */

/** Script of the minimal service worker (`public/sw.js`): only for the installation, no cache. */
export const SERVICE_WORKER_URL = '/sw.js';

/** Minimal part of `navigator` used to register the service worker (replaceable in tests). */
export interface ServiceWorkerHost {
  serviceWorker?: { register: (url: string, options?: { scope?: string }) => Promise<unknown> };
}

/** True when the page runs as an installed app or in full screen (no browser bars): no install, no full screen asked. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : null;
  const displayMode = (mode: string): boolean => media?.(`(display-mode: ${mode})`).matches === true;
  const ios = (navigator as { standalone?: boolean }).standalone === true;
  return ios || displayMode('standalone') || displayMode('fullscreen');
}

/**
 * Registers the service worker where the browser supports it (secure context). Resolves true when registered, false
 * when not supported or refused: never throws.
 */
export async function registerServiceWorker(host: ServiceWorkerHost = navigator): Promise<boolean> {
  if (!host.serviceWorker) return false;
  if (typeof window !== 'undefined' && window.isSecureContext === false) return false;
  try {
    await host.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' });
    return true;
  } catch {
    return false;
  }
}

/** iPhone and iPad (also an iPad that says it is a Mac): there is no install prompt, the user adds it from «Condividi». */
export function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Event of the browser that offers the installation (not in the DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallApp {
  /** The browser offers the installation: show «Installa come app». */
  canInstall: boolean;
  /** Not installed and on iOS: show the short instructions («Condividi → Aggiungi a Home»). */
  iosHelp: boolean;
  /** Opens the prompt of the browser. */
  install: () => Promise<void>;
}

/** Installation of the page as an app: keeps the `beforeinstallprompt` event until the user asks for it. */
export function useInstallApp(): InstallApp {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  useEffect(() => {
    const onPrompt = (e: Event): void => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      setInstalled(true);
      setEvent(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  const install = useCallback(async (): Promise<void> => {
    if (!event) return;
    setEvent(null);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      // closed or refused: nothing to do, the browser may offer it again later
    }
  }, [event]);
  return { canInstall: !installed && event !== null, iosHelp: !installed && event === null && isIos(), install };
}

/** Seconds the hint «Tocca per lo schermo intero» stays on screen. */
export const FULLSCREEN_HINT_SECONDS = 8;

/** Keys that are not a deliberate action (modifiers, Tab to move around, Esc): they do not ask for full screen. */
const PASSIVE_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Escape']);

/** An interactive element: the first tap on it is meant for it (e.g. the button «Schermo intero»), not for this. */
const INTERACTIVE = 'a, button, input, select, textarea, summary, [role="button"], [role="switch"], [role="tab"]';

/** True when full screen can be asked for here (API present, not already in full screen or in an installed app). */
export function canAskFullscreen(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    !document.fullscreenElement &&
    !isStandalone()
  );
}

/**
 * Full screen at the first touch: the browser lets a page ask for it only after a gesture, so the first pointerdown or
 * keydown on the page (not on a button or a link, not a modifier key) asks for it once. Returns whether the discreet
 * hint is to be shown: from the start until the first use, or after `FULLSCREEN_HINT_SECONDS`. `enabled` false (for
 * example the big screen already in full screen): nothing, no hint.
 */
export function useFullscreenOnFirstTouch(enabled = true): boolean {
  const [hint, setHint] = useState(() => enabled && canAskFullscreen());
  useEffect(() => {
    if (!enabled || !canAskFullscreen()) {
      setHint(false);
      return;
    }
    setHint(true);
    const timer = setTimeout(() => setHint(false), FULLSCREEN_HINT_SECONDS * 1000);
    const forThisPage = (target: EventTarget | null): boolean =>
      !(target instanceof Element && target.closest(INTERACTIVE));
    const stop = (): void => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onChange);
      clearTimeout(timer);
      setHint(false);
    };
    function ask(): void {
      stop();
      if (canAskFullscreen()) void document.documentElement.requestFullscreen().catch(() => undefined);
    }
    function onPointer(e: PointerEvent): void {
      if (forThisPage(e.target)) ask();
    }
    function onKey(e: KeyboardEvent): void {
      if (!PASSIVE_KEYS.has(e.key) && forThisPage(e.target)) ask();
    }
    // Full screen reached some other way (the button, F11): nothing more to ask.
    function onChange(): void {
      if (document.fullscreenElement) stop();
    }
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('fullscreenchange', onChange);
    return stop;
  }, [enabled]);
  return hint;
}
