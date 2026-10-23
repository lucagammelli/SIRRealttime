import type { LayoutBlock } from '@arenalive/shared';
import { newBlock } from '@arenalive/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourtOptionsFields } from './CourtOptionsFields.tsx';

afterEach(cleanup);

/** View of a new map: team in turn, attacks, 10 seconds. */
const VIEW = { side: 'cycle', skill: 'attack', cycleSeconds: 10 };

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
    expect(set.options).toEqual({ ...VIEW, lineWidth: 1, arrowWidth: 1, fieldOurs: '#abcdef' });
    cleanup();
    onChange.mockClear();
    render(<CourtOptionsFields block={set as Extract<LayoutBlock, { type: 'court' }>} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Metà della nostra squadra: torna automatico' }));
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toEqual({ ...VIEW, lineWidth: 1, arrowWidth: 1 });
  });

  it('chooses what the map shows without touch: team, skill and the seconds of the turn', () => {
    const onChange = vi.fn();
    const view = render(<CourtOptionsFields block={court()} onChange={onChange} />);
    const team = screen.getByLabelText<HTMLSelectElement>('Squadra');
    expect(team.value).toBe('cycle');
    expect([...team.options].map((o) => o.textContent)).toEqual([
      'A turno',
      'Solo la nostra squadra',
      'Casa',
      'Ospite',
    ]);
    expect([...screen.getByLabelText<HTMLSelectElement>('Fondamentale').options].map((o) => o.textContent)).toEqual([
      'Attacco',
      'Battuta',
      'A turno',
    ]);
    fireEvent.change(screen.getByLabelText('Secondi per ogni vista'), { target: { value: '30' } });
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toMatchObject({ cycleSeconds: 30 });
    fireEvent.change(team, { target: { value: 'ours' } });
    const ours = onChange.mock.calls[1]?.[0] as Extract<LayoutBlock, { type: 'court' }>;
    expect(ours.options).toMatchObject({ side: 'ours', skill: 'attack' });
    view.unmount();
    // One team and one skill: nothing in turn, no seconds.
    render(<CourtOptionsFields block={ours} onChange={onChange} />);
    expect(screen.queryByLabelText('Secondi per ogni vista')).toBeNull();
    expect(screen.getByText(/se nella partita non la si riconosce, si vede la squadra di casa/)).toBeTruthy();
  });

  it('changes the thickness of lines and arrows', () => {
    const onChange = vi.fn();
    render(<CourtOptionsFields block={court()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Spessore delle linee'), { target: { value: '2' } });
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toMatchObject({ lineWidth: 2, arrowWidth: 1 });
    fireEvent.change(screen.getByLabelText('Spessore delle traiettorie'), { target: { value: '0.5' } });
    expect((onChange.mock.calls[1]?.[0] as LayoutBlock).options).toMatchObject({ lineWidth: 1, arrowWidth: 0.5 });
  });

  it('chooses single colour or tricolour for the field', () => {
    const onChange = vi.fn();
    render(<CourtOptionsFields block={court()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Colore del campo'), { target: { value: 'single' } });
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toMatchObject({ fieldMode: 'single' });
    cleanup();
    const tri = { ...court(), options: { ...court().options, fieldMode: 'tricolor' as const } };
    onChange.mockClear();
    render(<CourtOptionsFields block={tri} onChange={onChange} />);
    expect(screen.getByLabelText<HTMLInputElement>('Fascia sinistra').value).toBe('#009246');
    expect(screen.getByLabelText<HTMLInputElement>('Fascia centrale (sulla rete)').value).toBe('#ffffff');
    fireEvent.change(screen.getByLabelText('Fascia destra'), { target: { value: '#112233' } });
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toMatchObject({
      tricolor: ['#009246', '#ffffff', '#112233'],
    });
  });
});
