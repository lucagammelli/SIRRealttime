import type { Player } from '@arenalive/shared';
import { defaultOverlay } from '@arenalive/shared';
import { describe, expect, it } from 'vitest';
import { midMatchState } from '../../../test/fixtures.ts';
import { overlayPreview, rosterSample } from './model.ts';
import { playerModeOf, withPlayerMode, withPlayerOptions } from './OverlaysSection.tsx';

const PHOTO = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
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
      pick: 'default',
      audio: false,
      fit: 'center',
      duration: 'seconds',
      showText: true,
    });
    const tuned = withPlayerOptions(video, { pick: 'random', audio: true });
    expect(withPlayerMode(tuned, 'photo').playerMedia).toMatchObject({ source: 'photo', pick: 'random', audio: true });
    expect('playerMedia' in withPlayerMode(tuned, 'fixed')).toBe(false);
    // Nothing to change without player media.
    expect(withPlayerOptions(ace, { pick: 'random' })).toBe(ace);
  });
});

describe('preview with a player of the roster', () => {
  it('the sample is the first player (not removed) with a photo or a video', () => {
    expect(rosterSample([])).toBeNull();
    expect(rosterSample([player({})])).toBeNull();
    expect(rosterSample([player({ photo: item(PHOTO, false), removed: true })])).toBeNull();
    const sample = rosterSample([
      player({ number: 1 }),
      player({ number: 8, photo: item(PHOTO, false), media: [item(VIDEO, true)] }),
    ]);
    expect(sample).toEqual({
      player: { number: 8, firstName: 'Mario', lastName: 'Rossi' },
      media: { number: 8, photo: PHOTO, images: [], videos: [VIDEO] },
    });
  });

  it('the event and the background: the file of the player (video not on the phone), else the fixed background', () => {
    const state = midMatchState();
    const sample = rosterSample([player({ photo: item(PHOTO, false), media: [item(VIDEO, true)] })]);
    const overlay = withPlayerMode(
      {
        ...defaultOverlay('ace'),
        background: { kind: 'image', assetId: FIXED, audio: false, fit: 'center', teams: 'ours', duration: 'seconds' },
      },
      'video',
    );
    const tv = overlayPreview('ace', overlay, state, 'home', sample, 1, 'tv');
    expect(tv.event.player).toEqual({ number: 8, firstName: 'Mario', lastName: 'Rossi' });
    expect(tv.background).toMatchObject({ kind: 'video', assetId: VIDEO });
    expect(overlayPreview('ace', overlay, state, 'home', sample, 1, 'phone').background).toMatchObject({
      kind: 'image',
      assetId: PHOTO,
    });
    // No roster sample, or the overlay does not show the player: the fixed background and the example event.
    expect(overlayPreview('ace', overlay, state, 'home', null, 1, 'tv').background?.assetId).toBe(FIXED);
    const fixed = withPlayerMode(overlay, 'fixed');
    expect(overlayPreview('ace', fixed, state, 'home', sample, 1, 'tv').background?.assetId).toBe(FIXED);
    // A different event for every «Prova», so that «Casuale» varies.
    expect(overlayPreview('ace', overlay, state, 'home', sample, 2, 'tv').event.id).not.toBe(tv.event.id);
  });
});
