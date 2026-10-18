import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAs } from '../../../test/adminPage.tsx';
import { GuidePage } from './GuidePage.tsx';
import { GUIDE_SECTIONS, READ_ONLY_NOTE } from './content.ts';

afterEach(cleanup);

describe('GuidePage', () => {
  it('renders every section with its title and an index entry', () => {
    renderAs('admin', <GuidePage />);
    const user = GUIDE_SECTIONS.filter((s) => !s.superadminOnly);
    for (const s of user) {
      expect(screen.getByRole('heading', { level: 2, name: s.title })).toBeTruthy();
      expect(screen.getAllByRole('link', { name: s.title })).toHaveLength(1);
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Guida' })).toBeTruthy();
    expect(screen.queryByText('Per chi gestisce più club (superadmin)')).toBeNull();
  });

  it('filters the sections by word and says so when nothing matches', () => {
    renderAs('admin', <GuidePage />);
    const search = screen.getByLabelText('Cerca nella guida');
    fireEvent.change(search, { target: { value: 'pennina' } });
    expect(screen.getByRole('heading', { level: 2, name: 'Il computer con DataVolley' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Utenti' })).toBeNull();
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(screen.getByText(/Nessun risultato/)).toBeTruthy();
  });

  it('gives a user «Sola lettura» the whole guide with a note, and hides the links to pages it does not have', () => {
    renderAs('viewer', <GuidePage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Utenti' })).toBeTruthy();
    expect(screen.getAllByText(READ_ONLY_NOTE).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: 'Vai a Studio grafico' })).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Vai a Club' }).length).toBeGreaterThan(0);
  });

  it('does not show the note to who has «Lettura e scrittura», and links to Studio grafico', () => {
    renderAs('admin', <GuidePage />);
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull();
    expect(screen.getByRole('link', { name: 'Vai a Studio grafico' }).getAttribute('href')).toBe(
      '/admin/studio/colori',
    );
  });

  it('shows the superadmin section only to the superadmin', () => {
    renderAs('superadmin', <GuidePage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Per chi gestisce più club (superadmin)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vai a Clienti' }).getAttribute('href')).toBe('/admin/clienti');
  });
});
