import { describe, expect, it } from 'vitest';
import {
  allIntermissions,
  defaultIntermission,
  defaultIntermissions,
  INTERMISSION_MAX_DELAY_SECONDS,
  INTERMISSION_MAX_SLIDES,
  intermissionFor,
  intermissionImageIds,
  IntermissionSlideSchema,
  PublicTenantResponseSchema,
  resolveIntermissions,
  SLIDE_MAX_SECONDS,
  SLIDE_MIN_SECONDS,
  SLIDE_TYPES,
  TenantIntermissionsSchema,
  THANKS_MESSAGE,
} from './index.js';

const IMG_A = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const IMG_B = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const types = (slides: readonly { type: string }[]): string[] => slides.map((s) => s.type);

describe('pauses of the public page: defaults', () => {
  it('reads the empty database document as the defaults of every pause', () => {
    const config = TenantIntermissionsSchema.parse({});
    expect(config).toEqual(defaultIntermissions());
    expect(config.version).toBe(1);
    expect(config.setBreakBySet).toEqual({});
  });

  it('time-out: compact banner with the sponsors, at once', () => {
    const { timeout } = defaultIntermissions();
    expect(timeout).toMatchObject({ enabled: true, delaySeconds: 0 });
    expect(timeout.modes).toEqual({ tv: 'banner', tablet: 'banner', phone: 'banner' });
    expect(types(timeout.slides)).toEqual(['sponsor']);
  });

  it('end of set: full screen on TV and tablet, banner on the phone, summary and sponsors after 5 s', () => {
    const { setBreak } = defaultIntermissions();
    expect(setBreak.modes).toEqual({ tv: 'fullscreen', tablet: 'fullscreen', phone: 'banner' });
    expect(setBreak.delaySeconds).toBe(5);
    expect(types(setBreak.slides)).toEqual(['setSummary', 'sponsor']);
  });

  it('end of match: full screen with result, MVP, thanks and sponsors', () => {
    const { matchEnd } = defaultIntermissions();
    expect(matchEnd.modes).toEqual({ tv: 'fullscreen', tablet: 'fullscreen', phone: 'fullscreen' });
    expect(types(matchEnd.slides)).toEqual(['finalResult', 'mvp', 'message', 'sponsor']);
    expect(matchEnd.slides[2]).toMatchObject({ options: { text: THANKS_MESSAGE, size: 'large' } });
    expect(THANKS_MESSAGE).toBe('Grazie per aver seguito la partita');
  });

  it('a partial pause takes the defaults of its own kind', () => {
    const config = TenantIntermissionsSchema.parse({
      timeout: { delaySeconds: 3 },
      setBreak: { modes: { tv: 'banner' } },
    });
    expect(config.timeout).toEqual({ ...defaultIntermission('timeout'), delaySeconds: 3 });
    expect(config.setBreak.modes).toEqual({ tv: 'banner', tablet: 'fullscreen', phone: 'banner' });
    expect(types(config.setBreak.slides)).toEqual(['setSummary', 'sponsor']);
  });

  it('every slide type has defaults and every default is a new object', () => {
    for (const type of SLIDE_TYPES) expect(IntermissionSlideSchema.safeParse({ id: type, type }).success).toBe(true);
    const a = defaultIntermissions();
    a.setBreak.slides.pop();
    expect(defaultIntermissions().setBreak.slides).toHaveLength(2);
  });
});

