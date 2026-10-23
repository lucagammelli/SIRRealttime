import type { TenantOverlaysInput } from '@arenalive/shared';
import { publicAssetPath, TenantOverlaysSchema } from '@arenalive/shared';
import type { MatchEvent, MatchState } from '@arenalive/volley-stats';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaLoader } from '../lib/overlayMedia.ts';
import { useOverlayMedia, wantedBackgrounds } from '../lib/overlayMedia.ts';
import { midMatchState } from '../test/fixtures.ts';
import { Overlay, OverlayBanner } from './Overlay.tsx';

const IMAGE = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const VIDEO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const base = midMatchState();

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

let line = 5000;
function event(kind: MatchEvent['kind']): MatchEvent {
  line += 1;
  return {
    id: `${kind}-${line}`,
    kind,
    index: line,
    set: 2,
    team: 'home',
    player: { number: 8, firstName: 'Mario', lastName: 'Rossi' },
    playerOut: null,
    homeScore: 24,
    awayScore: 20,
    count: null,
    priority: 5,
  };
}
const withEvents = (events: MatchEvent[]): MatchState => ({ ...base, events });
const config = (input: TenantOverlaysInput) => TenantOverlaysSchema.parse(input);
const WITH_BACKGROUNDS = config({
  ace: { background: { kind: 'video', assetId: VIDEO } },
  block: { background: { kind: 'image', assetId: IMAGE } },
  tie: { background: { kind: 'image', assetId: IMAGE } },
  timeout: { enabled: false, background: { kind: 'image', assetId: '00000000-0000-4000-8000-000000000000' } },
  substitution: { background: { kind: 'image', assetId: '11111111-0000-4000-8000-000000000000' } },
});

