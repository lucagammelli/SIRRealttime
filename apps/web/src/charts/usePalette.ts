import { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { useBrandingRevision } from '../lib/branding.ts';
import { useResolvedTheme } from '../lib/theme.ts';
import type { ChartPalette } from './theme.ts';
import { readPalette } from './theme.ts';

/**
 * An element with its own colour tokens (`data-sir-scope`, the preview of the «Studio grafico» with the colours being
 * edited): the charts inside it read their palette there instead of `<html>`. `key` changes with its colours.
 */
export interface PaletteScope {
  root: Element;
  key: string;
}
export const PaletteScopeContext = createContext<PaletteScope | null>(null);

/** Key of the palette in use: theme, graphics of the client and colours of the scope (null outside a scope). */
export function usePaletteKey(): { key: string; root: Element | null } {
  const theme = useResolvedTheme();
  const revision = useBrandingRevision();
  const scope = useContext(PaletteScopeContext);
  return { key: `${theme}-${revision}${scope ? `-${scope.key}` : ''}`, root: scope?.root ?? null };
}

/**
 * Palette of the theme in use (read again when light/dark changes or the graphics of the client arrive). Inside a
 * scope it is read on the element of the scope after every commit (its inline colours are written then).
 */
export function usePalette(): ChartPalette {
  const { key, root } = usePaletteKey();
  const [scoped, setScoped] = useState<ChartPalette | null>(null);
  useLayoutEffect(() => {
    setScoped(root ? readPalette(root) : null);
  }, [key, root]);
  // `key` says when to read again: readPalette reads the CSS variables it stands for.
  const page = useMemo(() => readPalette(), [key]);
  return root && scoped ? scoped : page;
}
