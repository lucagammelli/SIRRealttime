import { useMemo } from 'react';
import { useBrandingRevision } from '../lib/branding.ts';
import { useResolvedTheme } from '../lib/theme.ts';
import type { ChartPalette } from './theme.ts';
import { readPalette } from './theme.ts';

/** Palette of the theme in use (read again when light/dark changes or the graphics of the client arrive). */
export function usePalette(): ChartPalette {
  const theme = useResolvedTheme();
  const revision = useBrandingRevision();
  // theme and revision are the keys: readPalette reads the CSS variables they change.
  return useMemo(() => readPalette(), [theme, revision]);
}
