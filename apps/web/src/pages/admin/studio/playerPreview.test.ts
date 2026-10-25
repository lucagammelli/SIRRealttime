import type { Player } from '@arenalive/shared';
import { defaultOverlay, noPlayerEvents } from '@arenalive/shared';
import { describe, expect, it } from 'vitest';
import { midMatchState } from '../../../test/fixtures.ts';
import { overlayPreview, rosterSample } from './model.ts';
import { playerModeOf, withPlayerMode, withPlayerOptions } from './OverlaysSection.tsx';

const PHOTO = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const PHOTO_ACE = '4a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const VIDEO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const FIXED = '9b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const player = (over: Partial<Player>): Player => ({
  id: '11111111-1111-4111-8111-111111111111',
  season: 2026,
  number: 8,
  firstName: 'Mario',
  lastName: 'Rossi',
  role: null,
  birthYear: null,
  heightCm: null,
  birthplace: null,
  nationality: null,
  source: 'league',
  externalKey: null,
  editedFields: [],
  photo: null,
  media: [],
  events: noPlayerEvents(),
  removed: false,
  position: 0,
  ...over,
});
const item = (assetId: string, video: boolean) => ({ assetId, url: '/x', video, name: null });

describe('player media of an overlay (editor)', () => {
  it('the mode, and the options kept when the source changes', () => {
    const ace = defaultOverlay('ace');
    expect(playerModeOf(ace)).toBe('fixed');
    const video = withPlayerMode(ace, 'video');
    expect(playerModeOf(video)).toBe('video');
    expect(video.playerMedia).toEqual({
      source: 'video',
      audio: false,
      fit: 'center',
      duration: 'seconds',
      showText: true,
    });
    const tuned = withPlayerOptions(video, { fit: 'fullscreen', audio: true });
    expect(withPlayerMode(tuned, 'photo').playerMedia).toEqual({
      source: 'photo',
      audio: true,
      fit: 'fullscreen',
      duration: 'seconds',
      showText: true,
    });
    expect('playerMedia' in withPlayerMode(tuned, 'fixed')).toBe(false);
    // Nothing to change without player media.
    expect(withPlayerOptions(ace, { audio: true })).toBe(ace);
  });
});

describe('preview with a player of the roster', () => {
  it('the sample is the first player (not removed) with a main photo or a file chosen for an overlay', () => {
    expect(rosterSample([])).toBeNull();
    expect(rosterSample([player({})])).toBeNull();
    expect(rosterSample([player({ photo: item(PHOTO, false), removed: true })])).toBeNull();
    // Files not chosen for any overlay show nothing: not a sample.
    expect(rosterSample([player({ media: [item(VIDEO, true)] })])).toBeNull();
    const sample = rosterSample([
      player({ number: 1, media: [item(VIDEO, true)] }),
      player({
        number: 8,
        photo: item(PHOTO, false),
        media: [item(PHOTO_ACE, false), item(VIDEO, true)],
        events: { ...noPlayerEvents(), ace: { photoAssetId: PHOTO_ACE, videoAssetId: VIDEO } },
      }),
    ]);
    expect(sample).toEqual({
      player: { number: 8, firstName: 'Mario', lastName: 'Rossi' },
      media: { number: 8, photo: PHOTO, events: { ace: { photo: PHOTO_ACE, video: VIDEO } } },
    });
    expect(
      rosterSample([
        player({ number: 3, events: { ...noPlayerEvents(), block: { photoAssetId: PHOTO, videoAssetId: null } } }),
      ])?.media,
    ).toEqual({
      number: 3,
      photo: null,
      events: { block: { photo: PHOTO, video: null } },
    });
  });

  it('the event and the background: the file of the player for that overlay (the video, also on the phone), else the fixed background', () => {
    const state = midMatchState();
    const sample = rosterSample([
      player({
        photo: item(PHOTO, false),
        media: [item(PHOTO_ACE, false), item(VIDEO, true)],
        events: { ...noPlayerEvents(), ace: { photoAssetId: PHOTO_ACE, videoAssetId: VIDEO } },
      }),
    ]);
    const overlay = withPlayerMode(
      {
        ...defaultOverlay('ace'),
        background: {
          kind: 'image',
          assetId: FIXED,
          audio: false,
          fit: 'center',
          teams: 'ours',
          duration: 'seconds',
          showText: true,
        },
      },
      'video',
    );
    const tv = overlayPreview('ace', overlay, state, 'home', sample, 1);
    expect(tv.event.player).toEqual({ number: 8, firstName: 'Mario', lastName: 'Rossi' });
    expect(tv.background).toMatchObject({ kind: 'video', assetId: VIDEO });
    // Another overlay of the player without its own files: the main photo.
    const block = withPlayerMode(defaultOverlay('block'), 'video');
    expect(overlayPreview('block', block, state, 'home', sample, 1).background).toMatchObject({
      kind: 'image',
      assetId: PHOTO,
    });
    // No roster sample, or the overlay does not show the player: the fixed background and the example event.
    expect(overlayPreview('ace', overlay, state, 'home', null, 1).background?.assetId).toBe(FIXED);
    const fixed = withPlayerMode(overlay, 'fixed');
    expect(overlayPreview('ace', fixed, state, 'home', sample, 1).background?.assetId).toBe(FIXED);
    // A different event for every «Prova».
    expect(overlayPreview('ace', overlay, state, 'home', sample, 2).event.id).not.toBe(tv.event.id);
  });
});
