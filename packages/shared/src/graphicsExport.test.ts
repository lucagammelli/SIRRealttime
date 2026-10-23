import { describe, expect, it } from 'vitest';
import {
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  GRAPHICS_EXPORT_FORMAT,
  graphicsImageIds,
  isGraphicsExportFormat,
  GraphicsExportSchema,
  remapGraphicsImageIds,
} from './index.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const A2 = '33333333-3333-4333-8333-333333333333';
const B2 = '44444444-4444-4444-8444-444444444444';
const DATA = 'iVBORw0KGgo=';

const base = () => ({
  format: 'arenalive-grafica',
  version: 1,
  exportedAt: '2026-10-18T10:00:00.000Z',
  sourceName: 'SIR VOLLEY',
  branding: defaultBranding(),
  layout: defaultLayout(),
  intermissions: defaultIntermissions(),
  overlays: defaultOverlays(),
  images: [] as unknown[],
});

describe('GraphicsExportSchema', () => {
  it('accepts a package without images', () => {
    expect(GraphicsExportSchema.safeParse(base()).success).toBe(true);
  });

  it('reads a package of the older name (before ArenaLive) as a current one', () => {
    const parsed = GraphicsExportSchema.parse({ ...base(), format: 'sirrealtime-grafica' });
    expect(parsed.format).toBe(GRAPHICS_EXPORT_FORMAT);
    expect(isGraphicsExportFormat('sirrealtime-grafica')).toBe(true);
    expect(isGraphicsExportFormat(GRAPHICS_EXPORT_FORMAT)).toBe(true);
    expect(isGraphicsExportFormat('altro')).toBe(false);
  });

  it('imports a package made before the size of the pauses and the display of the sponsors with their defaults', () => {
    const old = base();
    const intermissions = structuredClone(old.intermissions) as unknown as Record<string, Record<string, unknown>>;
    for (const kind of ['timeout', 'setBreak', 'matchEnd', 'milestone']) {
      const pause = intermissions[kind];
      if (!pause) throw new Error('missing pause');
      delete pause.fullscreenSize;
      for (const slide of pause.slides as { type: string; options: Record<string, unknown> }[])
        if (slide.type === 'sponsor') delete slide.options.display;
    }
    const parsed = GraphicsExportSchema.parse({ ...old, intermissions });
    expect(parsed.intermissions.setBreak.fullscreenSize).toBe('normal');
    const sponsor = parsed.intermissions.timeout.slides.find((s) => s.type === 'sponsor');
    expect(sponsor?.type === 'sponsor' && sponsor.options.display).toBe('rotate');
  });

  it('refuses another format or version', () => {
    expect(GraphicsExportSchema.safeParse({ ...base(), version: 2 }).success).toBe(false);
    expect(GraphicsExportSchema.safeParse({ ...base(), format: 'altro' }).success).toBe(false);
  });

  it('requires the images the documents use, with the right kind, and nothing else', () => {
    const withLogo = { ...base(), branding: { ...defaultBranding(), logoMain: A } };
    expect(GraphicsExportSchema.safeParse(withLogo).success).toBe(false);
    const ok = { ...withLogo, images: [{ id: A, kind: 'logo', mime: 'image/png', data: DATA }] };
    expect(GraphicsExportSchema.safeParse(ok).success).toBe(true);
    const wrongKind = { ...withLogo, images: [{ id: A, kind: 'sponsor', mime: 'image/png', data: DATA }] };
    expect(GraphicsExportSchema.safeParse(wrongKind).success).toBe(false);
    const extra = { ...ok, images: [...ok.images, { id: B, kind: 'logo', mime: 'image/png', data: DATA }] };
    expect(GraphicsExportSchema.safeParse(extra).success).toBe(false);
  });

  it('refuses unknown fields', () => {
    expect(GraphicsExportSchema.safeParse({ ...base(), hostnames: ['x'] }).success).toBe(false);
  });
});

describe('remapGraphicsImageIds', () => {
  it('replaces the ids in branding, layout and pauses without touching the input', () => {
    const layout = defaultLayout();
    const sponsor = layout.tv.find((b) => b.type === 'sponsor');
    if (sponsor?.type === 'sponsor') sponsor.options.images = [B];
    else layout.tv.push({ id: 'sp', type: 'sponsor', options: { images: [B], seconds: 5 } } as never);
    const docs = { branding: { ...defaultBranding(), logoMain: A }, layout, intermissions: defaultIntermissions() };
    docs.intermissions.timeout.slides.push({ type: 'sponsor', options: { images: [A], seconds: 5 } } as never);
    docs.intermissions.afterMatch.image = B;
    const out = remapGraphicsImageIds(
      docs,
      new Map([
        [A, A2],
        [B, B2],
      ]),
    );
    expect(out.branding.logoMain).toBe(A2);
    expect(out.intermissions.afterMatch.image).toBe(B2);
    expect(graphicsImageIds(out).sort()).toEqual([A2, B2].sort());
    expect(graphicsImageIds(docs).sort()).toEqual([A, B].sort());
  });

  it('fails on an id missing from the map', () => {
    const docs = {
      branding: { ...defaultBranding(), logoMain: A },
      layout: defaultLayout(),
      intermissions: defaultIntermissions(),
    };
    expect(() => remapGraphicsImageIds(docs, new Map())).toThrow();
  });
});
