import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contrastRatio, MIN_TEXT_CONTRAST } from '@sir/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { menuGroups, SUPERADMIN_MENU } from './AdminSidebar.tsx';
import { ManagedTenantBar } from './ManagedTenantBar.tsx';

const css = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** Value of `name` in every block of tokens.css that declares it (light, dark, dark of the system). */
const values = (name: string): string[] =>
  [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'g'))].map((m) => m[1] ?? '');

const TENANT = { id: '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c', slug: 'club-a', name: 'Club A' };

afterEach(cleanup);

describe('bar of the client managed by the superadmin', () => {
  it('names the client and leaves it with «Esci dal cliente»', () => {
    const onLeave = vi.fn();
    render(<ManagedTenantBar tenant={TENANT} onLeave={onLeave} busy={false} />);
    const bar = screen.getByRole('region', { name: 'Cliente gestito dal superadmin' });
    expect(bar.textContent).toContain('Stai gestendo «Club A» come superadmin');
    fireEvent.click(screen.getByRole('button', { name: 'Esci dal cliente' }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('waits for the exit with the button disabled', () => {
    render(<ManagedTenantBar tenant={TENANT} onLeave={() => undefined} busy />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Uscita…' }).disabled).toBe(true);
  });

  it('uses the warning colours, with text at 4.5:1 at least in the light and dark themes', () => {
    const warn = values('--sir-warn');
    const onWarn = values('--sir-on-warn');
    expect(warn).toHaveLength(3);
    expect(onWarn).toHaveLength(3);
    warn.forEach((bg, i) => {
      expect(contrastRatio(onWarn[i] ?? '', bg), `${onWarn[i]} su ${bg}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    });
  });
});

describe('menu of the superadmin', () => {
  it('has only clients and championships outside any client', () => {
    expect(menuGroups({ isAdmin: true, isSuperadmin: true, inTenant: false })).toEqual(SUPERADMIN_MENU);
  });

  it('is the menu of an administrator inside a client', () => {
    const admin = menuGroups({ isAdmin: true, isSuperadmin: false, inTenant: false });
    expect(menuGroups({ isAdmin: true, isSuperadmin: true, inTenant: true })).toEqual(admin);
    // The users of a client always work on their own: `inTenant` changes nothing for them.
    expect(menuGroups({ isAdmin: true, isSuperadmin: false, inTenant: true })).toEqual(admin);
  });
});
