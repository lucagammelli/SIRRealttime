import { describe, expect, it } from 'vitest';
import {
  brandContrastIssues,
  brandPalette,
  contrastRatio,
  DARK_SURFACE,
  DEFAULT_BRAND_COLORS,
  ensureContrast,
  HexColorSchema,
  MIN_TEXT_CONTRAST,
  mixColors,
  parseHexColor,
  relativeLuminance,
  resolveBrandColors,
  textColorOn,
} from './index.js';

describe('colour math', () => {
  it('parses #rrggbb in any case and rejects the rest', () => {
    expect(parseHexColor('#FF8000')).toEqual([255, 128, 0]);
    expect(() => parseHexColor('#f80')).toThrow();
    expect(HexColorSchema.parse(' #AbCdEf ')).toBe('#abcdef');
    expect(HexColorSchema.safeParse('#abcdef00').success).toBe(false);
  });

  it('computes the WCAG relative luminance and contrast', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    // Reference value of the WCAG tools: #777777 on white is 4.48:1.
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#123456', '#abcdef')).toBe(contrastRatio('#abcdef', '#123456'));
  });

  it('chooses white or black text, always readable', () => {
    expect(textColorOn('#1d4ed8')).toBe('#ffffff');
    expect(textColorOn('#ffd400')).toBe('#000000');
    for (const c of ['#000000', '#ffffff', '#777777', '#ff0000', '#00ff00', '#0000ff', '#808080', '#767676']) {
      expect(contrastRatio(textColorOn(c), c)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });

  it('mixes two colours', () => {
    expect(mixColors('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(mixColors('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(mixColors('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });

  it('lightens or darkens a colour until it is readable', () => {
    const dark = ensureContrast('#1d4ed8', DARK_SURFACE);
    expect(contrastRatio(dark, DARK_SURFACE)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(relativeLuminance(dark)).toBeGreaterThan(relativeLuminance('#1d4ed8'));
    const light = ensureContrast('#ffd400', '#ffffff');
    expect(contrastRatio(light, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(ensureContrast('#000000', '#ffffff')).toBe('#000000');
  });
});

describe('brand palette', () => {
  it('writes only the variables of the colours given', () => {
    expect(brandPalette({})).toEqual({ light: {}, dark: {} });
    const p = brandPalette({ away: '#a21caf' });
    expect(Object.keys(p.light).sort()).toEqual(['--sir-away', '--sir-away-soft', '--sir-on-away']);
    expect(Object.keys(p.dark).sort()).toEqual(Object.keys(p.light).sort());
  });

  it('computes readable variants for the dark theme and a dark tint of the background', () => {
    const p = brandPalette({ home: '#003399', primary: '#222222', accent: '#ffcc00', background: '#fff4e0' });
    expect(p.light['--sir-home']).toBe('#003399');
    expect(p.light['--sir-on-home']).toBe('#ffffff');
    expect(p.light['--sir-on-accent']).toBe('#000000');
    for (const key of ['--sir-home', '--sir-primary', '--sir-accent']) {
      const color = p.dark[key] ?? '';
      expect(contrastRatio(color, DARK_SURFACE)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      const on = p.dark[key.replace('--sir-', '--sir-on-')] ?? '';
      expect(contrastRatio(on, color)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
    expect(p.light['--sir-bg']).toBe('#fff4e0');
    expect(relativeLuminance(p.dark['--sir-bg'] ?? '#ffffff')).toBeLessThan(0.02);
    expect(p.light['--sir-home-soft']).toBe(mixColors('#003399', '#ffffff', 0.16));
  });
});

describe('contrast warnings', () => {
  it('the defaults have none', () => {
    expect(brandContrastIssues({})).toEqual([]);
    expect(resolveBrandColors({})).toEqual(DEFAULT_BRAND_COLORS);
    expect(resolveBrandColors({ home: undefined, away: '#000000' })).toEqual({
      ...DEFAULT_BRAND_COLORS,
      away: '#000000',
    });
  });

  it('flags colours under 4.5:1 on the background, and a background too dark for the page text', () => {
    const issues = brandContrastIssues({ home: '#ffd400', background: '#ffffff' });
    expect(issues.map((i) => i.color)).toEqual(['home']);
    expect(issues[0]?.ratio).toBeLessThan(MIN_TEXT_CONTRAST);
    const dark = brandContrastIssues({ background: '#101010' });
    expect(dark.map((i) => i.color)).toContain('text');
  });
});
