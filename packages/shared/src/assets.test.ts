import { describe, expect, it } from 'vitest';
import {
  ASSET_NAME_MAX,
  AssetNameSchema,
  cleanAssetName,
  UpdateAssetRequestSchema,
  UploadAssetRequestSchema,
} from './assets.js';

describe('names of the uploaded files', () => {
  it('keeps only the last part of a path, without control characters and with the spaces collapsed', () => {
    expect(cleanAssetName('C:\\Users\\Luca\\Video\\ace  finale.mp4')).toBe('ace finale.mp4');
    expect(cleanAssetName('../../etc/passwd')).toBe('passwd');
    expect(cleanAssetName('  muro\u0000\u0007\n.webm ')).toBe('muro .webm');
    expect(cleanAssetName('evil\u202egpj.exe')).toBe('evilgpj.exe');
    expect(cleanAssetName('/')).toBeNull();
    expect(cleanAssetName('\u0001\u0002')).toBeNull();
  });

  it('cuts a long name to the maximum, never in the middle of a character', () => {
    const long = `${'a'.repeat(ASSET_NAME_MAX - 1)}😀😀`;
    const cleaned = cleanAssetName(long);
    expect(cleaned).toBe('a'.repeat(ASSET_NAME_MAX - 1));
    expect(AssetNameSchema.safeParse(cleanAssetName('x'.repeat(500))).success).toBe(true);
  });

  it('the schema accepts a cleaned name and refuses paths, control characters, empty and too long names', () => {
    expect(AssetNameSchema.parse('  Sigla ACE.mp4 ')).toBe('Sigla ACE.mp4');
    for (const bad of ['', '   ', 'a/b.mp4', 'a\\b.mp4', 'a\u0000b', 'a\u202eb', 'x'.repeat(ASSET_NAME_MAX + 1)])
      expect(AssetNameSchema.safeParse(bad).success).toBe(false);
  });

  it('the upload of an image takes an optional name; the change of a file needs sponsor or name', () => {
    const data = 'aGVsbG8=';
    expect(UploadAssetRequestSchema.parse({ kind: 'overlay', data }).name).toBeUndefined();
    expect(UploadAssetRequestSchema.parse({ kind: 'overlay', data, name: 'logo.png' }).name).toBe('logo.png');
    expect(UploadAssetRequestSchema.safeParse({ kind: 'overlay', data, name: '../x.png' }).success).toBe(false);
    expect(UpdateAssetRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateAssetRequestSchema.parse({ name: 'Nuovo' })).toEqual({ name: 'Nuovo' });
    expect(UpdateAssetRequestSchema.parse({ name: null })).toEqual({ name: null });
    expect(UpdateAssetRequestSchema.parse({ sponsorId: null })).toEqual({ sponsorId: null });
    expect(UpdateAssetRequestSchema.safeParse({ name: 'a/b' }).success).toBe(false);
  });
});
