import { describe, expect, it } from 'vitest';
import { clubLogoClass } from './clubLogo.ts';

describe('clubLogoClass', () => {
  it('keeps the size of before for «Medio» and for the opponent, whatever the choice', () => {
    expect(clubLogoClass('scoreboardTablet', 'medium', true)).toBe('size-10');
    expect(clubLogoClass('scoreboardTv', 'medium', true)).toBe('size-16');
    expect(clubLogoClass('scoreboardPhone', 'medium', true)).toBe('size-7');
    expect(clubLogoClass('scoreboardTemplate', 'medium', true)).toBe('size-12 sm:size-14');
    expect(clubLogoClass('header', 'medium', true)).toBe('h-8 max-w-48');
    expect(clubLogoClass('scoreboardTablet', 'large', false)).toBe('size-10');
    expect(clubLogoClass('nextMatchPage', 'small', false)).toBe('size-20 sm:size-28');
  });

  it('makes the logo of our team smaller or bigger', () => {
    expect(clubLogoClass('scoreboardTablet', 'small', true)).toBe('size-8');
    expect(clubLogoClass('scoreboardTablet', 'large', true)).toBe('size-14');
    expect(clubLogoClass('scoreboardTv', 'large', true)).toBe('size-24');
    expect(clubLogoClass('header', 'large', true)).toBe('h-12 max-w-64');
  });
});
