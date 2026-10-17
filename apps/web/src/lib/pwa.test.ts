import { cleanup, renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canAskFullscreen,
  FULLSCREEN_HINT_SECONDS,
  isStandalone,
  registerServiceWorker,
  SERVICE_WORKER_URL,
  useFullscreenOnFirstTouch,
  useInstallApp,
} from './pwa.ts';

function stubDisplayMode(mode: 'browser' | 'standalone' | 'fullscreen'): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === `(display-mode: ${mode})`,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

let request: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request = vi.fn(() => Promise.resolve());
  HTMLElement.prototype.requestFullscreen = request as unknown as () => Promise<void>;
  stubDisplayMode('browser');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
});

describe('service worker', () => {
  it('registers /sw.js with the scope of the site where the browser supports it', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    expect(await registerServiceWorker({ serviceWorker: { register } })).toBe(true);
    expect(register).toHaveBeenCalledWith(SERVICE_WORKER_URL, { scope: '/' });
    expect(SERVICE_WORKER_URL).toBe('/sw.js');
  });

  it('does nothing where it is not supported, and never throws when it is refused', async () => {
    expect(await registerServiceWorker({})).toBe(false);
    const refused = vi.fn(() => Promise.reject(new Error('negato')));
    expect(await registerServiceWorker({ serviceWorker: { register: refused } })).toBe(false);
  });

  it('does not register outside a secure context', async () => {
    vi.stubGlobal('isSecureContext', false);
    const register = vi.fn(() => Promise.resolve({}));
    expect(await registerServiceWorker({ serviceWorker: { register } })).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });
});

describe('installed app', () => {
  it('knows when the page runs without browser bars', () => {
    expect(isStandalone()).toBe(false);
    stubDisplayMode('standalone');
    expect(isStandalone()).toBe(true);
    stubDisplayMode('fullscreen');
    expect(isStandalone()).toBe(true);
    stubDisplayMode('browser');
    expect(canAskFullscreen()).toBe(true);
    stubDisplayMode('standalone');
    expect(canAskFullscreen()).toBe(false);
  });

  it('offers the installation only when the browser sends beforeinstallprompt, and opens its prompt', async () => {
    const { result } = renderHook(() => useInstallApp());
    expect(result.current.canInstall).toBe(false);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.canInstall).toBe(true);
    await act(async () => {
      await result.current.install();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canInstall).toBe(false);
  });

  it('no offer once installed', () => {
    const { result } = renderHook(() => useInstallApp());
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(result.current.canInstall).toBe(false);
  });
});

describe('full screen at the first touch', () => {
  it('shows the hint, then the first tap on the page asks for full screen once and hides it', () => {
    const { result } = renderHook(() => useFullscreenOnFirstTouch());
    expect(result.current).toBe(true);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(false);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a key asks too, but not a modifier, Tab or Esc', () => {
    renderHook(() => useFullscreenOnFirstTouch());
    for (const key of ['Shift', 'Tab', 'Escape']) {
      act(() => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    }
    expect(request).not.toHaveBeenCalled();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a tap on a button or a link is for that control: no full screen from it, the hint stays', () => {
    const button = document.createElement('button');
    document.body.append(button);
    const { result } = renderHook(() => useFullscreenOnFirstTouch());
    act(() => {
      button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(request).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
    button.remove();
  });

  it('the hint goes away by itself after a few seconds; the first touch still works', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFullscreenOnFirstTouch());
    act(() => {
      vi.advanceTimersByTime(FULLSCREEN_HINT_SECONDS * 1000);
    });
    expect(result.current).toBe(false);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('nothing when disabled, installed as an app, or without the Fullscreen API', () => {
    const off = renderHook(() => useFullscreenOnFirstTouch(false));
    expect(off.result.current).toBe(false);
    off.unmount();
    stubDisplayMode('standalone');
    const installed = renderHook(() => useFullscreenOnFirstTouch());
    expect(installed.result.current).toBe(false);
    installed.unmount();
    stubDisplayMode('browser');
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
    const none = renderHook(() => useFullscreenOnFirstTouch());
    expect(none.result.current).toBe(false);
    act(() => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(request).not.toHaveBeenCalled();
  });
});
