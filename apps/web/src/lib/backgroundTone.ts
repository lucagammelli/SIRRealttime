import { formatHexColor } from '@arenalive/shared';
import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';
import { subscribeThemeEvents } from './theme.ts';

/**
 * Real background behind an element: the first background colour (computed by the browser, so colours of the client,
 * graphic template and light/dark theme included) of the element or of its ancestors that is not transparent, the
 * semi-transparent ones above it blended in. Used to choose the variant of a system logo (positive on light, negative
 * on dark); null when it cannot be told (the caller falls back to the positive variant).
 */

type Rgba = [number, number, number, number];

const RGB_PATTERN = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

/** Channels of `rgb()` / `rgba()` (the form browsers give for computed colours); null for anything else. */
export function parseRgbColor(value: string): Rgba | null {
  const m = RGB_PATTERN.exec(value.trim());
  if (!m) return null;
  const alphaText = m[4];
  let alpha = 1;
  if (alphaText !== undefined)
    alpha = alphaText.endsWith('%') ? Number.parseFloat(alphaText) / 100 : Number.parseFloat(alphaText);
  const channels = [m[1], m[2], m[3]].map((c) => Number.parseFloat(c ?? ''));
  if (![...channels, alpha].every(Number.isFinite)) return null;
  return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, Math.min(1, Math.max(0, alpha))];
}

let canvasContext: CanvasRenderingContext2D | null | undefined;

/** Any other CSS colour (oklch, color(), color-mix…) turned into rgba by a 1 × 1 canvas; null when there is none. */
function canvasColor(value: string): Rgba | null {
  try {
    if (canvasContext === undefined) {
      // jsdom has no canvas: getContext is not implemented there (null, or an error that is caught).
      canvasContext =
        typeof HTMLCanvasElement !== 'undefined' && !navigator.userAgent.includes('jsdom')
          ? document.createElement('canvas').getContext('2d', { willReadFrequently: true })
          : null;
    }
    const ctx = canvasContext;
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  } catch {
    return null;
  }
}

/** A CSS colour as rgba (0-255 and alpha 0-1); null when it cannot be read. */
export function cssColorToRgba(value: string): Rgba | null {
  const v = value.trim();
  if (v === '' || v === 'transparent') return [0, 0, 0, 0];
  return parseRgbColor(v) ?? canvasColor(v);
}

/** Pure: `#rrggbb` of the layers (top first) blended down to the first opaque one; null when none is opaque. */
export function blendLayers(layers: readonly Rgba[]): string | null {
  let rest = 1;
  const acc = [0, 0, 0];
  for (const [r, g, b, a] of layers) {
    if (a <= 0) continue;
    acc[0] = (acc[0] ?? 0) + r * a * rest;
    acc[1] = (acc[1] ?? 0) + g * a * rest;
    acc[2] = (acc[2] ?? 0) + b * a * rest;
    rest *= 1 - a;
    if (rest <= 0.001) return formatHexColor([acc[0] ?? 0, acc[1] ?? 0, acc[2] ?? 0]);
  }
  return null;
}

/** Background really behind `element` (`#rrggbb`), or null when it cannot be told. */
export function backgroundBehind(element: Element | null): string | null {
  if (!element || typeof window.getComputedStyle !== 'function') return null;
  const layers: Rgba[] = [];
  try {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = cssColorToRgba(window.getComputedStyle(node).backgroundColor);
      if (!color) return null;
      layers.push(color);
      if (color[3] >= 1) break;
    }
  } catch {
    return null;
  }
  return blendLayers(layers);
}

/** Attributes of <html> and <body> that change the colours: palette (inline style), theme, template, classes. */
const WATCHED_ATTRIBUTES = ['style', 'class', 'data-theme', 'data-template'];

/**
 * Background really behind the element of `ref` (`#rrggbb`, null when it cannot be told), computed at mount and again
 * when the colours of the client, the template, the theme or the system preference change (and at the end of a
 * colour transition, which would otherwise be read halfway). `mounted`: whether the element of `ref` is rendered now;
 * when it changes (e.g. a logo that appears) the background is read again on the new element.
 */
export function useBackgroundBehind(ref: RefObject<Element | null>, mounted = true): string | null {
  const [background, setBackground] = useState<string | null>(null);
  useLayoutEffect(() => {
    const update = (): void => setBackground(backgroundBehind(ref.current));
    update();
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    for (const target of [document.documentElement, document.body])
      observer?.observe(target, { attributes: true, attributeFilter: WATCHED_ATTRIBUTES });
    const unsubscribeTheme = subscribeThemeEvents(update);
    const onTransition = (e: TransitionEvent): void => {
      if (e.propertyName === 'background-color') update();
    };
    document.addEventListener('transitionend', onTransition);
    return () => {
      observer?.disconnect();
      unsubscribeTheme();
      document.removeEventListener('transitionend', onTransition);
    };
  }, [ref, mounted]);
  return background;
}
