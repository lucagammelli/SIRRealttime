import { describe, expect, it } from 'vitest';
import {
  hasSystemLogo,
  NO_SYSTEM_LOGOS,
  pickSystemLogo,
  SystemLogoSlotParamSchema,
  systemLogoFits,
  systemLogoPath,
  SystemLogosSchema,
  systemLogoVariantFor,
  UploadSystemLogoRequestSchema,
} from './systemLogos.js';

const logo = (id: string) => ({ url: systemLogoPath(id), mime: 'image/png' as const, width: 150, height: 50 });
const POS = logo('00000000-0000-4000-8000-000000000001');
const NEG = logo('00000000-0000-4000-8000-000000000002');

describe('system logos', () => {
  it('fit in 150×50 px at most', () => {
    expect(systemLogoFits(150, 50)).toBe(true);
    expect(systemLogoFits(1, 1)).toBe(true);
    expect(systemLogoFits(151, 50)).toBe(false);
    expect(systemLogoFits(150, 51)).toBe(false);
  });

  it('two slots × two variants; base64 only, no other field', () => {
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'left', variant: 'positive' }).success).toBe(true);
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'right', variant: 'negative' }).success).toBe(true);
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'center', variant: 'positive' }).success).toBe(false);
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'left', variant: 'grey' }).success).toBe(false);
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'left' }).success).toBe(false);
    expect(UploadSystemLogoRequestSchema.safeParse({ data: 'iVBORw0KGgo=' }).success).toBe(true);
    expect(UploadSystemLogoRequestSchema.safeParse({ data: 'non base64!' }).success).toBe(false);
    expect(UploadSystemLogoRequestSchema.safeParse({ data: 'iVBORw0KGgo=', kind: 'logo' }).success).toBe(false);
  });

  it('public answer: a logo or null for each side and variant', () => {
    expect(POS.url).toBe('/api/public/system-logos/00000000-0000-4000-8000-000000000001');
    const logos = { left: { positive: POS, negative: null }, right: { positive: null, negative: NEG } };
    expect(SystemLogosSchema.parse(logos)).toEqual(logos);
    expect(SystemLogosSchema.parse(NO_SYSTEM_LOGOS)).toEqual(NO_SYSTEM_LOGOS);
    expect(SystemLogosSchema.safeParse({ left: null, right: null }).success).toBe(false);
    expect(SystemLogosSchema.safeParse({ left: POS, right: { positive: null, negative: null } }).success).toBe(false);
  });

  it('the variant follows the background: negative on dark, positive on light or unknown', () => {
    expect(systemLogoVariantFor('#000000')).toBe('negative');
    expect(systemLogoVariantFor('#0f172a')).toBe('negative');
    expect(systemLogoVariantFor('#1d4ed8')).toBe('negative');
    expect(systemLogoVariantFor('#ffffff')).toBe('positive');
    expect(systemLogoVariantFor('#eef2f7')).toBe('positive');
    expect(systemLogoVariantFor('#FFFFFF')).toBe('positive');
    expect(systemLogoVariantFor(null)).toBe('positive');
    expect(systemLogoVariantFor('rgb(0,0,0)')).toBe('positive');
  });

  it('picks the right variant, the other one when it is missing, nothing when the side is empty', () => {
    const both = { positive: POS, negative: NEG };
    expect(pickSystemLogo(both, '#ffffff')).toEqual({ logo: POS, variant: 'positive' });
    expect(pickSystemLogo(both, '#111111')).toEqual({ logo: NEG, variant: 'negative' });
    expect(pickSystemLogo(both, null)).toEqual({ logo: POS, variant: 'positive' });
    expect(pickSystemLogo({ positive: POS, negative: null }, '#111111')).toEqual({ logo: POS, variant: 'positive' });
    expect(pickSystemLogo({ positive: null, negative: NEG }, '#ffffff')).toEqual({ logo: NEG, variant: 'negative' });
    expect(pickSystemLogo({ positive: null, negative: null }, '#ffffff')).toBeNull();
    expect(hasSystemLogo({ positive: null, negative: NEG })).toBe(true);
    expect(hasSystemLogo({ positive: null, negative: null })).toBe(false);
  });
});
