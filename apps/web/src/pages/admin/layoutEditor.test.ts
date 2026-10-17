import { defaultLayout } from '@sir/shared';
import { describe, expect, it } from 'vitest';
import { addBlock, freeId, layoutProblems, moveBlock, removeBlock, resetDevice } from './layoutEditor.ts';

describe('editing helpers', () => {
  it('move, add, remove and reset the blocks of one device only', () => {
    const base = defaultLayout();
    expect(moveBlock(base, 'tv', 0, 2).tv.map((b) => b.id)).toEqual([
      'momentum',
      'comparison',
      'scoreboard',
      'players',
      'court',
      'rotations',
    ]);
    expect(moveBlock(base, 'tv', 5, 99).tv.at(-1)?.id).toBe('rotations');
    const added = addBlock(addBlock(base, 'tablet', 'message'), 'tablet', 'message');
    expect(added.tablet.slice(-2).map((b) => [b.id, b.width])).toEqual([
      ['message', 6],
      ['message-2', 6],
    ]);
    expect(added.tv).toBe(base.tv);
    expect(addBlock(base, 'tv', 'scoreboard')).toBe(base);
    expect(addBlock(base, 'phone', 'players').phone.at(-1)?.width).toBe(12);
    expect(removeBlock(base, 'phone', 'court').phone.map((b) => b.id)).not.toContain('court');
    expect(resetDevice(removeBlock(base, 'tv', 'court'), 'tv')).toEqual(base);
    expect(freeId(base.tv, 'court')).toBe('court-2');
  });

  it('finds the blocks with invalid options', () => {
    const layout = addBlock(defaultLayout(), 'phone', 'message');
    const broken = {
      ...layout,
      phone: layout.phone.map((b) => (b.type === 'message' ? { ...b, options: { ...b.options, text: ' ' } } : b)),
    };
    expect(layoutProblems(layout)).toEqual({});
    expect(layoutProblems(broken).phone).toEqual(new Set(['message']));
  });
});