describe('pauses of the public page: validation', () => {
  const parse = (doc: unknown) => TenantIntermissionsSchema.safeParse(doc);

  it('refuses unknown slide types, unknown fields and other versions', () => {
    expect(parse({ timeout: { slides: [{ id: 'x', type: 'iframe' }] } }).success).toBe(false);
    expect(parse({ timeout: { html: '<b>' } }).success).toBe(false);
    expect(parse({ pause: {} }).success).toBe(false);
    expect(parse({ version: 2 }).success).toBe(false);
    expect(parse({ setBreakBySet: { '5': {} } }).success).toBe(false);
    expect(parse({ timeout: { modes: { tv: 'popup' } } }).success).toBe(false);
  });

  it('checks the limits of durations, delay and number of slides', () => {
    const slide = (seconds: number) => ({ timeout: { slides: [{ id: 's', type: 'mvp', seconds }] } });
    expect(parse(slide(SLIDE_MIN_SECONDS)).success).toBe(true);
    expect(parse(slide(SLIDE_MAX_SECONDS)).success).toBe(true);
    expect(parse(slide(SLIDE_MIN_SECONDS - 1)).success).toBe(false);
    expect(parse(slide(SLIDE_MAX_SECONDS + 1)).success).toBe(false);
    expect(parse(slide(4.5)).success).toBe(false);
    expect(parse({ setBreak: { delaySeconds: INTERMISSION_MAX_DELAY_SECONDS } }).success).toBe(true);
    expect(parse({ setBreak: { delaySeconds: INTERMISSION_MAX_DELAY_SECONDS + 1 } }).success).toBe(false);
    expect(parse({ setBreak: { delaySeconds: -1 } }).success).toBe(false);
    const many = Array.from({ length: INTERMISSION_MAX_SLIDES + 1 }, (_, i) => ({ id: `m${i}`, type: 'mvp' }));
    expect(parse({ matchEnd: { slides: many } }).success).toBe(false);
    expect(parse({ matchEnd: { slides: many.slice(1) } }).success).toBe(true);
  });

  it('refuses repeated ids and an active pause without slides (an inactive one may have none)', () => {
    const twice = [
      { id: 'a', type: 'mvp' },
      { id: 'a', type: 'qr' },
    ];
    expect(parse({ matchEnd: { slides: twice } }).success).toBe(false);
    expect(parse({ timeout: { slides: [] } }).success).toBe(false);
    expect(parse({ timeout: { enabled: false, slides: [] } }).success).toBe(true);
  });

  it('reuses the options of the blocks: plain text, existing sponsor rules', () => {
    const message = (text: string) => ({ matchEnd: { slides: [{ id: 'm', type: 'message', options: { text } }] } });
    expect(parse(message('<b>ciao</b>')).success).toBe(true);
    expect(parse(message('   ')).success).toBe(false);
    expect(parse(message('riga\nnuova')).success).toBe(false);
    const sponsor = (images: string[]) => ({
      timeout: { slides: [{ id: 's', type: 'sponsor', options: { images } }] },
    });
    expect(parse(sponsor([IMG_A, IMG_A])).success).toBe(false);
    expect(parse(sponsor(['non-un-id'])).success).toBe(false);
  });

  it('an invalid stored document reads as the defaults', () => {
    expect(resolveIntermissions({ timeout: { slides: 3 } })).toEqual(defaultIntermissions());
    expect(resolveIntermissions(null)).toEqual(defaultIntermissions());
    expect(resolveIntermissions({ timeout: { enabled: false } }).timeout.enabled).toBe(false);
  });
});

describe('pauses of the public page: inheritance and images', () => {
  const config = TenantIntermissionsSchema.parse({
    setBreak: { delaySeconds: 10, slides: [{ id: 'sp', type: 'sponsor', options: { images: [IMG_A] } }] },
    setBreakBySet: {
      '2': { slides: [{ id: 'q', type: 'qr' }], modes: { phone: 'fullscreen' } },
      '3': { enabled: false },
    },
    matchEnd: { slides: [{ id: 'sp2', type: 'sponsor', options: { images: [IMG_B, IMG_A] } }] },
  });

  it('a set without its own pause uses the generic one; a set with it uses it as a whole', () => {
    expect(intermissionFor(config, 'setBreak', 1)).toBe(config.setBreak);
    expect(intermissionFor(config, 'setBreak', 4)).toBe(config.setBreak);
    expect(intermissionFor(config, 'setBreak')).toBe(config.setBreak);
    const second = intermissionFor(config, 'setBreak', 2);
    expect(types(second?.slides ?? [])).toEqual(['qr']);
    // the own pause takes the defaults of the end of set, not the fields of the generic one
    expect(second?.delaySeconds).toBe(5);
    expect(second?.modes).toEqual({ tv: 'fullscreen', tablet: 'fullscreen', phone: 'fullscreen' });
    expect(intermissionFor(config, 'setBreak', 3)).toBeNull();
    // the 5th set never has its own pause
    expect(intermissionFor(config, 'setBreak', 5)).toBe(config.setBreak);
  });

  it('an inactive pause gives null; the other kinds ignore the set', () => {
    const off = TenantIntermissionsSchema.parse({ timeout: { enabled: false } });
    expect(intermissionFor(off, 'timeout')).toBeNull();
    expect(intermissionFor(off, 'matchEnd', 2)).toBe(off.matchEnd);
  });

  it('lists every pause and the images of every sponsor slide once', () => {
    expect(allIntermissions(config)).toHaveLength(5);
    expect(intermissionImageIds(config)).toEqual([IMG_A, IMG_B]);
    expect(intermissionImageIds(defaultIntermissions())).toEqual([]);
  });

  it('is part of the public graphics (defaults when an older answer misses it)', () => {
    const res = PublicTenantResponseSchema.parse({
      name: 'SIR',
      branding: {},
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
    });
    expect(res.intermissions).toEqual(defaultIntermissions());
  });
});
