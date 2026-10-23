import type { LayoutBlock } from '@arenalive/shared';
import { newBlock } from '@arenalive/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockOptionsEditor } from './blockEditors.tsx';

afterEach(cleanup);

describe('options editor of the rotations', () => {
  it('chooses side by side or one above the other', () => {
    const block = newBlock('rotations', 'rotations');
    const onChange = vi.fn();
    render(
      <BlockOptionsEditor
        block={block}
        onChange={onChange}
        sponsors={[]}
        assets={{ assets: [], usedBytes: 0, quotaBytes: 1 }}
      />,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Disposizione');
    expect(select.value).toBe('horizontal');
    expect(screen.getByRole('option', { name: 'Affiancati' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'vertical' } });
    expect((onChange.mock.calls[0]?.[0] as LayoutBlock).options).toEqual({ orientation: 'vertical' });
  });
});
