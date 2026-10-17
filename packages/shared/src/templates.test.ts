import { describe, expect, it } from 'vitest';
import {
  brandContrastIssues,
  brandPalette,
  contrastRatio,
  DEFAULT_BRAND_COLORS,
  DARK_BACKGROUND,
  DARK_SURFACE,
  DEFAULT_TEMPLATE,
  defaultDeviceBlocks,
  defaultLayout,
  DeviceBlocksSchema,
  LAYOUT_DEVICES,
  MIN_TEXT_CONTRAST,
  PublicTenantResponseSchema,
  resolveBrandColors,
  resolveBranding,
  resolveLayout,
  TEMPLATE_IDS,
  TEMPLATES,
  TemplateIdSchema,
  templateOf,
  TenantBrandingSchema,
  webManifest,
} from './index.js';

describe('graphic templates', () => {
  it('has a closed list with a definition for every id', () => {
    expect(TEMPLATE_IDS).toEqual(['standard', 'sir-volley']);
    for (const id of TEMPLATE_IDS) expect(TEMPLATES[id].id).toBe(id);
    expect(TemplateIdSchema.safeParse('altro').success).toBe(false);
    expect(templateOf('altro').id).toBe(DEFAULT_TEMPLATE);
    expect(templateOf(null).id).toBe('standard');
  });

  it('forces the dark theme only for SIR VOLLEY, which has its logo and no footer credit', () => {
    expect(TEMPLATES.standard.forcedTheme).toBeNull();
    expect(TEMPLATES['sir-volley'].forcedTheme).toBe('dark');
    expect(TEMPLATES['sir-volley'].images.navbarLogo).toMatch(/^\/templates\/sir-volley\/.+\.png$/);
    expect(TEMPLATES['sir-volley'].images).toEqual({ navbarLogo: '/templates/sir-volley/logo-sir-realtime.png' });
    expect(TEMPLATES['sir-volley'].description).not.toContain('Istante');
    expect(TEMPLATES.standard.images).toEqual({ navbarLogo: null });
  });

  it('keeps the standard template equal to the defaults of the colours', () => {
    expect(TEMPLATES.standard.colors).toEqual(DEFAULT_BRAND_COLORS);
    expect(TEMPLATES.standard.darkSurface).toBe(DARK_SURFACE);
    expect(TEMPLATES.standard.darkBackground).toBe(DARK_BACKGROUND);
  });
});

describe('template in the branding', () => {
  it('reads the empty document as the standard template without a team of the client', () => {
    const branding = TenantBrandingSchema.parse({});
    expect(branding.template).toBe('standard');
    expect(branding.ourTeam).toEqual({ code: null, name: null });
    expect(resolveBranding({}).template).toBe('standard');
  });

  it('accepts a known template and refuses an unknown one', () => {
    expect(TenantBrandingSchema.parse({ template: 'sir-volley' }).template).toBe('sir-volley');
    expect(TenantBrandingSchema.safeParse({ template: 'rosso' }).success).toBe(false);
    // An invalid stored document reads as the defaults (standard).
    expect(resolveBranding({ template: 'rosso' }).template).toBe('standard');
  });

  it('keeps an older public answer readable (no template, no team)', () => {
    const parsed = PublicTenantResponseSchema.parse({
      name: 'Sir',
      branding: { version: 1, displayName: null, colors: {}, logoMain: null, logoMark: null, sponsorLogo: null },
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
    });
    expect(parsed.branding.template).toBe('standard');
    expect(parsed.branding.ourTeam.code).toBeNull();
  });
});

