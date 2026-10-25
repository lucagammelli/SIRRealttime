import type { PublicPlayerMedia, PublicTenantResponse, TenantOverlaysInput } from '@arenalive/shared';
import {
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  publicAssetPath,
  TenantOverlaysSchema,
} from '@arenalive/shared';
import type { MatchEvent, MatchState } from '@arenalive/volley-stats';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimOurSide, setTenantLook, tenantLookOf } from '../lib/branding.ts';
import { overlayFor } from '../lib/overlay.ts';
import { playerNumbersInPlay, wantedBackgrounds } from '../lib/overlayMedia.ts';
import { midMatchState } from '../test/fixtures.ts';
import { Overlay, OverlayBanner } from './Overlay.tsx';

const PHOTO = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const PHOTO_2 = '4a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const VIDEO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const FIXED = '9b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const base = midMatchState();

const config = (input: TenantOverlaysInput) => TenantOverlaysSchema.parse(input);
/** Main photo PHOTO; for the ace PHOTO_2 and VIDEO, for the substitution VIDEO only, nothing for the block. */
const ROSSI: PublicPlayerMedia = {
  number: 8,
  photo: PHOTO,
  events: { ace: { photo: PHOTO_2, video: VIDEO }, substitution: { photo: null, video: VIDEO } },
};

function ace(over: Partial<MatchEvent> = {}): MatchEvent {
  return {
    id: 'ace-1',
    kind: 'ace',
    index: 9000,
    set: 2,
    team: 'home',
    player: { number: 8, firstName: 'Mario', lastName: 'Rossi' },
    playerOut: null,
    homeScore: 24,
    awayScore: 20,
    count: null,
    priority: 5,
    ...over,
  };
}
const state = (events: MatchEvent[]): MatchState => ({ ...base, events });
const roster = (videos: boolean, players: PublicPlayerMedia[] = [ROSSI]) => ({ players, videos });

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

beforeEach(() => stubReducedMotion(false));
afterEach(() => {
  cleanup();
  act(() => setTenantLook(null));
  vi.unstubAllGlobals();
});

describe('overlayFor: photo or video of the player', () => {
  const photoVideo = config({ ace: { playerMedia: { source: 'video' } } });

  it('the video of the overlay of the player of our team when videos are allowed, the photo of the overlay otherwise', () => {
    const withVideo = overlayFor(ace(), state([]), photoVideo, 'tv', 0, 'home', roster(true));
    expect(withVideo?.background).toMatchObject({ kind: 'video', assetId: VIDEO, teams: 'ours' });
    const phone = overlayFor(ace(), state([]), photoVideo, 'phone', 0, 'home', roster(false));
    expect(phone?.background).toMatchObject({ kind: 'image', assetId: PHOTO_2 });
  });

  it('«Foto del giocatore» shows the photo of the overlay, else the main photo; an old «Casuale» is the same', () => {
    const photo = config({ ace: { playerMedia: { source: 'photo' } }, block: { playerMedia: { source: 'photo' } } });
    expect(overlayFor(ace(), state([]), photo, 'tv', 0, 'home', roster(true))?.background).toMatchObject({
      kind: 'image',
      assetId: PHOTO_2,
    });
    const block = ace({ kind: 'block', id: 'block-1' });
    expect(overlayFor(block, state([]), photo, 'tv', 0, 'home', roster(true))?.background?.assetId).toBe(PHOTO);
    const random = config({ ace: { playerMedia: { source: 'photo', pick: 'random' } } });
    for (const id of ['ace-7', 'ace-8'])
      expect(overlayFor(ace({ id }), state([]), random, 'tv', 0, 'home', roster(true))?.background?.assetId).toBe(
        PHOTO_2,
      );
  });

  it('the opponent gets no photo of ours: the text only', () => {
    const c = config({
      ace: { playerMedia: { source: 'photo' }, background: { kind: 'image', assetId: FIXED } },
    });
    // The fixed background is for our team only too: the opponent gets the text only.
    expect(overlayFor(ace({ team: 'away' }), state([]), c, 'tv', 0, 'home', roster(true))?.background).toBeUndefined();
    const textOnly = config({ ace: { playerMedia: { source: 'photo' } } });
    expect(
      overlayFor(ace({ team: 'away' }), state([]), textOnly, 'tv', 0, 'home', roster(true))?.background,
    ).toBeUndefined();
    // Our side unknown: no photo of a player either.
    expect(overlayFor(ace(), state([]), textOnly, 'tv', 0, null, roster(true))?.background).toBeUndefined();
  });

  it('a player without files, or not in the roster: the fixed background of the overlay', () => {
    const c = config({
      ace: { playerMedia: { source: 'video' }, background: { kind: 'image', assetId: FIXED } },
    });
    const other = { number: 3, photo: null, events: {} };
    expect(overlayFor(ace(), state([]), c, 'tv', 0, 'home', roster(true, [other]))?.background?.assetId).toBe(FIXED);
    expect(overlayFor(ace(), state([]), c, 'tv', 0, 'home', roster(true, []))?.background?.assetId).toBe(FIXED);
    // Without the argument (as before the roster existed) nothing changes.
    expect(overlayFor(ace(), state([]), c, 'tv', 0, 'home')?.background?.assetId).toBe(FIXED);
  });

  it('the overlays that are not of a player ignore playerMedia', () => {
    const c = config({ tie: { playerMedia: { source: 'photo' } } });
    expect(overlayFor(ace({ kind: 'tie' }), state([]), c, 'tv', 0, 'home', roster(true))?.background).toBeUndefined();
  });
});

