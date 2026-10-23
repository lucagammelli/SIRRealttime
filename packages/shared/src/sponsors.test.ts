import { describe, expect, it } from 'vitest';
import {
  CreateSponsorRequestSchema,
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  GraphicsExportSchema,
  graphicsSponsorIds,
  intermissionSponsorIds,
  isSponsorWebsite,
  layoutSponsorIds,
  PublicSponsorSchema,
  PublicTenantResponseSchema,
  remapGraphicsSponsorIds,
  resolveIntermissions,
  resolveLayout,
  SponsorOptionsSchema,
  SponsorOrderRequestSchema,
  UpdateAssetRequestSchema,
  UpdateSponsorRequestSchema,
  UploadAssetRequestSchema,
} from './index.js';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const IMG = '33333333-3333-4333-8333-333333333333';
const S3 = '44444444-4444-4444-8444-444444444444';
const DATA = 'iVBORw0KGgo=';

/** Layout whose TV page has one sponsor block choosing `sponsors`. */
const layoutWith = (sponsors: string[]) =>
  resolveLayout({ tv: [{ id: 'sp', type: 'sponsor', options: { sponsors } }] });

describe('sponsor contracts', () => {
  it('accepts only https websites without credentials', () => {
    expect(isSponsorWebsite('https://bar.example.it/promo')).toBe(true);
    for (const bad of ['http://bar.example.it', 'javascript:alert(1)', 'bar.example.it', 'https://u:p@x.it', ''])
      expect(isSponsorWebsite(bad)).toBe(false);
    expect(CreateSponsorRequestSchema.parse({ name: '  Bar  ' })).toEqual({ name: 'Bar', website: null });
    expect(CreateSponsorRequestSchema.parse({ name: 'Bar', website: ' HTTPS://Bar.Example.IT ' }).website).toBe(
      'https://bar.example.it/',
    );
    expect(
      PublicSponsorSchema.safeParse({ id: S1, name: 'Bar', website: 'javascript:alert(1)', images: [] }).success,
    ).toBe(false);
    expect(CreateSponsorRequestSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
    expect(CreateSponsorRequestSchema.safeParse({ name: 'Bar', extra: 1 }).success).toBe(false);
    expect(UpdateSponsorRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateSponsorRequestSchema.parse({ website: null })).toEqual({ website: null });
    expect(SponsorOrderRequestSchema.safeParse({ ids: [S1, S1] }).success).toBe(false);
  });

  it('takes an optional sponsor at the upload and in the change of an image', () => {
    expect(UploadAssetRequestSchema.parse({ kind: 'sponsor', data: DATA, sponsorId: S1 })).toMatchObject({
      sponsorId: S1,
    });
    expect(UploadAssetRequestSchema.parse({ kind: 'sponsor', data: DATA }).sponsorId).toBeUndefined();
    expect(UpdateAssetRequestSchema.parse({ sponsorId: null })).toEqual({ sponsorId: null });
    expect(UpdateAssetRequestSchema.safeParse({}).success).toBe(false);
  });

  it('reads a layout and pauses saved before the sponsors (only images) with no sponsor', () => {
    const old = { tv: [{ id: 'sp', type: 'sponsor', options: { images: [IMG], seconds: 5 } }] };
    const layout = resolveLayout(old);
    expect(layout.tv[0]).toMatchObject({ options: { sponsors: [], images: [IMG], seconds: 5 } });
    expect(SponsorOptionsSchema.parse({})).toEqual({ sponsors: [], images: [], seconds: 8, display: 'rotate' });
    expect(SponsorOptionsSchema.safeParse({ sponsors: [S1, S1] }).success).toBe(false);
    const pauses = resolveIntermissions({
      timeout: { slides: [{ id: 'sp', type: 'sponsor', options: { sponsors: [S2] } }] },
    });
    expect(intermissionSponsorIds(pauses)).toEqual([S2]);
    expect(layoutSponsorIds(layoutWith([S1, S2]))).toEqual([S1, S2]);
    // An older public answer has no sponsors.
    expect(
      PublicTenantResponseSchema.parse({
        name: 'X',
        branding: defaultBranding(),
        images: {
          logoMain: null,
          logoMark: null,
          sponsorLogo: null,
        },
      }).sponsors,
    ).toEqual([]);
  });
});

describe('sponsors in the graphics package', () => {
  const base = () => ({
    format: 'arenalive-grafica',
    version: 1,
    exportedAt: '2026-10-18T10:00:00.000Z',
    sourceName: 'SIR VOLLEY',
    branding: defaultBranding(),
    layout: layoutWith([S1]),
    intermissions: defaultIntermissions(),
    overlays: defaultOverlays(),
    images: [{ id: IMG, kind: 'sponsor', mime: 'image/png', data: DATA }] as unknown[],
    sponsors: [{ id: S1, name: 'Bar', website: 'https://bar.it', imageIds: [IMG] }] as unknown[],
  });

  it('requires the sponsors chosen, with their sponsor images, and nothing else', () => {
    expect(GraphicsExportSchema.safeParse(base()).success).toBe(true);
    expect(GraphicsExportSchema.safeParse({ ...base(), sponsors: [] }).success).toBe(false);
    expect(GraphicsExportSchema.safeParse({ ...base(), images: [] }).success).toBe(false);
    const logoImage = { ...base(), images: [{ id: IMG, kind: 'logo', mime: 'image/png', data: DATA }] };
    expect(GraphicsExportSchema.safeParse(logoImage).success).toBe(false);
    const unused = {
      ...base(),
      sponsors: [...base().sponsors, { id: S2, name: 'Altro', website: null, imageIds: [] }],
    };
    expect(GraphicsExportSchema.safeParse(unused).success).toBe(false);
    // A package made before the sponsors: no sponsors.
    const { sponsors: _none, ...older } = { ...base(), layout: defaultLayout(), images: [] };
    expect(GraphicsExportSchema.parse(older).sponsors).toEqual([]);
  });

  it('maps the sponsor ids of layout and pauses', () => {
    const docs = { layout: layoutWith([S1]), intermissions: defaultIntermissions() };
    const out = remapGraphicsSponsorIds(docs, new Map([[S1, S3]]));
    expect(graphicsSponsorIds(out)).toEqual([S3]);
    expect(graphicsSponsorIds(docs)).toEqual([S1]);
    expect(() => remapGraphicsSponsorIds(docs, new Map())).toThrow();
  });
});
