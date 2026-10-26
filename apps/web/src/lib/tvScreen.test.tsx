import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TV_ROOT_CLASS, tvRemPx, useIdle, useTvRootClass, useWakeLock } from './tvScreen.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility('visible');
});

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

/** navigator.wakeLock that records the locks it gives. */
function mockWakeLock() {
  const locks: { released: boolean; release: ReturnType<typeof vi.fn> }[] = [];
  const request = vi.fn(() => {
    const lock = {
      released: false,
      release: vi.fn(() => {
        lock.released = true;
        return Promise.resolve();
      }),
    };
    locks.push(lock);
    return Promise.resolve(lock);
  });
  vi.stubGlobal('navigator', { ...navigator, wakeLock: { request } });
  return { request, locks };
}

function WakeLock({ on }: { on: boolean }) {
  useWakeLock(on);
  return null;
}

describe('useWakeLock', () => {
  it('requests the screen lock, releases it when the page is hidden and asks again when it comes back', async () => {
    const { request, locks } = mockWakeLock();
    const { unmount } = render(<WakeLock on />);
    await act(async () => Promise.resolve());
    expect(request).toHaveBeenCalledWith('screen');
    expect(locks).toHaveLength(1);

    setVisibility('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(locks[0]?.release).toHaveBeenCalled();

    setVisibility('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(2);

    unmount();
    expect(locks[1]?.release).toHaveBeenCalled();
  });

  it('does nothing when disabled or without the API', async () => {
    const { request } = mockWakeLock();
    render(<WakeLock on={false} />);
    await act(async () => Promise.resolve());
    expect(request).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', {});
    expect(() => render(<WakeLock on />)).not.toThrow();
  });
});

function Idle({ on }: { on: boolean }) {
  return <p data-testid="idle">{String(useIdle(on))}</p>;
}

describe('useIdle', () => {
  it('becomes idle after 3 s without input and wakes on mouse movement', () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(<Idle on />);
    expect(getByTestId('idle').textContent).toBe('false');
    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(getByTestId('idle').textContent).toBe('false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getByTestId('idle').textContent).toBe('true');
    act(() => {
      window.dispatchEvent(new Event('mousemove'));
    });
    expect(getByTestId('idle').textContent).toBe('false');
    rerender(<Idle on={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(getByTestId('idle').textContent).toBe('false');
  });
});

function RootClass({ on }: { on: boolean }) {
  useTvRootClass(on);
  return null;
}

describe('useTvRootClass', () => {
  it('scales the text of <html> only on the big screen', () => {
    const { rerender, unmount } = render(<RootClass on />);
    expect(document.documentElement.classList.contains(TV_ROOT_CLASS)).toBe(true);
    rerender(<RootClass on={false} />);
    expect(document.documentElement.classList.contains(TV_ROOT_CLASS)).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--sir-vw')).toBe('');
    rerender(<RootClass on />);
    // 1vw and 1vh of the page are 1 % of the 1920 × 1080 canvas, not of the window.
    expect(document.documentElement.style.getPropertyValue('--sir-vw')).toBe('19.2px');
    expect(document.documentElement.style.getPropertyValue('--sir-vh')).toBe('10.8px');
    unmount();
    expect(document.documentElement.classList.contains(TV_ROOT_CLASS)).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--sir-vh')).toBe('');
  });
});

describe('tvRemPx', () => {
  it('computes the clamp of the variable for a viewport', () => {
    expect(tvRemPx('clamp(16px, min(1.25vw, 2.2vh), 48px)', 1920, 1080)).toBeCloseTo(23.76);
    expect(tvRemPx('clamp(14px, min(0.9vw, 1.6vh), 36px)', 1920, 1080)).toBeCloseTo(17.28);
    expect(tvRemPx('clamp(14px, min(0.9vw, 1.6vh), 36px)', 800, 450)).toBe(14);
    expect(tvRemPx('clamp(14px, min(0.9vw, 1.6vh), 36px)', 7680, 4320)).toBe(36);
  });

  it('reads the token written with the canvas variables, also as the browser returns it', () => {
    expect(
      tvRemPx('clamp(16px, min(calc(1.25 * var(--sir-vw)), calc(2.2 * var(--sir-vh))), 48px)', 1920, 1080),
    ).toBeCloseTo(23.76);
    expect(tvRemPx('clamp(14px, min(calc(0.9 * 1vw), calc(1.6 * 1vh)), 36px)', 1920, 1080)).toBeCloseTo(17.28);
  });

  it('falls back to the default theme when the text is not readable', () => {
    expect(tvRemPx('', 1920, 1080)).toBeCloseTo(23.76);
    expect(tvRemPx(null, 1920, 1080)).toBeCloseTo(23.76);
    expect(tvRemPx('20px', 1920, 1080)).toBeCloseTo(23.76);
  });
});
