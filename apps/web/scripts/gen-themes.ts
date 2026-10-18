/**
 * Writes src/styles/themes.generated.css: the CSS of every custom theme (JSON in packages/shared/src/themes, their
 * `css` document), so that a custom theme is only a JSON file. `--check` does not write: it fails when the file is
 * not up to date. Run: `pnpm --filter @sir/web themes`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE_IDS, TEMPLATES, themeCss } from '@sir/shared';

/** Relative to apps/web (the working directory of the script and of the tests). */
export const THEMES_CSS_PATH = join(process.cwd(), 'src/styles/themes.generated.css');

const HEADER = `/* GENERATO da scripts/gen-themes.ts dai file JSON dei temi personalizzati: non modificare a mano. */\n`;

export function generatedThemesCss(): string {
  const blocks = TEMPLATE_IDS.map((id) => TEMPLATES[id])
    .filter((t) => t.custom && t.css)
    .map((t) => `\n/* Tema personalizzato «${t.label.replace(/\*\//g, '')}» (packages/shared/src/themes/${t.id}.json). */\n${themeCss(t)}`);
  return HEADER + blocks.join('');
}

if (process.argv[1]?.endsWith('gen-themes.ts')) {
  const css = generatedThemesCss();
  if (process.argv.includes('--check')) {
    if (readFileSync(THEMES_CSS_PATH, 'utf8') !== css) {
      console.error('themes.generated.css non aggiornato: lancia `pnpm --filter @sir/web themes`');
      process.exit(1);
    }
  } else writeFileSync(THEMES_CSS_PATH, css);
}
