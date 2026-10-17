import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewDock } from './PreviewDock.tsx';

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
}

const dock = () =>
  render(
    <PreviewDock subtitle="Prova" fullscreen={<p>Vista grande</p>}>
      <p>Vista piccola</p>
    </PreviewDock>,
  );

beforeEach(() => setWidth(1024));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  Reflect.deleteProperty(document, 'fullscreenElement');
  setWidth(1024);
});

describe('PreviewDock: always in view', () => {
  it('is sticky: a column under the page top on desktop, a bar under the top bar on the phone, first on small screens', () => {
    dock();
    const aside = screen.getByTestId('anteprima-fissa');
    for (const c of ['sticky', 'order-first', 'xl:order-none', 'xl:self-start', 'xl:top-6', 'md:top-0']) {
      expect(aside.className).toContain(c);
    }
    // never taller than the screen: scrolls inside
    expect(aside.className).toContain('max-h-[60dvh]');
    expect(aside.className).toContain('xl:max-h-[calc(100dvh-3rem)]');
    expect(aside.className).toContain('overflow-y-auto');
    // phone: under the sticky top bar (z-30), above the page
    expect(aside.className).toContain('top-[var(--sir-navbar-height,3.5rem)]');
  });

  it('a tablet starts with the preview open, a phone with it closed; the button opens and closes it', () => {
    dock();
    const toggle = screen.getByRole('button', { name: 'Chiudi anteprima' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(body?.className).not.toContain('max-xl:hidden');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Apri anteprima' }).getAttribute('aria-expanded')).toBe('false');
    // closed only below the desktop column (xl): the desktop always shows it
    expect(body?.className).toContain('max-xl:hidden');
    expect(toggle.className).toContain('xl:hidden');
    cleanup();
    setWidth(390);
    dock();
    expect(screen.getByRole('button', { name: 'Apri anteprima' })).toBeTruthy();
  });
});

describe('PreviewDock: full screen preview', () => {
  it('opens a dialog with the big view, asks the browser for full screen and closes with «Chiudi»', () => {
    const request = vi.fn(() => Promise.resolve());
    HTMLElement.prototype.requestFullscreen = request;
    dock();
    const open = screen.getByRole('button', { name: 'Anteprima a tutto schermo' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Anteprima a tutto schermo' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(within(dialog).getByText('Vista grande')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    // the focus is on «Chiudi» and stays in the dialog
    const close = within(dialog).getByRole('button', { name: 'Chiudi' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('works without the Fullscreen API (overlay on the whole window) and closes with Esc', () => {
    dock();
    const open = screen.getByRole('button', { name: 'Anteprima a tutto schermo' });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('fixed inset-0');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it('a refused request is not an error; leaving full screen with the browser (Esc, F11) closes the preview', async () => {
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.reject(new Error('negato')));
    dock();
    fireEvent.click(screen.getByRole('button', { name: 'Anteprima a tutto schermo' }));
    await act(() => Promise.resolve());
    expect(screen.getByRole('dialog')).toBeTruthy();
    cleanup();
    // accepted: the browser then leaves full screen by itself
    HTMLElement.prototype.requestFullscreen = vi.fn(() => Promise.resolve());
    dock();
    fireEvent.click(screen.getByRole('button', { name: 'Anteprima a tutto schermo' }));
    await act(() => Promise.resolve());
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