describe('colours of the client over a template', () => {
  it('gives our team the home colour in the standard template and the accent in SIR VOLLEY', () => {
    expect(brandPalette({ home: '#1d4ed8' }).light['--sir-our']).toBe('#1d4ed8');
    expect(brandPalette({ accent: '#c2410c' }).light['--sir-our']).toBeUndefined();
    const sir = brandPalette({ accent: '#e30613', home: '#00ff00' }, 'sir-volley');
    expect(sir.light['--sir-our']).toBe('#e30613');
    expect(sir.dark['--sir-our-soft']).toBeDefined();
    expect(brandPalette({ away: '#ffffff' }, 'sir-volley').dark['--sir-opponent']).toBe('#ffffff');
  });

  it('lightens the dark variants against the surface of the template', () => {
    const dark = brandPalette({ accent: '#e30613' }, 'sir-volley').dark;
    const accent = dark['--sir-accent'] ?? '';
    expect(contrastRatio(accent, TEMPLATES['sir-volley'].darkSurface)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it('has no contrast warnings in a template that is always dark (the palette corrects them)', () => {
    expect(brandContrastIssues({ home: '#ffff00', background: '#ffffff' })).not.toHaveLength(0);
    expect(brandContrastIssues({ home: '#ffff00', background: '#ffffff' }, 'sir-volley')).toEqual([]);
  });
});

describe('colours of a template where the client has chosen none', () => {
  it('fills the missing colours from the template, the client colours go over them', () => {
    expect(resolveBrandColors({}, 'sir-volley')).toEqual(TEMPLATES['sir-volley'].colors);
    expect(resolveBrandColors({ primary: '#b00010' }, 'sir-volley')).toEqual({
      ...TEMPLATES['sir-volley'].colors,
      primary: '#b00010',
    });
    expect(resolveBrandColors({}, 'standard')).toEqual(DEFAULT_BRAND_COLORS);
  });

  it('checks the contrast on the colours resolved with the template', () => {
    // Standard: the missing background is the one of the template (light), a yellow on it is flagged.
    expect(brandContrastIssues({ home: '#ffff00' }, 'standard').map((i) => i.color)).toEqual(['home']);
    expect(brandContrastIssues({}, 'standard')).toEqual([]);
    // Always dark: the palette corrects every colour against the dark surface, nothing to flag.
    expect(brandContrastIssues({ home: '#000000' }, 'sir-volley')).toEqual([]);
  });

  it('gives the manifest of a SIR VOLLEY client its dark background and red theme', () => {
    const sir = webManifest({ name: 'SIR', colors: {}, template: 'sir-volley', logo: null });
    expect([sir.background_color, sir.theme_color]).toEqual(['#0b0b0d', '#e30613']);
    const standard = webManifest({ name: 'SIR', colors: {}, logo: null });
    expect([standard.background_color, standard.theme_color]).toEqual(['#eef2f7', '#1d4ed8']);
  });
});

describe('default page of a template', () => {
  it('lays SIR VOLLEY out as the 16:9 mockup', () => {
    const tablet = defaultDeviceBlocks('tablet', 'sir-volley');
    expect(tablet.map((b) => [b.type, b.width])).toEqual([
      ['scoreboard', 12],
      ['momentum', 4],
      ['comparison', 4],
      ['court', 4],
      ['players', 8],
      ['rotations', 4],
    ]);
    expect(defaultDeviceBlocks('tv', 'sir-volley')).toEqual(tablet);
    expect(defaultDeviceBlocks('phone', 'sir-volley').map((b) => b.type)).toEqual([
      'scoreboard',
      'momentum',
      'comparison',
      'court',
      'rotations',
      'players',
    ]);
    for (const device of LAYOUT_DEVICES)
      expect(DeviceBlocksSchema.safeParse(defaultDeviceBlocks(device, 'sir-volley')).success).toBe(true);
  });

  it('keeps the standard defaults without a template', () => {
    expect(defaultLayout('standard')).toEqual(defaultLayout());
    expect(defaultDeviceBlocks('tablet').map((b) => b.width)).toEqual([12, 6, 6, 12, 6, 6]);
  });

  it('uses the page of the template only for the devices the client has never saved', () => {
    const saved = [{ id: 's', type: 'scoreboard' }];
    const layout = resolveLayout({ phone: saved }, 'sir-volley');
    expect(layout.phone.map((b) => b.id)).toEqual(['s']);
    expect(layout.tablet).toEqual(defaultDeviceBlocks('tablet', 'sir-volley'));
    expect(resolveLayout({}, 'sir-volley')).toEqual(defaultLayout('sir-volley'));
    expect(resolveLayout({ tv: 'rotto' }, 'sir-volley')).toEqual(defaultLayout('sir-volley'));
    expect(resolveLayout({})).toEqual(defaultLayout());
  });
});
