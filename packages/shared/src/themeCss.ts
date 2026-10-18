import type { TemplateDocument, ThemeCss } from './templateDefinition.js';

const declarations = (decl: Record<string, string>, indent: string): string =>
  Object.entries(decl)
    .map(([name, value]) => `${indent}${name}: ${value};\n`)
    .join('');

/**
 * Pure: the CSS of a custom theme (its `css` document) under `[data-template='<id>']`: the tokens on `:root` and on
 * the preview scope, the same for smaller screens, the big screen, and the rules on the hook classes. Empty for a
 * template without `css`.
 */
export function themeCss(theme: Pick<TemplateDocument, 'id'> & { css?: ThemeCss | undefined }): string {
  const { css } = theme;
  if (!css) return '';
  const scope = `[data-template='${theme.id}']`;
  const roots = `:root${scope},\n[data-sir-scope]${scope}`;
  const out: string[] = [`${roots} {\n${declarations(css.vars, '  ')}}\n`];
  for (const m of css.media)
    out.push(`@media ${m.query} {\n  ${roots.replace('\n', '\n  ')} {\n${declarations(m.vars, '    ')}  }\n}\n`);
  if (Object.keys(css.tvVars).length > 0) out.push(`:root.sir-tv${scope} {\n${declarations(css.tvVars, '  ')}}\n`);
  for (const rule of css.rules) {
    const selectors = rule.selectors.map((s) => s.replace('&', scope));
    out.push(`${selectors.join(',\n')} {\n${declarations(rule.declarations, '  ')}}\n`);
  }
  return out.join('\n');
}
