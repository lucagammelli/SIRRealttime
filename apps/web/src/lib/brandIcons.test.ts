import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeIco, extractSymbol, ICO_SIZES, squareIcon } from '../../scripts/brand-icons.ts';
import { decodePng } from '../../scripts/trim-logo.ts';

const here = dirname(fileURLToPath(import.meta.url));
const file = (relative: string): Buffer => readFileSync(resolve(here, relative));

describe('icons of ArenaLive (scripts/brand-icons.ts)', () => {
  const symbol = extractSymbol(decodePng(file('../../public/brand/arenalive-positivo.png')));

  it('takes only the green symbol at the left of the logo', () => {
    expect(symbol.width).toBeLessThan(50);
    expect(symbol.height).toBeGreaterThan(30);
    for (let i = 0; i < symbol.data.length; i += 4)
      if ((symbol.data[i + 3] ?? 0) > 200) expect(symbol.data[i + 1] ?? 0).toBeGreaterThan((symbol.data[i] ?? 0) + 40);
  });

  it('a square icon keeps the symbol centred, transparent or on the dark background', () => {
    const icon = squareIcon(symbol, 64, 0.5, null);
    expect([icon.width, icon.height]).toEqual([64, 64]);
    expect(icon.data[3]).toBe(0);
    const opaque = squareIcon(symbol, 64, 0.5, [11, 14, 19]);
    expect([...opaque.data.subarray(0, 4)]).toEqual([11, 14, 19, 255]);
    const centre = (32 * 64 + 32) * 4;
    expect(opaque.data[centre + 3]).toBe(255);
  });

  it('the .ico of the agent has one PNG entry per size (256 written as 0)', () => {
    const ico = encodeIco(ICO_SIZES.map((s) => squareIcon(symbol, s, 1, null)));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length);
    expect(ico.readUInt8(6 + 16 * (ICO_SIZES.length - 1))).toBe(0);
    const first = ico.readUInt32LE(6 + 12);
    expect(ico.subarray(first + 1, first + 4).toString('latin1')).toBe('PNG');
    const committed = file('../../../agent-dotnet/src/ArenaLive.Agent.App/arenalive-agent.ico');
    expect(committed.readUInt16LE(4)).toBe(ICO_SIZES.length);
  });

  it('the icons in public are the ones of the script (PNG of the declared size)', () => {
    for (const [name, size] of [
      ['favicon-32.png', 32],
      ['apple-touch-icon.png', 180],
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['icon-maskable-512.png', 512],
    ] as const) {
      const png = decodePng(file(`../../public/icons/${name}`));
      expect([png.width, png.height]).toEqual([size, size]);
    }
  });
});
