import { defaultIntermission, defaultIntermissions } from '@sir/shared';
import { describe, expect, it } from 'vitest';
import {
  addSlide,
  freeSlideId,
  moveSlide,
  pauseAt,
  pauseProblems,
  removeSlide,
  resetPause,
  setOwnPause,
  targetSet,
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
      slides: [{ id: 'm', type: 'message', seconds: 8, options: { text: ' ', size: 'normal' } }],
    });
    expect(pauseProblems(broken)).toEqual(new Set(['setBreak-4']));
  });
});
