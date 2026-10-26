import { describe, expect, it } from 'vitest';
import { STUDIO_SECTIONS, studioPath } from '../studio/model.ts';
import { menuGroups } from '../AdminSidebar.tsx';
import { canOpen } from './GuidePage.tsx';
import { filterSections, GUIDE_SECTIONS, normalize, sectionText } from './content.ts';

const FORBIDDEN = [
  'API',
  'token',
  'WebSocket',
  'server',
  'JSON',
  '.env',
  'endpoint',
  'database',
  'config.json',
  'SMTP',
];

const everyMenu = [
  menuGroups({ isAdmin: true, isSuperadmin: false, inTenant: true }),
  menuGroups({ isAdmin: false, isSuperadmin: false, inTenant: true }),
  menuGroups({ isAdmin: true, isSuperadmin: true, inTenant: false }),
  menuGroups({ isAdmin: true, isSuperadmin: true, inTenant: true }),
];

describe('content of the guide', () => {
  it('has the twelve sections of the user and one more for the superadmin, with unique anchors', () => {
    const ids = GUIDE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GUIDE_SECTIONS.filter((s) => !s.superadminOnly)).toHaveLength(12);
    expect(GUIDE_SECTIONS.filter((s) => s.superadminOnly).map((s) => s.id)).toEqual(['superadmin']);
    for (const s of GUIDE_SECTIONS) expect(s.blocks.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN)('never uses the technical word «%s»', (word) => {
    const re = new RegExp(`(^|[^a-z])${word.replace('.', '\\.')}([^a-z]|$)`, 'i');
    for (const s of GUIDE_SECTIONS) expect(sectionText(s), s.id).not.toMatch(re);
  });

  it('links only to pages that exist in the menu of some role', () => {
    const paths = new Set(everyMenu.flatMap((groups) => groups.flatMap((g) => g.items.map((i) => i.to))));
    const studio = STUDIO_SECTIONS.map((s) => studioPath(s.id));
    for (const link of GUIDE_SECTIONS.flatMap((s) => s.links ?? [])) {
      expect(link.to.startsWith('/admin/')).toBe(true);
      expect(paths.has(link.to) || studio.includes(link.to), link.to).toBe(true);
    }
  });

  it('shows a link only to who has that page in the menu', () => {
    const viewer = menuGroups({ isAdmin: false, isSuperadmin: false, inTenant: true });
    const outside = menuGroups({ isAdmin: true, isSuperadmin: true, inTenant: false });
    expect(canOpen('/admin/studio/colori', viewer)).toBe(false);
    expect(canOpen('/admin/club', viewer)).toBe(true);
    expect(canOpen('/admin/club', outside)).toBe(false);
    expect(canOpen('/admin/account', outside)).toBe(true);
  });
});

describe('search of the guide', () => {
  it('gives every section for an empty query, without the superadmin one', () => {
    expect(filterSections(GUIDE_SECTIONS, '  ', false)).toHaveLength(12);
    expect(filterSections(GUIDE_SECTIONS, '', true)).toHaveLength(13);
  });

  it('finds by word, ignoring case and accents, and needs every word', () => {
    expect(filterSections(GUIDE_SECTIONS, 'PENNINA', false).map((s) => s.id)).toContain('computer-datavolley');
    expect(filterSections(GUIDE_SECTIONS, 'picco spettatori', false).map((s) => s.id)).toEqual(['statistiche']);
    expect(filterSections(GUIDE_SECTIONS, 'parola-che-non-esiste', false)).toEqual([]);
    expect(normalize('Città')).toBe('citta');
  });

  it('hides the superadmin section from the others even when it matches', () => {
    expect(filterSections(GUIDE_SECTIONS, 'Entra nel cliente', false)).toEqual([]);
    expect(filterSections(GUIDE_SECTIONS, 'Entra nel cliente', true).map((s) => s.id)).toEqual(['superadmin']);
  });
});

describe('menu entries «Il mio account» and «Guida»', () => {
  it('are in the menu of every role, inside a client or not', () => {
    for (const groups of everyMenu) {
      const items = groups.flatMap((g) => g.items);
      expect(items.find((i) => i.to === '/admin/account')?.label).toBe('Il mio account');
      expect(items.find((i) => i.to === '/admin/guida')?.label).toBe('Guida');
    }
  });
});

const textOf = (id: string): string =>
  GUIDE_SECTIONS.filter((s) => s.id === id)
    .map(sectionText)
    .join(' ');

describe('agent section', () => {
  it('uses the words of the window of the agent', () => {
    const text = textOf('computer-datavolley');
    for (const w of ['Registra', 'Nome agente', 'Sfoglia…', 'START', 'STOP', 'Richieste in attesa', 'Abilita'])
      expect(text).toContain(w);
  });
  it('tells the superadmin where the custom themes are', () => {
    const text = textOf('superadmin');
    expect(text).toContain('Avanzate');
    expect(text).toContain('Colori e loghi');
  });
});
