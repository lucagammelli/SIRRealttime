import type { AssetSummary } from '@arenalive/shared';
import { defaultIntermission, defaultIntermissions, IntermissionSlideSchema } from '@arenalive/shared';
import { describe, expect, it } from 'vitest';
import type { MediaSlide } from './intermissionEditor.ts';
import {
  addSlide,
  freeSlideId,
  mediaSlideFiles,
  moveSlide,
  pauseAt,
  pauseProblems,
  removeSlide,
  resetPause,
  setOwnPause,
  targetSet,
  withMediaKind,
  withMediaOptions,
  withPause,
} from './intermissionEditor.ts';

describe('editing helpers of the pauses', () => {
  it('add, move, remove slides and reset a pause', () => {
    const pause = { ...defaultIntermission('setBreak'), slides: defaultIntermission('setBreak').slides.slice(0, 1) };
    const added = addSlide(addSlide(addSlide(pause, 'sponsor'), 'qr'), 'qr');
    expect(added.slides.map((s) => s.id)).toEqual(['setSummary', 'sponsor', 'qr', 'qr-2']);
    expect(added.slides.at(-1)).toMatchObject({ seconds: 8, options: { caption: 'Segui la partita sul telefono' } });
    expect(moveSlide(added, 3, 0).slides[0]?.id).toBe('qr-2');
    expect(moveSlide(added, 0, 99).slides.at(-1)?.id).toBe('setSummary');
    expect(removeSlide(added, 'sponsor').slides.map((s) => s.id)).toEqual(['setSummary', 'qr', 'qr-2']);
    expect(addSlide(pause, 'roleDuel').slides.at(-1)).toMatchObject({
      type: 'roleDuel',
      options: { period: 'set', role: 'rotate' },
    });
    expect(freeSlideId(added.slides, 'mvp')).toBe('mvp');
    const config = withPause(defaultIntermissions(), 'timeout', { ...pause, delaySeconds: 9 });
    expect(config.timeout.delaySeconds).toBe(9);
    expect(resetPause(config, 'timeout')).toEqual(defaultIntermissions());
  });

  it('own pause of a set: copy of the generic one, then back to it', () => {
    expect(targetSet('setBreak-3')).toBe('3');
    expect(targetSet('setBreak')).toBeNull();
    const base = withPause(defaultIntermissions(), 'setBreak', { ...defaultIntermission('setBreak'), delaySeconds: 2 });
    expect(pauseAt(base, 'setBreak-2')).toBeUndefined();
    const own = setOwnPause(base, '2', true);
    expect(pauseAt(own, 'setBreak-2')).toEqual(base.setBreak);
    expect(pauseAt(own, 'setBreak-2')).not.toBe(base.setBreak);
    expect(setOwnPause(own, '2', false).setBreakBySet).toEqual({});
    expect(pauseAt(resetPause(own, 'setBreak-2'), 'setBreak-2')?.delaySeconds).toBe(5);
  });

  it('finds the pauses that cannot be saved', () => {
    const config = defaultIntermissions();
    expect(pauseProblems(config).size).toBe(0);
    const empty = withPause(config, 'timeout', { ...config.timeout, slides: [] });
    expect(pauseProblems(empty)).toEqual(new Set(['timeout']));
    const own = setOwnPause(config, '4', true);
    const broken = withPause(own, 'setBreak-4', {
      ...config.setBreak,
      slides: [
        {
          id: 'm',
          type: 'message',
          seconds: 8,
          enabled: true,
          showTitle: true,
          options: { text: ' ', size: 'normal' },
        },
      ],
    });
    expect(pauseProblems(broken)).toEqual(new Set(['setBreak-4']));
  });
});

describe('editing a «Foto o video» slide', () => {
  const IMAGE = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
  const VIDEO = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
  const asset = (id: string, mime: string, kind: AssetSummary['kind']): AssetSummary => ({
    id,
    kind,
    mime: mime as AssetSummary['mime'],
    width: 10,
    height: 10,
    bytes: 100,
    sha256: 'a'.repeat(64),
    name: null,
    sponsorId: null,
    url: `/api/admin/assets/${id}`,
    createdAt: '2026-10-26T10:00:00.000Z',
  });
  const media = (): MediaSlide => {
    const slide = addSlide({ ...defaultIntermission('timeout'), slides: [] }, 'media').slides[0];
    if (slide?.type !== 'media') throw new Error('not a media slide');
    return slide;
  };

  it('is added with no file, an image, whole, muted and its title shown', () => {
    expect(media()).toMatchObject({
      id: 'media',
      showTitle: true,
      options: { kind: 'image', assetId: null, fit: 'contain', audio: false, duration: 'seconds' },
    });
  });

  it('offers the images or the videos of the whole library', () => {
    const list = [
      asset(IMAGE, 'image/png', 'sponsor'),
      asset(VIDEO, 'video/mp4', 'overlay'),
      asset('11111111-0000-4000-8000-000000000000', 'image/jpeg', 'player'),
    ];
    expect(mediaSlideFiles(list, 'image').map((a) => a.id)).toEqual([IMAGE, '11111111-0000-4000-8000-000000000000']);
    expect(mediaSlideFiles(list, 'video').map((a) => a.id)).toEqual([VIDEO]);
  });

  it('changes the file and the options; another kind drops the file', () => {
    const chosen = withMediaOptions(media(), { assetId: IMAGE, fit: 'cover' });
    expect(chosen.options).toMatchObject({ kind: 'image', assetId: IMAGE, fit: 'cover' });
    expect(withMediaKind(chosen, 'image')).toBe(chosen);
    const video = withMediaKind(chosen, 'video');
    expect(video.options).toMatchObject({ kind: 'video', assetId: null, fit: 'cover' });
    const follows = withMediaOptions(withMediaOptions(video, { assetId: VIDEO }), { audio: true, duration: 'video' });
    expect(IntermissionSlideSchema.parse(follows)).toEqual(follows);
    expect(chosen.options.assetId).toBe(IMAGE);
  });
});
