import { useMemo } from 'react';
import { useResolvedTheme } from '../lib/theme.ts';
import type { ChartPalette } from './theme.ts';
import { readPalette } from './theme.ts';

/** Palette of the theme in use (read again when light/dark changes). */
export function usePalette(): ChartPalette {
  const theme = useResolvedTheme();
  return useMemo(() => readPalette(), [theme]);
}