describe('photo or video of the player: clean, with or without text', () => {
  const c = (showText: boolean) => config({ ace: { playerMedia: { source: 'video', showText } } });

  it('overlayFor flags the media of the player and carries showText (true when missing)', () => {
    expect(overlayFor(ace(), state([]), c(false), 'tv', 0, 'home', roster(true))?.player).toEqual({ showText: false });
    expect(overlayFor(ace(), state([]), c(true), 'tv', 0, 'home', roster(true))?.player).toEqual({ showText: true });
    const fixed = config({ ace: { background: { kind: 'image', assetId: PHOTO } } });
    expect(overlayFor(ace(), state([]), fixed, 'tv', 0, 'home', roster(true))?.player).toBeUndefined();
  });

  const box = (player?: { showText: boolean }) => {
    const media = { kind: 'video' as const, url: 'blob:v', ...(player ? { player } : {}) };
    return render(<OverlayBanner text="ACE! Rossi" team="home" device="tv" media={media} />).container;
  };

  it('no veil over the video of a player; the text is hidden (readable by screen readers only) or on a band of its own', () => {
    const hidden = box({ showText: false });
    expect(hidden.querySelector('div[aria-hidden="true"].absolute.inset-0:not([data-fill])')).toBeNull();
    expect(hidden.querySelector('[data-player-text="hidden"]')?.className).toBe('sr-only');
    cleanup();
    const shown = box({ showText: true });
    expect(shown.querySelector('div[aria-hidden="true"].absolute.inset-0:not([data-fill])')).toBeNull();
    expect(shown.querySelector('[data-player-text="shown"]')?.textContent).toBe('ACE! Rossi');
    expect(shown.querySelector('video')?.className).not.toMatch(/opacity|blur|filter/);
  });

  it('the photo of a player fills the screen like a video; a fixed image with «A tutto schermo» does the same', () => {
    const at = (player?: { showText: boolean }) =>
      render(
        <OverlayBanner
          text="ACE! Rossi"
          team="home"
          device="tv"
          media={{ kind: 'image', url: 'blob:i', fit: 'fullscreen', ...(player ? { player } : {}) }}
        />,
      ).container;
    expect(at({ showText: true }).querySelector('[data-fit="fullscreen"]')).not.toBeNull();
    expect(
      at({ showText: true }).querySelector('div[aria-hidden="true"].absolute.inset-0:not([data-fill])'),
    ).toBeNull();
    cleanup();
    // A fixed image with «A tutto schermo» fills the screen too, whole (contain).
    expect(at().querySelector('[data-fit="fullscreen"] img.object-contain')).not.toBeNull();
  });

  it('a fixed background has no veil either: a band behind the text', () => {
    expect(box().querySelector('div[aria-hidden="true"].absolute.inset-0:not([data-fill])')).toBeNull();
    expect(box().querySelector('[data-player-text="shown"]')?.className).toContain('bg-home/60');
  });
});

