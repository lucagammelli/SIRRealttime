import type { ScheduleFixture } from '@arenalive/shared';
import { defaultIntermissions } from '@arenalive/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterMatchFile, AfterMatchScreen } from './AfterMatchScreen.tsx';

const NEXT = {
  startsAt: '2026-10-25T17:00:00.000Z',
  home: { name: 'Sir Susa Scai Perugia', logoUrl: null },
  away: { name: 'Itas Trentino', logoUrl: null },
  ourSide: 'home',
} as unknown as ScheduleFixture;

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('reduced-motion'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

const config = (over: Partial<ReturnType<typeof defaultIntermissions>['afterMatch']>) => ({
  ...defaultIntermissions().afterMatch,
  enabled: true,
  ...over,
});

beforeEach(() => stubReducedMotion(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('«Dopo la partita»: photo or video', () => {
  it('a photo saved before the video fills the screen as always', () => {
    render(<AfterMatchScreen file={afterMatchFile(config({}), '/photo')} fixture={null} device="tv" />);
    const box = screen.getByTestId('dopo-partita').querySelector('[data-after-match="image"]');
    expect(box?.getAttribute('data-fit')).toBe('cover');
    expect(box?.querySelector('img')?.getAttribute('src')).toBe('/photo');
    expect(box?.querySelector('img')?.className).toContain('object-cover');
  });

  it('a video loops for as long as the screen is on, muted unless «Audio»; «Intero» fills the sides', () => {
    render(
      <AfterMatchScreen
        file={afterMatchFile(config({ kind: 'video', fit: 'contain' }), '/clip')}
        fixture={NEXT}
        device="tv"
      />,
    );
    const after = screen.getByTestId('dopo-partita');
    const video = after.querySelector('video');
    expect(video?.getAttribute('src')).toBe('/clip');
    expect(video?.loop).toBe(true);
    expect(video?.dataset.audio).toBe('off');
    expect(after.querySelector('[data-fill="color"]')).toBeTruthy();
    expect(within(after).getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    cleanup();
    render(
      <AfterMatchScreen
        file={afterMatchFile(config({ kind: 'video', audio: true }), '/clip')}
        fixture={null}
        device="tv"
      />,
    );
    expect(document.querySelector('video')?.dataset.audio).toBe('on');
    cleanup();
    // The preview of the Studio stays silent.
    render(
      <AfterMatchScreen
        file={afterMatchFile(config({ kind: 'video', audio: true }), '/clip')}
        fixture={null}
        device="tv"
        contained
      />,
    );
    expect(document.querySelector('video')?.dataset.audio).toBe('off');
  });

  it('reduced motion: no video (no poster), the screen with the countdown only; a photo stays', () => {
    stubReducedMotion(true);
    render(<AfterMatchScreen file={afterMatchFile(config({ kind: 'video' }), '/clip')} fixture={NEXT} device="tv" />);
    const after = screen.getByTestId('dopo-partita');
    expect(after.querySelector('video')).toBeNull();
    expect(after.querySelector('[data-after-match]')).toBeNull();
    expect(within(after).getByRole('heading', { name: 'Prossima partita' })).toBeTruthy();
    cleanup();
    render(<AfterMatchScreen file={afterMatchFile(config({}), '/photo')} fixture={null} device="tv" />);
    expect(screen.getByTestId('dopo-partita').querySelector('img')).toBeTruthy();
  });
});
