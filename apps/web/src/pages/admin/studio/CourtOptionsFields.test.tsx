import type { LayoutBlock } from '@arenalive/shared';
import { newBlock } from '@arenalive/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourtOptionsFields } from './CourtOptionsFields.tsx';

afterEach(cleanup);

const court = (): Extract<LayoutBlock, { type: 'court' }> => {
  const b = newBlock('court', 'court');
  if (b.type !== 'court') throw new Error('type');
  return b;
};

describe('options editor of the court map', () => {
  it('sets a colour, then goes back to automatic removing the key', () => {
    const onChange = vi.fn();
    render(<CourtOptionsFields block={court()} onChange={onChange} />);
    expect(screen.getAllByText('Automatico (segue il tema)').length).toBe(6);
    fireEvent.change(screen.getByLabelText('Metà della nostra squadra'), { target: { value: '#ABCDEF' } });
    const set = onChange.mock.calls[0]?.[0] as LayoutBlock;
    expect(set.options).toEqual({ lineWidth: 1, arrowWidth: 1, fieldOurs: '#abcdef' });
    cleanup();
    onChange.mockClear();
    render(<CourtOptionsFields block={set as Extract<LayoutBlock, { type: 'court' }>} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Metà della nostra squadra: torna automatico' }));
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toEqual({ lineWidth: 1, arrowWidth: 1 });
  });

  it('changes the thickness of lines and arrows', () => {
    const onChange = vi.fn();
    render(<CourtOptionsFields block={court()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Spessore delle linee'), { target: { value: '2' } });
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toMatchObject({ lineWidth: 2, arrowWidth: 1 });
    fireEvent.change(screen.getByLabelText('Spessore delle traiettorie'), { target: { value: '0.5' } });
    expect((onChange.mock.calls[1]?.[0] as LayoutBlock).options).toMatchObject({ lineWidth: 1, arrowWidth: 0.5 });
  });
});
