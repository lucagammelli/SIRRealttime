import { NO_SYSTEM_LOGOS } from '@arenalive/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initSystemLogos, loadSystemLogos, setSystemLogos } from './systemLogos.ts';

const LOGO = {
  url: '/api/public/system-logos/00000000-0000-4000-8000-000000000001',
  mime: 'image/png',
  width: 10,
  height: 10,
} as const;
const ONLY_LEFT = { left: { positive: LOGO, negative: null }, right: { positive: null, negative: null } };
const ONLY_RIGHT = { left: { positive: null, negative: null }, right: { positive: null, negative: LOGO } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => setSystemLogos(NO_SYSTEM_LOGOS));

describe('loadSystemLogos', () => {
  it('reads the public list without cookies; any failure gives null', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(ONLY_LEFT));
    expect(await loadSystemLogos({ fetch })).toEqual(ONLY_LEFT);
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/public/system-logos');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' });
    expect(
      await loadSystemLogos({ fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({}, 500)) }),
    ).toBeNull();
    expect(
      await loadSystemLogos({ fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ left: 1 })) }),
    ).toBeNull();
    // The shape before the variants (one logo per side) is refused: no logo rather than a broken one.
    expect(
      await loadSystemLogos({
        fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ left: LOGO, right: null })),
      }),
    ).toBeNull();
    expect(
      await loadSystemLogos({ fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('rete')) }),
    ).toBeNull();
  });

  it('initSystemLogos keeps the logos already there when the load fails', async () => {
    setSystemLogos(ONLY_LEFT);
    await initSystemLogos({ fetch: vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('rete')) });
    const ok = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(ONLY_RIGHT));
    expect(await loadSystemLogos({ fetch: ok, fresh: true })).toEqual(ONLY_RIGHT);
    expect(ok.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-cache' });
  });
});
