import type { TenantOverlaysInput } from '@arenalive/shared';
import { publicAssetPath, TenantOverlaysSchema } from '@arenalive/shared';
import type { MatchEvent, MatchState } from '@arenalive/volley-stats';
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaLoader } from '../lib/overlayMedia.ts';
import { claimOurSide } from '../lib/branding.ts';
import { sampleEvent, videoHoldSeconds } from '../lib/overlay.ts';
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
function event(kind: MatchEvent['kind'], team: MatchEvent['team'] = 'home'): MatchEvent {
  line += 1;
  return {
    id: `${kind}-${line}`,
    kind,
    index: line,
    set: 2,
    team,
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
  it('only of the overlays on and shown on the device, each file once; videos also on the phone, none with reduced motion', () => {
    // substitution: not on the phone by default; timeout: off.
    const files = (list: { kind: string; assetId: string }[]) => list.map(({ kind, assetId }) => ({ kind, assetId }));
    expect(files(wantedBackgrounds(WITH_BACKGROUNDS, 'tablet', false))).toEqual([
      { kind: 'video', assetId: VIDEO },
      { kind: 'image', assetId: IMAGE },
      { kind: 'image', assetId: '11111111-0000-4000-8000-000000000000' },
    ]);
    expect(wantedBackgrounds(WITH_BACKGROUNDS, 'tv', false).map((b) => b.assetId)).toHaveLength(3);
    expect(files(wantedBackgrounds(WITH_BACKGROUNDS, 'phone', false))).toEqual([
      { kind: 'video', assetId: VIDEO },
      { kind: 'image', assetId: IMAGE },
    ]);
    expect(files(wantedBackgrounds(WITH_BACKGROUNDS, 'tv', true))).toEqual([
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
  it('image: larger box, the image behind the text, no veil, a band behind the text', () => {
    render(<OverlayBanner text="MURO" team="away" device="tv" media={{ kind: 'image', url: 'blob:img' }} />);
    const box = document.querySelector('[data-overlay="away"]');
    expect(box?.getAttribute('data-background')).toBe('image');
    expect(box?.className).toContain('aspect-video');
    expect(box?.querySelector('img')?.getAttribute('src')).toBe('blob:img');
    expect(box?.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(box?.querySelector('.bg-away\\/65')).toBeNull();
    expect(box?.querySelector('[data-player-text="shown"]')?.className).toContain('bg-away/60');
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

  it('on the phone a video background is drawn like an image one, but not with reduced motion', () => {
    stubReducedMotion(false);
    const view = render(
      <OverlayBanner text="ACE" team="home" device="phone" media={{ kind: 'video', url: 'blob:vid' }} />,
    );
    expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:vid');
    view.unmount();
    stubReducedMotion(true);
    const reduced = render(
      <OverlayBanner text="ACE" team="home" device="phone" media={{ kind: 'video', url: 'blob:vid' }} />,
    );
    expect(document.querySelector('video')).toBeNull();
    expect(document.querySelector('[data-overlay]')?.textContent).toBe('ACE');
    reduced.unmount();
    stubReducedMotion(false);
    render(<OverlayBanner text="MURO" team="home" device="phone" media={{ kind: 'image', url: 'blob:img' }} />);
    expect(document.querySelector('[data-background="image"] img')?.getAttribute('src')).toBe('blob:img');
  });

  it('the page on the phone downloads a video background too', async () => {
    const load = vi.fn<MediaLoader>((path) => Promise.resolve(`blob:${path}`));
    const { result } = renderHook(() => useOverlayMedia(WITH_BACKGROUNDS, 'phone', false, load));
    await act(() => Promise.resolve());
    expect(load.mock.calls.map((c) => c[0])).toContain(publicAssetPath(VIDEO));
    expect(result.current.has(VIDEO)).toBe(true);
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
    const release = claimOurSide('home');
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
    release();
  });
});

describe('options of a video background', () => {
  let play: ReturnType<typeof vi.fn<() => Promise<void>>>;
  beforeEach(() => {
    play = vi.fn<() => Promise<void>>(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  });
  afterEach(() => vi.restoreAllMocks());

  it('with the sound on the video is not muted; muted again without errors when the browser refuses the sound', async () => {
    const view = render(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:v', audio: true }} />,
    );
    const video = document.querySelector('video');
    expect(video?.muted).toBe(false);
    expect(video?.dataset.audio).toBe('on');
    await act(() => Promise.resolve());
    expect(video?.muted).toBe(false);
    view.unmount();

    play.mockImplementationOnce(() => Promise.reject(new DOMException('no sound', 'NotAllowedError')));
    render(<OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:w', audio: true }} />);
    const refused = document.querySelector('video');
    await act(() => Promise.resolve());
    expect(refused?.muted).toBe(true);
    // Started again, muted.
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('without the sound (default) the video stays muted', () => {
    render(<OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:v' }} />);
    expect(document.querySelector('video')?.muted).toBe(true);
    expect(document.querySelector('video')?.dataset.audio).toBe('off');
  });

  it('«A tutto schermo»: the video covers the whole screen; «Al centro»: the box as before', () => {
    const view = render(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:v', fit: 'fullscreen' }} />,
    );
    const box = document.querySelector('[data-overlay]');
    expect(box?.getAttribute('data-fit')).toBe('fullscreen');
    expect(box?.className).toContain('fixed inset-0');
    expect(box?.className).not.toContain('aspect-video');
    expect(box?.textContent).toBe('ACE');
    view.unmount();
    render(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:v', fit: 'center' }} />,
    );
    expect(document.querySelector('[data-overlay]')?.className).toContain('aspect-video');
    expect(document.querySelector('[data-overlay]')?.getAttribute('data-fit')).toBe('center');
  });

  it('another file is a new video element (the preview never keeps showing the first one)', () => {
    const view = render(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: '/api/admin/assets/a/file' }} />,
    );
    const first = document.querySelector('video');
    view.rerender(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: '/api/admin/assets/b/file' }} />,
    );
    const second = document.querySelector('video');
    expect(second).not.toBe(first);
    expect(second?.getAttribute('src')).toBe('/api/admin/assets/b/file');
  });

  it('a video for our team only: an event of the opponent shows the text only, at home or away; unknown side: text only', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Blob(['v'], { type: 'video/mp4' }))));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:video' }));
    const run = async (teams: 'ours' | 'both', ourSide: 'home' | 'away' | null, team: 'home' | 'away') => {
      const release = claimOurSide(ourSide);
      const c = config({ ace: { background: { kind: 'video', assetId: VIDEO, teams } } });
      const view = render(<Overlay state={withEvents([])} live={false} config={c} device="tv" />);
      await act(() => Promise.resolve());
      await act(() => Promise.resolve());
      view.rerender(<Overlay state={withEvents([event('ace', team)])} live config={c} device="tv" />);
      const box = document.querySelector(`[data-overlay="${team}"]`);
      const result = { text: box?.textContent, video: box?.querySelector('video')?.getAttribute('src') ?? null };
      view.unmount();
      release();
      return result;
    };
    const textOnly = { text: 'ACE! Rossi', video: null };
    const withVideo = { text: 'ACE! Rossi', video: 'blob:video' };
    // Our team at home: the ace of the away side has no video; our team away: the one of the home side.
    expect(await run('ours', 'home', 'away')).toEqual(textOnly);
    expect(await run('ours', 'home', 'home')).toEqual(withVideo);
    expect(await run('ours', 'away', 'home')).toEqual(textOnly);
    expect(await run('ours', 'away', 'away')).toEqual(withVideo);
    // Our team not recognized in the match: no video for our team only.
    expect(await run('ours', null, 'away')).toEqual(textOnly);
    expect(await run('both', 'home', 'away')).toEqual(withVideo);
  });

  it('fixed image: only for our team, text only for the opponent and with our side unknown', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Blob(['i'], { type: 'image/png' }))));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:img' }));
    const run = async (ourSide: 'home' | 'away' | null, team: 'home' | 'away') => {
      const release = claimOurSide(ourSide);
      const c = config({ ace: { background: { kind: 'image', assetId: VIDEO } } });
      const view = render(<Overlay state={withEvents([])} live={false} config={c} device="tv" />);
      await act(() => Promise.resolve());
      await act(() => Promise.resolve());
      view.rerender(<Overlay state={withEvents([event('ace', team)])} live config={c} device="tv" />);
      const box = document.querySelector(`[data-overlay="${team}"]`);
      const result = box?.querySelector('img')?.getAttribute('src') ?? null;
      view.unmount();
      release();
      return result;
    };
    expect(await run('home', 'home')).toBe('blob:img');
    expect(await run('home', 'away')).toBeNull();
    expect(await run('away', 'away')).toBe('blob:img');
    expect(await run(null, 'home')).toBeNull();
  });

  it('fixed background: never a veil; without text clean (screen readers only), with text a band behind it', () => {
    const hidden = render(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'image', url: 'blob:i', showText: false }} />,
    );
    expect(document.querySelector('[data-overlay] .bg-home\\/65')).toBeNull();
    expect(document.querySelector('[data-player-text="hidden"]')?.className).toContain('sr-only');
    expect(document.querySelector('[data-overlay]')?.textContent).toBe('ACE');
    hidden.unmount();
    render(<OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'image', url: 'blob:i' }} />);
    expect(document.querySelector('[data-overlay] .bg-home\\/65')).toBeNull();
    expect(document.querySelector('[data-player-text="shown"]')?.className).toContain('bg-home/60');
  });

  it('full screen: the picture fits whole (contain) over a fill, never cropped; in the box it covers', () => {
    const image = render(
      <OverlayBanner
        text="ACE"
        team="home"
        device="tv"
        media={{ kind: 'image', url: 'blob:i', fit: 'fullscreen', player: { showText: true } }}
      />,
    );
    const imgs = [...document.querySelectorAll('[data-fit="fullscreen"] img')];
    expect(imgs.map((i) => i.className.includes('object-contain'))).toEqual([false, true]);
    expect(document.querySelector('[data-fill="blur"] img')?.className).toContain('blur');
    image.unmount();
    const video = render(
      <OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:v', fit: 'fullscreen' }} />,
    );
    expect(document.querySelector('video')?.className).toContain('object-contain');
    expect(document.querySelector('[data-fill="color"]')?.className).toContain('bg-bg');
    video.unmount();
    render(<OverlayBanner text="ACE" team="home" device="tv" media={{ kind: 'video', url: 'blob:v' }} />);
    expect(document.querySelector('video')?.className).toContain('object-cover');
    expect(document.querySelector('[data-fill]')).toBeNull();
  });

  it('«Quanto il video»: the video plays once and reports its length and its end; otherwise it loops', () => {
    const onLength = vi.fn();
    const onEnd = vi.fn();
    const view = render(
      <OverlayBanner
        text="ACE"
        team="home"
        device="tv"
        media={{ kind: 'video', url: 'blob:v', duration: 'video' }}
        onVideoLength={onLength}
        onVideoEnd={onEnd}
      />,
    );
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video.loop).toBe(false);
    Object.defineProperty(video, 'duration', { value: 7.5, configurable: true });
    fireEvent.loadedMetadata(video);
    expect(onLength).toHaveBeenLastCalledWith(7.5);
    fireEvent.error(video);
    expect(onLength).toHaveBeenLastCalledWith(null);
    fireEvent.ended(video);
    expect(onEnd).toHaveBeenCalledTimes(1);
    view.unmount();
    render(
      <OverlayBanner
        text="ACE"
        team="home"
        device="tv"
        media={{ kind: 'video', url: 'blob:v', duration: 'seconds' }}
        onVideoLength={onLength}
        onVideoEnd={onEnd}
      />,
    );
    const looping = document.querySelector('video') as HTMLVideoElement;
    expect(looping.loop).toBe(true);
    fireEvent.ended(looping);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('the length of an overlay that follows its video: the video, at most 30 s, the seconds when it cannot be read', () => {
    expect(videoHoldSeconds(12, 6)).toBe(12);
    expect(videoHoldSeconds(120, 6)).toBe(30);
    for (const bad of [null, undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY])
      expect(videoHoldSeconds(bad, 6)).toBe(6);
  });

  describe('overlay that lasts as long as its video', () => {
    const SECONDS = 4;
    async function show(background: { duration: 'seconds' | 'video' }, reduced = false) {
      stubReducedMotion(reduced);
      vi.stubGlobal('fetch', () => Promise.resolve(new Response(new Blob(['v'], { type: 'video/mp4' }))));
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:video' }));
      vi.useFakeTimers();
      const release = claimOurSide('home');
      const c = config({ ace: { seconds: SECONDS, background: { kind: 'video', assetId: VIDEO, ...background } } });
      const view = render(<Overlay state={withEvents([])} live={false} config={c} device="tv" />);
      await act(() => Promise.resolve());
      await act(() => Promise.resolve());
      view.rerender(<Overlay state={withEvents([event('ace')])} live config={c} device="tv" />);
      return { view, release };
    }
    const on = () => document.querySelector('[data-overlay]') !== null;
    const tick = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });
    const metadata = (seconds: number) => {
      const video = document.querySelector('video') as HTMLVideoElement;
      Object.defineProperty(video, 'duration', { value: seconds, configurable: true });
      fireEvent.loadedMetadata(video);
    };

    it('stays for the length of the video, then goes', async () => {
      const { release } = await show({ duration: 'video' });
      metadata(10);
      tick(9_900);
      expect(on()).toBe(true);
      tick(1_000);
      expect(on()).toBe(false);
      release();
    });

    it('goes at once when the video ends', async () => {
      const { release } = await show({ duration: 'video' });
      metadata(10);
      tick(3_000);
      fireEvent.ended(document.querySelector('video') as HTMLVideoElement);
      expect(on()).toBe(false);
      release();
    });

    it('never longer than 30 s, even if the video is longer', async () => {
      const { release } = await show({ duration: 'video' });
      metadata(120);
      tick(30_000);
      expect(on()).toBe(true);
      tick(1_000);
      expect(on()).toBe(false);
      release();
    });

    it('with a length that cannot be read, or a video that does not start: the seconds of the overlay', async () => {
      const { release } = await show({ duration: 'video' });
      metadata(Number.NaN);
      tick(3_900);
      expect(on()).toBe(true);
      tick(200);
      expect(on()).toBe(false);
      release();
    });

    it('«Secondi impostati» (default): the seconds of the overlay, the video loops', async () => {
      const { release } = await show({ duration: 'seconds' });
      expect((document.querySelector('video') as HTMLVideoElement).loop).toBe(true);
      tick(3_900);
      expect(on()).toBe(true);
      tick(200);
      expect(on()).toBe(false);
      release();
    });

    it('with reduced motion (no video shown): the seconds of the overlay', async () => {
      const { release } = await show({ duration: 'video' }, true);
      expect(document.querySelector('video')).toBeNull();
      tick(3_900);
      expect(on()).toBe(true);
      tick(200);
      expect(on()).toBe(false);
      release();
    });
  });

  it('the example event of the Studio is of the side asked (our team), with one of its players', () => {
    const away = sampleEvent('ace', base, 'away');
    expect(away.team).toBe('away');
    expect(away.player?.number).toBe(base.players.away[0]?.number);
    expect(sampleEvent('ace', base).team).toBe('home');
  });
});
