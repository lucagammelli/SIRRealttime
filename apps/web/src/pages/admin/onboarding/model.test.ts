import { defaultBranding, defaultIntermissions, defaultOverlays } from '@sir/shared';
import { describe, expect, it } from 'vitest';
import { applyPauseModel } from '../studio/model.ts';
import type { OnboardingProgress } from './model.ts';
import { brandingWithClub, hasSquad, laterStep, noticeFor, opensByItself, resumeStep, stepIndex } from './model.ts';

const club = (over: Partial<OnboardingProgress['club']> = {}): OnboardingProgress['club'] => ({
  logoMark: null,
  displayName: null,
  ourTeam: { code: null, name: null },
  profile: {
    series: null,
    gender: null,
    seriesId: null,
    leagueId: null,
    leagueIds: [],
    newSeason: false,
    coverage: 'homeAndAway',
    teamLogos: 'all',
  },
  leagues: [],
  ...over,
});
const progress = (over: Partial<OnboardingProgress> = {}): OnboardingProgress => ({
  club: club(),
  branding: defaultBranding(),
  intermissions: defaultIntermissions(),
  overlays: defaultOverlays(),
  ...over,
});
const LOGO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';

describe('opensByItself', () => {
  it('opens only for an admin of a client not configured, unless skipped in this session', () => {
    expect(opensByItself({ role: 'admin', completed: false, skipped: false })).toBe(true);
    expect(opensByItself({ role: 'admin', completed: true, skipped: false })).toBe(false);
    expect(opensByItself({ role: 'admin', completed: false, skipped: true })).toBe(false);
  });

  it('never opens for a viewer or for the superadmin (not even inside a client)', () => {
    expect(opensByItself({ role: 'viewer', completed: false, skipped: false })).toBe(false);
    expect(opensByItself({ role: 'superadmin', completed: false, skipped: false })).toBe(false);
  });
});

describe('noticeFor', () => {
  it('«Riprendi» for the admin, a link for the superadmin, nothing for a viewer or when done', () => {
    expect(noticeFor({ role: 'admin', completed: false })).toBe('resume');
    expect(noticeFor({ role: 'superadmin', completed: false })).toBe('link');
    expect(noticeFor({ role: 'viewer', completed: false })).toBeNull();
    expect(noticeFor({ role: 'admin', completed: true })).toBeNull();
    expect(noticeFor({ role: 'superadmin', completed: true })).toBeNull();
  });
});

describe('resumeStep', () => {
  it('goes to the first step with nothing saved', () => {
    expect(resumeStep(progress())).toBe('logo');
    expect(resumeStep(progress({ club: club({ logoMark: LOGO }) }))).toBe('squadra');
    const named = club({ logoMark: LOGO, displayName: 'Sir Safety' });
    expect(resumeStep(progress({ club: named }))).toBe('colori');
    const colored = { ...defaultBranding(), template: 'sir-volley' as const };
    expect(resumeStep(progress({ club: named, branding: colored }))).toBe('grafica');
    const pauses = applyPauseModel(defaultIntermissions(), 'essenziale');
    expect(resumeStep(progress({ club: named, branding: colored, intermissions: pauses }))).toBe('fatto');
  });

  it('counts a horizontal logo as the logo step done and a chosen team as the squad', () => {
    expect(resumeStep(progress({ branding: { ...defaultBranding(), logoMain: LOGO } }))).toBe('squadra');
    expect(hasSquad(club())).toBe(false);
    expect(hasSquad(club({ ourTeam: { code: null, name: 'Perugia' } }))).toBe(true);
  });

  it('keeps the later of the step reached and the one of the saved data', () => {
    expect(laterStep('squadra', 'logo')).toBe('squadra');
    expect(laterStep('logo', 'colori')).toBe('colori');
    expect(stepIndex('fatto')).toBe(4);
  });
});

describe('brandingWithClub', () => {
  it('takes name, square logo and «nostra squadra» from the club', () => {
    const next = brandingWithClub(defaultBranding(), {
      name: 'x',
      logoUrl: null,
      displayName: 'Sir',
      logoMark: LOGO,
      ourTeam: { code: 'PER', name: null },
      profile: club().profile,
      leagues: [],
      available: [],
    });
    expect(next).toMatchObject({ displayName: 'Sir', logoMark: LOGO, ourTeam: { code: 'PER', name: null } });
  });
});
