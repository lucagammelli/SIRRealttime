import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEMPLATE_IDS, TEMPLATES, ThemeCssSchema, themeCss } from '@arenalive/shared';
import { describe, expect, it } from 'vitest';
import { generatedThemesCss, THEMES_CSS_PATH } from '../../scripts/gen-themes.ts';

interface Rule {
  media: string | null;
  selector: string;
  declarations: Record<string, string>;
}

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(css: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    let depth = 1;
    let k = open + 1;
    while (depth > 0) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') depth--;
      k++;
    }
    out.push([css.slice(i, open).replace(/\s+/g, ' ').trim(), css.slice(open + 1, k - 1)]);
    i = k;
  }
  return out;
}

function declarations(body: string): Record<string, string> {
  const d: Record<string, string> = {};
  for (const m of body.matchAll(/(-{0,2}[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g))
    d[m[1] ?? ''] = (m[2] ?? '').replace(/\s+/g, ' ').trim();
  return d;
}

/** Rules in order, with the media query they are in. */
function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const [selector, body] of blocks(strip(css))) {
    if (selector.startsWith('@media'))
      for (const [inner, innerBody] of blocks(body))
        out.push({ media: selector.slice(6).trim(), selector: inner, declarations: declarations(innerBody) });
    else out.push({ media: null, selector, declarations: declarations(body) });
  }
  return out;
}

describe('custom themes as JSON', () => {
  it('has a CSS document in every custom theme, valid for the schema', () => {
    const custom = TEMPLATE_IDS.map((id) => TEMPLATES[id]).filter((t) => t.custom);
    expect(custom.map((t) => t.id)).toEqual(['sir-volley']);
    for (const t of custom) expect(ThemeCssSchema.safeParse(t.css).success).toBe(true);
  });

  it('refuses a value that could leave its declaration', () => {
    const base = TEMPLATES['sir-volley'].css;
    for (const value of ['red; } body { display: none', 'url(http://x)', '/* x */', '@import']) {
      expect(ThemeCssSchema.safeParse({ ...base, vars: { '--sir-bg': value } }).success, value).toBe(false);
    }
    expect(ThemeCssSchema.safeParse({ ...base, rules: [{ selectors: ['body'], declarations: {} }] }).success).toBe(
      false,
    );
  });

  it('generates exactly the CSS that was written by hand for SIR VOLLEY (tokens, screens, big screen, hook classes)', () => {
    const original = readFileSync(join(process.cwd(), 'src/test/sir-volley.original.css'), 'utf8');
    const generated = themeCss(TEMPLATES['sir-volley']);
    const normalize = (list: Rule[]) => JSON.parse(JSON.stringify(list)) as Rule[];
    const before = rules(original);
    expect(before.length).toBeGreaterThan(20);
    // The generator writes tokens, media, big screen, then the rules: the same order as the hand-written files.
    expect(normalize(rules(generated))).toEqual(normalize(before));
  });

  it('keeps the generated file of the portal up to date', () => {
    expect(readFileSync(THEMES_CSS_PATH, 'utf8')).toBe(generatedThemesCss());
  });
});
