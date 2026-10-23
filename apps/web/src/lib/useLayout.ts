import type { RefObject } from 'react';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Device, TvMode } from './layout.ts';
import { deviceFor } from './layout.ts';

/** Width of the viewport (CSS px), followed on resize and rotation of the device. */
function subscribeResize(callback: () => void): () => void {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}
const viewportWidth = (): number => window.innerWidth;
const viewportHeight = (): number => window.innerHeight;

export function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, viewportWidth, () => 1024);
}
export function useViewportHeight(): number {
  return useSyncExternalStore(subscribeResize, viewportHeight, () => 768);
}

/** Device of the screen now (rules of `deviceFor`: `?tv=`, full screen). */
export function useDevice(tv: TvMode = 'auto', fullscreen = false): Device {
  return deviceFor({ width: useViewportWidth(), height: useViewportHeight() }, tv, fullscreen);
}

/** Device the match page is laid out for: the charts read it to simplify themselves on the phone. */
export const DeviceContext = createContext<Device>('tablet');
export const useDeviceContext = (): Device => useContext(DeviceContext);

/**
 * «Touch» of the device of the public page (option of the layout): with `false` nothing can be tapped or clicked
 * (no buttons, selectors or links) and the charts keep their default view. Default: `true`.
 */
export const TouchContext = createContext(true);
export const useTouch = (): boolean => useContext(TouchContext);

/**
 * Scale of the page drawn inside a reduced frame (preview of the editor, CSS transform): measured heights are divided
 * by it, so the big screen groups its blocks as on the real screen.
 */
export const LayoutScaleContext = createContext(1);

/**
 * Height (px) of an element, followed with ResizeObserver; 0 before the first measure, without the element or without
 * the API. `watch`: a value that changes when the element of `ref` is mounted or removed.
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>, watch: unknown = null): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      setHeight(0);
      return;
    }
    setHeight(el.getBoundingClientRect().height);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => setHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, watch]);
  return height;
}

/** Width and height (px) of an element, followed with ResizeObserver; 0 × 0 before the first measure or without the API. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const { width, height } = el.getBoundingClientRect();
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** Font size of <html> in px (1 rem): the big screen scales it with the viewport. */
export function rootFontPx(): number {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/** Counter that goes up every `intervalMs` while `active`; it keeps its value while stopped (pause, resume). */
export function useTicker(active: boolean, intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return tick;
}

/** CSS variable on <html> with the height of the sticky scoreboard (scroll-padding-top in styles/index.css). */
export const STICKY_OFFSET_VAR = '--sir-sticky-offset';
/** Space left between the sticky scoreboard and an element brought into view. */
const STICKY_MARGIN_PX = 12;

/**
 * While the element of `ref` is mounted, the page keeps its height free on top when it scrolls to an element (focus
 * with the keyboard, anchors): nothing ends up under the sticky scoreboard of the phone. Never inside a scaled
 * preview (LayoutScaleContext different from 1).
 */
export function useStickyOffset(ref: RefObject<HTMLElement | null>, wanted: boolean): void {
  // Inside a scaled preview (editor «Pagina pubblica») the page around is not this one: nothing is written on <html>.
  const scale = useContext(LayoutScaleContext);
  const active = wanted && scale === 1;
  const height = useElementHeight(ref, active);
  useEffect(() => {
    if (!active || height <= 0) return;
    const root = document.documentElement;
    root.style.setProperty(STICKY_OFFSET_VAR, `${Math.ceil(height) + STICKY_MARGIN_PX}px`);
    return () => {
      root.style.removeProperty(STICKY_OFFSET_VAR);
    };
  }, [active, height]);
}
