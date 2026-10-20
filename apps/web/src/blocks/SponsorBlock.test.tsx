import type { PublicSponsor } from '@arenalive/shared';
import {
  adminAssetPath,
  IntermissionSlideSchema,
  publicAssetPath,
  SponsorOptionsSchema,
  TenantIntermissionsSchema,
} from '@arenalive/shared';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { visibleSlides } from '../lib/intermission.ts';
import { publicSponsorsOf, sponsorItems } from '../lib/sponsors.ts';
import { midMatchState } from '../test/fixtures.ts';
import { SponsorBlock } from './BrandBlocks.tsx';
import type { BlockEnv } from './env.ts';
import type { SlideEnv } from './IntermissionSlides.tsx';
import { renderSlide } from './IntermissionSlides.tsx';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const LEGACY = '33333333-3333-4333-8333-333333333333';

/** Sponsors as the public answer gives them: in the order of the list of the client. */
const SPONSORS: PublicSponsor[] = [
  { id: S2, name: 'Autofficina', website: null, images: ['/api/public/assets/a1'] },
  {
    id: S1,
    name: 'Bar Centrale',
    website: 'https://bar.example.it',
    images: ['/api/public/assets/b1', '/api/public/assets/b2'],
  },
];

const state = midMatchState();
const env = (sponsors: readonly PublicSponsor[] = SPONSORS): BlockEnv => ({
  state,
  device: 'tv',
  brandInScoreboard: false,
  brand: { name: 'Sir', logoMain: null, logoMark: null, sponsors },
  schedule: null,
  paused: false,
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('sponsorItems', () => {
  it('gives the images of the sponsors chosen in the order of their list, then the single images', () => {
    const items = sponsorItems({ sponsors: [S1, S2], images: [LEGACY] }, SPONSORS);
    expect(items.map((i) => i.src)).toEqual([
      '/api/public/assets/a1',
      '/api/public/assets/b1',
      '/api/public/assets/b2',
      publicAssetPath(LEGACY),
    ]);
    expect(items[1]).toMatchObject({ name: 'Bar Centrale', website: 'https://bar.example.it' });
    expect(items[3]).toMatchObject({ name: null, website: null });
    // A sponsor not chosen or unknown gives nothing.
    expect(sponsorItems({ sponsors: ['44444444-4444-4444-8444-444444444444'], images: [] }, SPONSORS)).toEqual([]);
  });

  it('in the previews of the reserved area every image goes through the path of the session, not of the hostname', () => {
    const admin = publicSponsorsOf([
      {
        id: S1,
        name: 'Bar Centrale',
        website: null,
        position: 0,
        imageIds: [LEGACY],
        createdAt: '2026-10-01T10:00:00.000Z',
      },
    ]);
    expect(admin[0]?.images).toEqual([adminAssetPath(LEGACY)]);
    const items = sponsorItems({ sponsors: [S1], images: [LEGACY] }, admin, adminAssetPath);
    expect(items.map((i) => i.src)).toEqual([`/api/admin/assets/${LEGACY}/file`, `/api/admin/assets/${LEGACY}/file`]);
  });
});

describe('block «Sponsor»', () => {
  it('rotates the images of the sponsors; one with a website is a link in a new tab', () => {
    vi.useFakeTimers();
    const options = SponsorOptionsSchema.parse({ sponsors: [S1], seconds: 3 });
    render(<SponsorBlock options={options} env={env()} />);
    const first = screen.getByRole('img', { name: 'Sponsor: Bar Centrale' });
    expect(first.getAttribute('src')).toBe('/api/public/assets/b1');
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://bar.example.it');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('img', { name: 'Sponsor: Bar Centrale' }).getAttribute('src')).toBe(
      '/api/public/assets/b2',
    );
  });

  it('shows a sponsor without website as an image only, and says when nothing is chosen', () => {
    render(<SponsorBlock options={SponsorOptionsSchema.parse({ sponsors: [S2] })} env={env()} />);
    expect(screen.getByRole('img', { name: 'Sponsor: Autofficina' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    render(<SponsorBlock options={SponsorOptionsSchema.parse({})} env={env()} />);
    expect(screen.getByText('Nessuno sponsor scelto.')).toBeTruthy();
  });
});

describe('sponsor slide of the pauses', () => {
  const slide = (options: object) => IntermissionSlideSchema.parse({ id: 'sp', type: 'sponsor', options });
  const slideEnv = (sponsorLogo: string | null): SlideEnv => ({ ...env(), set: 1, sponsorLogo });

  it('shows the sponsors chosen as a banner, otherwise the sponsor logo of the branding', () => {
    render(<>{renderSlide(slide({ sponsors: [S2] }), slideEnv('/logo.png'), 'compact')}</>);
    expect(screen.getByRole('img', { name: 'Sponsor: Autofficina' }).getAttribute('src')).toBe('/api/public/assets/a1');
    cleanup();
    render(<>{renderSlide(slide({}), slideEnv('/logo.png'), 'compact')}</>);
    expect(screen.getByRole('img', { name: 'Sponsor' }).getAttribute('src')).toBe('/logo.png');
  });

  it('is visible only with images of its sponsors, single images or the sponsor logo', () => {
    const config = TenantIntermissionsSchema.parse({
      timeout: { slides: [{ id: 'sp', type: 'sponsor', options: { sponsors: [S1] } }] },
    });
    const active = { set: 1, pause: config.timeout };
    expect(visibleSlides(state, active, { sponsorLogo: null })).toEqual([]);
    expect(visibleSlides(state, active, { sponsorLogo: null, sponsors: SPONSORS })).toHaveLength(1);
    const empty: PublicSponsor[] = [{ id: S1, name: 'Bar Centrale', website: null, images: [] }];
    expect(visibleSlides(state, active, { sponsorLogo: null, sponsors: empty })).toEqual([]);
  });
});
