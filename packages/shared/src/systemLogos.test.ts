import { describe, expect, it } from 'vitest';
import {
  SystemLogoSlotParamSchema,
  systemLogoFits,
  systemLogoPath,
  SystemLogosSchema,
  UploadSystemLogoRequestSchema,
} from './systemLogos.js';

describe('system logos', () => {
  it('fit in 150×50 px at most', () => {
    expect(systemLogoFits(150, 50)).toBe(true);
    expect(systemLogoFits(1, 1)).toBe(true);
    expect(systemLogoFits(151, 50)).toBe(false);
    expect(systemLogoFits(150, 51)).toBe(false);
  });

  it('two slots, left and right; base64 only, no other field', () => {
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'left' }).success).toBe(true);
    expect(SystemLogoSlotParamSchema.safeParse({ slot: 'center' }).success).toBe(false);
    expect(UploadSystemLogoRequestSchema.safeParse({ data: 'iVBORw0KGgo=' }).success).toBe(true);
    expect(UploadSystemLogoRequestSchema.safeParse({ data: 'non base64!' }).success).toBe(false);
    expect(UploadSystemLogoRequestSchema.safeParse({ data: 'iVBORw0KGgo=', kind: 'logo' }).success).toBe(false);
  });

  it('public answer: a logo or null for each side', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect(systemLogoPath(id)).toBe(`/api/public/system-logos/${id}`);
    const logos = { left: { url: systemLogoPath(id), mime: 'image/png', width: 150, height: 50 }, right: null };
    expect(SystemLogosSchema.parse(logos)).toEqual(logos);
    expect(SystemLogosSchema.safeParse({ left: null }).success).toBe(false);
  });
});