describe('files of the players to keep ready', () => {
  const c = config({ ace: { playerMedia: { source: 'video' } } });
  const court = new Set([8]);
  const team = new Set([8, 3]);
  const ids = (list: { assetId: string }[]) => list.map((b) => b.assetId);

  it('only the file each overlay would show: the video when allowed, else the photo of the overlay or the main one', () => {
    expect(ids(wantedBackgrounds(c, 'tv', false, { players: [ROSSI], court, team }))).toEqual([VIDEO]);
    expect(ids(wantedBackgrounds(c, 'phone', false, { players: [ROSSI], court, team }))).toEqual([PHOTO_2]);
    expect(ids(wantedBackgrounds(c, 'tv', true, { players: [ROSSI], court, team }))).toEqual([PHOTO_2]);
    // An old «Casuale» keeps one file only.
    const random = config({ ace: { playerMedia: { source: 'video', pick: 'random' } } });
    expect(ids(wantedBackgrounds(random, 'tv', false, { players: [ROSSI], court, team }))).toEqual([VIDEO]);
    const photos = config({ ace: { playerMedia: { source: 'photo' } }, block: { playerMedia: { source: 'photo' } } });
    expect(ids(wantedBackgrounds(photos, 'tv', false, { players: [ROSSI], court, team }))).toEqual([PHOTO_2, PHOTO]);
  });

  it('ACE! and Muro for the players on court, Cambio for the whole team; only the overlays on and shown on the device', () => {
    const bench = { players: [ROSSI], court: new Set([3]), team: new Set([3, 8]) };
    expect(wantedBackgrounds(c, 'tv', false, bench)).toEqual([]);
    const sub = config({ substitution: { playerMedia: { source: 'video' } } });
    expect(ids(wantedBackgrounds(sub, 'tv', false, bench))).toEqual([VIDEO]);
    expect(wantedBackgrounds(sub, 'tv', false, { players: [ROSSI], court, team: new Set([3]) })).toEqual([]);
    const off = config({ ace: { enabled: false, playerMedia: { source: 'video' } } });
    expect(wantedBackgrounds(off, 'tv', false, { players: [ROSSI], court, team })).toEqual([]);
    const notOnPhone = config({ ace: { devices: { phone: false }, playerMedia: { source: 'video' } } });
    expect(wantedBackgrounds(notOnPhone, 'phone', false, { players: [ROSSI], court, team })).toEqual([]);
    expect(wantedBackgrounds(c, 'tv', false)).toEqual([]);
    // A player without any file: nothing to read.
    const none = { number: 8, photo: null, events: {} };
    expect(wantedBackgrounds(c, 'tv', false, { players: [none], court, team })).toEqual([]);
  });

  it('players in play: the ones on court, and the whole team with the bench', () => {
    const lineup = base.live.lineups.home.filter((n): n is number => n !== null);
    const inPlay = playerNumbersInPlay(base, 'home');
    expect([...inPlay.court].sort()).toEqual([...lineup].sort());
    expect(inPlay.team.size).toBe(new Set(base.players.home.map((p) => p.number).concat(lineup)).size);
    const unknown = playerNumbersInPlay(base, null);
    expect(unknown.court.size + unknown.team.size).toBe(0);
  });
});

describe('Overlay on the page: photo of the player of our team', () => {
  function look(players: PublicPlayerMedia[]): void {
    const tenant: PublicTenantResponse = {
      name: 'Sir',
      branding: defaultBranding(),
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
      layout: defaultLayout(),
      intermissions: defaultIntermissions(),
      overlays: config({}),
      sponsors: [],
      players,
    };
    act(() => setTenantLook(tenantLookOf(tenant)));
  }

  async function show(team: 'home' | 'away', players: PublicPlayerMedia[], device: 'tv' | 'phone' = 'tv') {
    look(players);
    const fetched: string[] = [];
    vi.stubGlobal('fetch', (path: string) => {
      fetched.push(path);
      return Promise.resolve(new Response(new Blob(['x'], { type: path.includes(VIDEO) ? 'video/mp4' : 'image/png' })));
    });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:media', revokeObjectURL: () => undefined }));
    const release = claimOurSide('home');
    const c = config({ ace: { playerMedia: { source: 'video' } } });
    const view = render(<Overlay state={state([])} live={false} config={c} device={device} />);
    await act(() => Promise.resolve());
    await act(() => Promise.resolve());
    view.rerender(
      <Overlay state={state([ace({ team, id: `a-${team}-${device}` })])} live config={c} device={device} />,
    );
    const box = document.querySelector(`[data-overlay="${team}"]`);
    const result = {
      text: box?.textContent,
      video: box?.querySelector('video') !== null,
      image: box?.querySelector('img') !== null,
      fetched,
    };
    view.unmount();
    release();
    return result;
  }

  it('our ace shows the video of the player; the file is read before the event', async () => {
    const r = await show('home', [ROSSI]);
    expect(r.video).toBe(true);
    expect(r.text).toBe('ACE! Rossi');
    expect(r.fetched).toContain(publicAssetPath(VIDEO));
  });

  it('on the phone the photo, never the video (not even downloaded)', async () => {
    const r = await show('home', [ROSSI], 'phone');
    expect(r.video).toBe(false);
    expect(r.image).toBe(true);
    expect(r.fetched).not.toContain(publicAssetPath(VIDEO));
  });

  it('the opponent ace has the text only; a player without files too', async () => {
    expect(await show('away', [ROSSI])).toMatchObject({ text: 'ACE! Rossi', video: false, image: false });
    expect(await show('home', [{ number: 8, photo: null, events: {} }])).toMatchObject({
      video: false,
      image: false,
    });
  });
});