let revoked: string[];
beforeEach(() => {
  stubReducedMotion(false);
  revoked = [];
  vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: (url: string) => revoked.push(url) }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('backgrounds to preload', () => {
  it('only of the overlays on and shown on the device, each file once; no videos on the phone nor with reduced motion', () => {
    // substitution: not on the phone by default; timeout: off.
    expect(wantedBackgrounds(WITH_BACKGROUNDS, 'tablet', false)).toEqual([
      { kind: 'video', assetId: VIDEO },
      { kind: 'image', assetId: IMAGE },
      { kind: 'image', assetId: '11111111-0000-4000-8000-000000000000' },
    ]);
    expect(wantedBackgrounds(WITH_BACKGROUNDS, 'tv', false).map((b) => b.assetId)).toHaveLength(3);
    expect(wantedBackgrounds(WITH_BACKGROUNDS, 'phone', false)).toEqual([{ kind: 'image', assetId: IMAGE }]);
    expect(wantedBackgrounds(WITH_BACKGROUNDS, 'tv', true)).toEqual([
      { kind: 'image', assetId: IMAGE },
      { kind: 'image', assetId: '11111111-0000-4000-8000-000000000000' },
    ]);
    expect(wantedBackgrounds(null, 'tv', false)).toEqual([]);
  });

  it('reads them into memory at once, drops (and revokes) the ones no longer wanted, all of them at the end', async () => {
    const load = vi.fn<MediaLoader>((path) => Promise.resolve(`blob:${path}`));
    const { result, rerender, unmount } = renderHook(({ c }) => useOverlayMedia(c, 'tablet', false, load), {
      initialProps: { c: WITH_BACKGROUNDS },
    });
    await act(() => Promise.resolve());
    expect(load.mock.calls.map((c) => c[0])).toEqual([
      publicAssetPath(VIDEO),
      publicAssetPath(IMAGE),
      publicAssetPath('11111111-0000-4000-8000-000000000000'),
    ]);
    expect(result.current.get(VIDEO)).toEqual({ kind: 'video', url: `blob:${publicAssetPath(VIDEO)}` });
    // The video is taken away: its URL is revoked, the image stays (not read again).
    rerender({ c: config({ block: { background: { kind: 'image', assetId: IMAGE } } }) });
    await act(() => Promise.resolve());
    expect(revoked).toContain(`blob:${publicAssetPath(VIDEO)}`);
    expect(revoked).not.toContain(`blob:${publicAssetPath(IMAGE)}`);
    expect(result.current.has(VIDEO)).toBe(false);
    expect(result.current.get(IMAGE)?.kind).toBe('image');
    expect(load).toHaveBeenCalledTimes(3);
    unmount();
    expect(revoked).toContain(`blob:${publicAssetPath(IMAGE)}`);
  });

  it('a file that cannot be read is simply missing', async () => {
    const load = vi.fn<MediaLoader>(() => Promise.resolve(null));
    const { result } = renderHook(() => useOverlayMedia(WITH_BACKGROUNDS, 'tv', false, load));
    await act(() => Promise.resolve());
    expect(result.current.size).toBe(0);
  });
});

describe('drawing an overlay with a background', () => {
  it('image: larger box, the image behind the text under a veil of the team colour', () => {
    render(<OverlayBanner text="MURO" team="away" device="tv" media={{ kind: 'image', url: 'blob:img' }} />);
    const box = document.querySelector('[data-overlay="away"]');
    expect(box?.getAttribute('data-background')).toBe('image');
    expect(box?.className).toContain('aspect-video');
    expect(box?.querySelector('img')?.getAttribute('src')).toBe('blob:img');
    expect(box?.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(box?.querySelector('.bg-away\\/65')).not.toBeNull();
    expect(box?.textContent).toBe('MURO');
  });

  it('video: muted, inline, in a loop, playing by itself; with reduced motion only the text', () => {
    const view = render(
      <OverlayBanner text="ACE" team="home" device="tablet" media={{ kind: 'video', url: 'blob:vid' }} />,
    );
    const video = document.querySelector('video');
    expect(video?.getAttribute('src')).toBe('blob:vid');
    expect(video?.muted).toBe(true);
    expect(video?.hasAttribute('playsinline')).toBe(true);
    expect(video?.loop).toBe(true);
    expect(video?.autoplay).toBe(true);
    view.unmount();
    stubReducedMotion(true);
    render(<OverlayBanner text="ACE" team="home" device="tablet" media={{ kind: 'video', url: 'blob:vid' }} />);
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('[data-overlay]')?.hasAttribute('data-background')).toBe(false);
  });

  it('on the phone a video background is never drawn (text only), an image one is', () => {
    stubReducedMotion(false);
    const view = render(
      <OverlayBanner text="ACE" team="home" device="phone" media={{ kind: 'video', url: 'blob:vid' }} />,
    );
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('[data-overlay]')?.textContent).toBe('ACE');
    view.unmount();
    render(<OverlayBanner text="MURO" team="home" device="phone" media={{ kind: 'image', url: 'blob:img' }} />);
    expect(document.querySelector('[data-background="image"] img')?.getAttribute('src')).toBe('blob:img');
  });

  it('the page on the phone does not even download a video background', async () => {
    const load = vi.fn<MediaLoader>((path) => Promise.resolve(`blob:${path}`));
    const { result } = renderHook(() => useOverlayMedia(WITH_BACKGROUNDS, 'phone', false, load));
    await act(() => Promise.resolve());
    expect(load.mock.calls.map((c) => c[0])).toEqual([publicAssetPath(IMAGE)]);
    expect(result.current.has(VIDEO)).toBe(false);
  });

  it('the page preloads the backgrounds; an overlay whose file is not ready yet goes out with the text only', async () => {
    let finish: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn((path: string) =>
      path === publicAssetPath(IMAGE)
        ? Promise.resolve(new Response(new Blob(['x'], { type: 'image/png' })))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:ready' }));
    const element = (s: MatchState, live: boolean) => (
      <Overlay state={s} live={live} config={WITH_BACKGROUNDS} device="tv" />
    );
    const view = render(element(withEvents([]), false));
    // Read at once, before any event.
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(publicAssetPath(VIDEO));
    await act(() => Promise.resolve());
    view.rerender(element(withEvents([event('ace')]), true));
    // The video is still downloading: text only.
    expect(document.querySelector('[data-overlay]')?.textContent).toBe('ACE! Rossi');
    expect(document.querySelector('video')).toBeNull();
    finish(new Response(new Blob(['v'], { type: 'video/mp4' })));
    view.unmount();
    const again = render(element(withEvents([]), false));
    await act(() => Promise.resolve());
    again.rerender(element(withEvents([event('block')]), true));
    expect(document.querySelector('[data-background="image"] img')?.getAttribute('src')).toBe('blob:ready');
  });
});
