import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screenHasTouch, useTouchScreen } from './useLayout.ts';

/** Fake `matchMedia` with `any-pointer: coarse` answering `coarse`; `set` changes it and notifies the listeners. */
function fakeMatchMedia(coarse: boolean) {
  let matches = coarse;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    set(value: boolean) {
      matches = value;
      listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('screenHasTouch', () => {
  it('reads any-pointer: coarse; true when matchMedia is missing', () => {
    expect(screenHasTouch(undefined)).toBe(true);
    expect(screenHasTouch(() => ({ matches: false }))).toBe(false);
    expect(screenHasTouch((q) => ({ matches: q === '(any-pointer: coarse)' }))).toBe(true);
  });
});

describe('useTouchScreen', () => {
  it('is true without matchMedia (tests, SSR)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useTouchScreen()).result.current).toBe(true);
  });

  it('follows the change of the pointer', () => {
    const media = fakeMatchMedia(false);
    const { result } = renderHook(() => useTouchScreen());
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
  });
});
