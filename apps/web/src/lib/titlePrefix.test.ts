import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { prefixedTitle, useTitlePrefix } from './titlePrefix.ts';

function Prefix({ prefix }: { prefix: string | null }) {
  useTitlePrefix(prefix);
  return null;
}

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('prefixedTitle', () => {
  it('puts the prefix in front once, replaces an older one and removes it', () => {
    expect(prefixedTitle('Partite · Area riservata', 'Club A')).toBe('[Club A] Partite · Area riservata');
    expect(prefixedTitle('[Club A] Partite', 'Club A')).toBe('[Club A] Partite');
    expect(prefixedTitle('[Club A] Partite', 'Club B')).toBe('[Club B] Partite');
    expect(prefixedTitle('[Club A] Partite', null)).toBe('Partite');
    expect(prefixedTitle('Partite', null)).toBe('Partite');
  });
});

describe('useTitlePrefix', () => {
  it('keeps the prefix on every title the pages set, and removes it at the end', async () => {
    document.title = 'Clienti · Area riservata';
    const view = render(createElement(Prefix, { prefix: 'Club A' }));
    expect(document.title).toBe('[Club A] Clienti · Area riservata');
    document.title = 'Partite · Area riservata';
    await expect.poll(() => document.title).toBe('[Club A] Partite · Area riservata');
    view.rerender(createElement(Prefix, { prefix: null }));
    expect(document.title).toBe('Partite · Area riservata');
    view.rerender(createElement(Prefix, { prefix: 'Club B' }));
    expect(document.title).toBe('[Club B] Partite · Area riservata');
    view.unmount();
    expect(document.title).toBe('Partite · Area riservata');
  });
});
