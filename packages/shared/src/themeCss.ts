import type { TemplateDocument, ThemeCss } from './templateDefinition.js';

const declarations = (decl: Record<string, string>, indent: string): string =>
  Object.entries(decl)
    .map(([name, value]) => `${indent}${name}: ${value};\n`)
    .join('');

/**
 * Pure: the CSS of a custom theme (its `css` document) under `[data-template='<id>']`: the tokens on `:root` and on
 * the preview scope, the same for smaller screens (never on the big screen), the big screen, and the rules on the hook classes. Empty for a
 * template without `css`.
 */
export function themeCss(theme: Pick<TemplateDocument, 'id'> & { css?: ThemeCss | undefined }): string {
  const { css } = theme;
  if (!css) return '';
  const scope = `[data-template='${theme.id}']`;
  const roots = `:root${scope},\n[data-sir-scope]${scope}`;
  const out: string[] = [`${roots} {\n${declarations(css.vars, '  ')}}\n`];
  // The big screen is drawn on a fixed canvas (1920 × 1080): the window size must not change its tokens, so the rules
  // for smaller screens leave out `html.sir-tv` and the preview of the big screen (`data-tv-canvas`).
  const mediaRoots = `:root${scope}:not(.sir-tv),\n[data-sir-scope]${scope}:not([data-tv-canvas])`;
  for (const m of css.media)
    out.push(`@media ${m.query} {\n  ${mediaRoots.replace('\n', '\n  ')} {\n${declarations(m.vars, '    ')}  }\n}\n`);
  if (Object.keys(css.tvVars).length > 0) out.push(`:root.sir-tv${scope} {\n${declarations(css.tvVars, '  ')}}\n`);
  for (const rule of css.rules) {
    const selectors = rule.selectors.map((s) => s.replace('&', scope));
    out.push(`${selectors.join(',\n')} {\n${declarations(rule.declarations, '  ')}}\n`);
  }
  return out.join('\n');
}
