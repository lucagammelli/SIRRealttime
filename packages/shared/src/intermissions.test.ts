import { DUEL_ROLES, TEAM_DUEL_KEYS } from '@arenalive/volley-stats';
import { describe, expect, it } from 'vitest';
import {
  AFTER_MATCH_DEFAULT_DELAY_MINUTES,
  AFTER_MATCH_MAX_DELAY_MINUTES,
  afterMatchImage,
  DUEL_ROLE_CHOICES,
  MILESTONE_DEFAULT_EVERY,
  MILESTONE_DEFAULT_STOP_BEFORE_END,
  MILESTONE_MAX_EVERY,
  MILESTONE_MAX_STOP_BEFORE_END,
  MILESTONE_MIN_EVERY,
  MILESTONE_MIN_STOP_BEFORE_END,
  SCORERS_MAX,
  SCORERS_MIN,
  allIntermissions,
  defaultIntermission,
  defaultIntermissions,
  INTERMISSION_MAX_DELAY_SECONDS,
  INTERMISSION_MAX_SLIDES,
  intermissionFor,
  intermissionImageIds,
  IntermissionSlideSchema,
  PublicTenantResponseSchema,
  resolveIntermissions,
  SLIDE_MAX_SECONDS,
  SLIDE_MIN_SECONDS,
  SLIDE_TYPES,
  TenantIntermissionsSchema,
  THANKS_MESSAGE,
} from './index.js';

const IMG_A = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const IMG_B = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';

const types = (slides: readonly { type: string }[]): string[] => slides.map((s) => s.type);
const SET_BREAK_TYPES = [
  'setSummary',
  'setScorers',
  'aces',
  'blocks',
  'roleDuel',
  'teamDuel',
  'standings',
  'nextMatch',
  'sponsor',
];

describe('pauses of the public page: defaults', () => {
  it('reads the empty database document as the defaults of every pause', () => {
    const config = TenantIntermissionsSchema.parse({});
    expect(config).toEqual(defaultIntermissions());
    expect(config.version).toBe(1);
    expect(config.setBreakBySet).toEqual({});
  });

  it('time-out: compact banner with the sponsors, at once', () => {
    const { timeout } = defaultIntermissions();
    expect(timeout).toMatchObject({ enabled: true, delaySeconds: 0 });
    expect(timeout.modes).toEqual({ tv: 'banner', tablet: 'banner', phone: 'banner' });
    expect(types(timeout.slides)).toEqual(['sponsor']);
  });

  it('end of set: full screen on TV and tablet, banner on the phone, summary, statistics of the set and sponsors after 5 s', () => {
    const { setBreak } = defaultIntermissions();
    expect(setBreak.modes).toEqual({ tv: 'fullscreen', tablet: 'fullscreen', phone: 'banner' });
    expect(setBreak.delaySeconds).toBe(5);
    expect(types(setBreak.slides)).toEqual(SET_BREAK_TYPES);
    const duel = setBreak.slides.find((s) => s.type === 'roleDuel');
    expect(duel?.options).toEqual({ period: 'set', role: 'rotate' });
    const scorers = setBreak.slides.find((s) => s.type === 'setScorers');
    expect(scorers?.options).toEqual({ period: 'set', limit: 5 });
    const team = setBreak.slides.find((s) => s.type === 'teamDuel');
    expect(team?.options).toEqual({ period: 'set', rows: [] });
  });

  it('end of match: full screen with result, MVP, statistics of the match, thanks and sponsors', () => {
    const { matchEnd } = defaultIntermissions();
    expect(matchEnd.modes).toEqual({ tv: 'fullscreen', tablet: 'fullscreen', phone: 'fullscreen' });
    expect(types(matchEnd.slides)).toEqual([
      'finalResult',
      'mvp',
      'setScorers',
      'roleDuel',
      'teamDuel',
      'standings',
      'nextMatch',
      'message',
      'sponsor',
    ]);
    for (const slide of matchEnd.slides.slice(2, 5)) expect(slide.options).toMatchObject({ period: 'match' });
    expect(matchEnd.slides[7]).toMatchObject({ options: { text: THANKS_MESSAGE, size: 'large' } });
    expect(THANKS_MESSAGE).toBe('Grazie per aver seguito la partita');
  });

  it('«ogni N punti»: every 8 points but the last 5 of the set, banner (full screen on TV), scorers and teams of the set', () => {
    const { milestone } = defaultIntermissions();
    expect(milestone).toMatchObject({
      enabled: true,
      every: MILESTONE_DEFAULT_EVERY,
      stopBeforeEnd: MILESTONE_DEFAULT_STOP_BEFORE_END,
    });
    expect(MILESTONE_DEFAULT_EVERY).toBe(8);
    expect(MILESTONE_DEFAULT_STOP_BEFORE_END).toBe(5);
    expect(milestone.modes).toEqual({ tv: 'fullscreen', tablet: 'banner', phone: 'banner' });
    expect(types(milestone.slides)).toEqual(['setScorers', 'teamDuel']);
    for (const slide of milestone.slides) expect(slide.options).toMatchObject({ period: 'set' });
    expect(defaultIntermission('milestone')).toEqual(milestone);
  });

  it('«Prossima partita» and «Classifica» come after the statistics, with the options of the blocks', () => {
    const { setBreak, matchEnd } = defaultIntermissions();
    for (const pause of [setBreak, matchEnd]) {
      const list = types(pause.slides);
      expect(list.indexOf('standings')).toBeGreaterThan(list.indexOf('teamDuel'));
      expect(list.indexOf('nextMatch')).toBe(list.indexOf('standings') + 1);
      expect(pause.slides.find((s) => s.type === 'standings')?.options).toEqual({ scope: 'around', count: 5 });
      expect(pause.slides.find((s) => s.type === 'nextMatch')?.options).toEqual({ qr: true });
    }
    expect(IntermissionSlideSchema.safeParse({ id: 'c', type: 'standings', options: { scope: 'all' } }).success).toBe(
      true,
    );
    expect(IntermissionSlideSchema.safeParse({ id: 'c', type: 'standings', options: { scope: 'tutte' } }).success).toBe(
      false,
    );
    expect(IntermissionSlideSchema.safeParse({ id: 'c', type: 'nextMatch', options: { qr: 'si' } }).success).toBe(
      false,
    );
  });

  it('a partial pause takes the defaults of its own kind', () => {
    const config = TenantIntermissionsSchema.parse({
      timeout: { delaySeconds: 3 },
      setBreak: { modes: { tv: 'banner' } },
    });
    expect(config.timeout).toEqual({ ...defaultIntermission('timeout'), delaySeconds: 3 });
    expect(config.setBreak.modes).toEqual({ tv: 'banner', tablet: 'fullscreen', phone: 'banner' });
    expect(types(config.setBreak.slides)).toEqual(SET_BREAK_TYPES);
  });

  it('every slide type has defaults and every default is a new object', () => {
    for (const type of SLIDE_TYPES) expect(IntermissionSlideSchema.safeParse({ id: type, type }).success).toBe(true);
    const a = defaultIntermissions();
    a.setBreak.slides.pop();
    expect(defaultIntermissions().setBreak.slides).toHaveLength(SET_BREAK_TYPES.length);
  });

  it('a document saved before the new slides and the «ogni N punti» stays valid as it was', () => {
    const old = {
      version: 1,
      timeout: { enabled: true, modes: { tv: 'banner', tablet: 'banner', phone: 'banner' }, delaySeconds: 0 },
      setBreak: { slides: [{ id: 'setSummary', type: 'setSummary', seconds: 12, options: {} }] },
      setBreakBySet: { '2': { slides: [{ id: 'q', type: 'qr', seconds: 8, options: { caption: 'Ciao' } }] } },
      matchEnd: { slides: [{ id: 'mvp', type: 'mvp', seconds: 10, options: {} }] },
    };
    const parsed = TenantIntermissionsSchema.safeParse(old);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(types(parsed.data.setBreak.slides)).toEqual(['setSummary']);
    expect(types(parsed.data.matchEnd.slides)).toEqual(['mvp']);
    expect(parsed.data.milestone).toEqual(defaultIntermission('milestone'));
    expect(resolveIntermissions(old)).toEqual(parsed.data);
  });
});

describe('pauses of the public page: slides of the statistics', () => {
  const parse = (doc: unknown) => TenantIntermissionsSchema.safeParse(doc);
  const slide = (type: string, options: unknown) => ({ setBreak: { slides: [{ id: 's', type, options }] } });

  it('period of the set or of the match, nothing else', () => {
    for (const type of ['setScorers', 'aces', 'blocks', 'attack', 'roleDuel', 'teamDuel']) {
      expect(parse(slide(type, { period: 'match' })).success).toBe(true);
      expect(parse(slide(type, { period: 'set' })).success).toBe(true);
      expect(parse(slide(type, { period: 'week' })).success).toBe(false);
      expect(parse(slide(type, { period: 'set', extra: 1 })).success).toBe(false);
    }
  });

  it('scorers: 3-8 for each team', () => {
    expect(parse(slide('setScorers', { limit: SCORERS_MIN })).success).toBe(true);
    expect(parse(slide('setScorers', { limit: SCORERS_MAX })).success).toBe(true);
    expect(parse(slide('setScorers', { limit: SCORERS_MIN - 1 })).success).toBe(false);
    expect(parse(slide('setScorers', { limit: SCORERS_MAX + 1 })).success).toBe(false);
  });

  it('player duel: one role of the duels or all of them in turn', () => {
    expect(DUEL_ROLE_CHOICES).toEqual(['rotate', ...DUEL_ROLES]);
    for (const role of DUEL_ROLE_CHOICES) expect(parse(slide('roleDuel', { role })).success).toBe(true);
    expect(parse(slide('roleDuel', { role: 'coach' })).success).toBe(false);
  });

  it('team duel: rows of TEAM_DUEL_KEYS of @arenalive/volley-stats, chosen once each (empty: all)', () => {
    expect(parse(slide('teamDuel', { rows: ['points', 'aces'] })).success).toBe(true);
    expect(parse(slide('teamDuel', { rows: [...TEAM_DUEL_KEYS] })).success).toBe(true);
    expect(parse(slide('teamDuel', { rows: [] })).success).toBe(true);
    expect(parse(slide('teamDuel', { rows: ['points', 'points'] })).success).toBe(false);
    expect(parse(slide('teamDuel', { rows: ['height'] })).success).toBe(false);
  });

  it('«ogni N punti»: N 4-25, «non negli ultimi K punti» 1-15, an active pause has slides', () => {
    const m = (milestone: unknown) => parse({ milestone });
    expect(m({ every: MILESTONE_MIN_EVERY }).success).toBe(true);
    expect(m({ every: MILESTONE_MAX_EVERY }).success).toBe(true);
    expect(m({ every: MILESTONE_MIN_EVERY - 1 }).success).toBe(false);
    expect(m({ every: MILESTONE_MAX_EVERY + 1 }).success).toBe(false);
    expect(m({ every: 7.5 }).success).toBe(false);
    expect(m({ stopBeforeEnd: MILESTONE_MIN_STOP_BEFORE_END }).success).toBe(true);
    expect(m({ stopBeforeEnd: MILESTONE_MAX_STOP_BEFORE_END }).success).toBe(true);
    expect(m({ stopBeforeEnd: MILESTONE_MIN_STOP_BEFORE_END - 1 }).success).toBe(false);
    expect(m({ stopBeforeEnd: MILESTONE_MAX_STOP_BEFORE_END + 1 }).success).toBe(false);
    expect(m({ maxTeamScore: 20 }).success).toBe(false);
    expect(m({ slides: [] }).success).toBe(false);
    expect(m({ enabled: false, slides: [] }).success).toBe(true);
    expect(m({ html: '<b>' }).success).toBe(false);
    const parsed = TenantIntermissionsSchema.parse({ milestone: { every: 10, modes: { phone: 'fullscreen' } } });
    expect(parsed.milestone).toMatchObject({ every: 10, stopBeforeEnd: 5 });
    expect(parsed.milestone.modes).toEqual({ tv: 'fullscreen', tablet: 'banner', phone: 'fullscreen' });
    expect(intermissionFor(parsed, 'milestone')).toBe(parsed.milestone);
  });
});

describe('pauses of the public page: validation', () => {
  const parse = (doc: unknown) => TenantIntermissionsSchema.safeParse(doc);

  it('refuses unknown slide types, unknown fields and other versions', () => {
    expect(parse({ timeout: { slides: [{ id: 'x', type: 'iframe' }] } }).success).toBe(false);
    expect(parse({ timeout: { html: '<b>' } }).success).toBe(false);
    expect(parse({ pause: {} }).success).toBe(false);
    expect(parse({ version: 2 }).success).toBe(false);
    expect(parse({ setBreakBySet: { '5': {} } }).success).toBe(false);
    expect(parse({ timeout: { modes: { tv: 'popup' } } }).success).toBe(false);
  });

  it('checks the limits of durations, delay and number of slides', () => {
    const slide = (seconds: number) => ({ timeout: { slides: [{ id: 's', type: 'mvp', seconds }] } });
    expect(parse(slide(SLIDE_MIN_SECONDS)).success).toBe(true);
    expect(parse(slide(SLIDE_MAX_SECONDS)).success).toBe(true);
    expect(parse(slide(SLIDE_MIN_SECONDS - 1)).success).toBe(false);
    expect(parse(slide(SLIDE_MAX_SECONDS + 1)).success).toBe(false);
    expect(parse(slide(4.5)).success).toBe(false);
    expect(parse({ setBreak: { delaySeconds: INTERMISSION_MAX_DELAY_SECONDS } }).success).toBe(true);
    expect(parse({ setBreak: { delaySeconds: INTERMISSION_MAX_DELAY_SECONDS + 1 } }).success).toBe(false);
    expect(parse({ setBreak: { delaySeconds: -1 } }).success).toBe(false);
    const many = Array.from({ length: INTERMISSION_MAX_SLIDES + 1 }, (_, i) => ({ id: `m${i}`, type: 'mvp' }));
    expect(parse({ matchEnd: { slides: many } }).success).toBe(false);
    expect(parse({ matchEnd: { slides: many.slice(1) } }).success).toBe(true);
  });

  it('refuses repeated ids and an active pause without slides (an inactive one may have none)', () => {
    const twice = [
      { id: 'a', type: 'mvp' },
      { id: 'a', type: 'qr' },
    ];
    expect(parse({ matchEnd: { slides: twice } }).success).toBe(false);
    expect(parse({ timeout: { slides: [] } }).success).toBe(false);
    expect(parse({ timeout: { enabled: false, slides: [] } }).success).toBe(true);
  });

  it('reuses the options of the blocks: plain text, existing sponsor rules', () => {
    const message = (text: string) => ({ matchEnd: { slides: [{ id: 'm', type: 'message', options: { text } }] } });
    expect(parse(message('<b>ciao</b>')).success).toBe(true);
    expect(parse(message('   ')).success).toBe(false);
    expect(parse(message('riga\nnuova')).success).toBe(false);
    const sponsor = (images: string[]) => ({
      timeout: { slides: [{ id: 's', type: 'sponsor', options: { images } }] },
    });
    expect(parse(sponsor([IMG_A, IMG_A])).success).toBe(false);
    expect(parse(sponsor(['non-un-id'])).success).toBe(false);
  });

  it('an invalid stored document reads as the defaults', () => {
    expect(resolveIntermissions({ timeout: { slides: 3 } })).toEqual(defaultIntermissions());
    expect(resolveIntermissions(null)).toEqual(defaultIntermissions());
    expect(resolveIntermissions({ timeout: { enabled: false } }).timeout.enabled).toBe(false);
  });
});

describe('pauses of the public page: inheritance and images', () => {
  const config = TenantIntermissionsSchema.parse({
    setBreak: { delaySeconds: 10, slides: [{ id: 'sp', type: 'sponsor', options: { images: [IMG_A] } }] },
    setBreakBySet: {
      '2': { slides: [{ id: 'q', type: 'qr' }], modes: { phone: 'fullscreen' } },
      '3': { enabled: false },
    },
    matchEnd: { slides: [{ id: 'sp2', type: 'sponsor', options: { images: [IMG_B, IMG_A] } }] },
  });

  it('a set without its own pause uses the generic one; a set with it uses it as a whole', () => {
    expect(intermissionFor(config, 'setBreak', 1)).toBe(config.setBreak);
    expect(intermissionFor(config, 'setBreak', 4)).toBe(config.setBreak);
    expect(intermissionFor(config, 'setBreak')).toBe(config.setBreak);
    const second = intermissionFor(config, 'setBreak', 2);
    expect(types(second?.slides ?? [])).toEqual(['qr']);
    // the own pause takes the defaults of the end of set, not the fields of the generic one
    expect(second?.delaySeconds).toBe(5);
    expect(second?.modes).toEqual({ tv: 'fullscreen', tablet: 'fullscreen', phone: 'fullscreen' });
    expect(intermissionFor(config, 'setBreak', 3)).toBeNull();
    // the 5th set never has its own pause
    expect(intermissionFor(config, 'setBreak', 5)).toBe(config.setBreak);
  });

  it('an inactive pause gives null; the other kinds ignore the set', () => {
    const off = TenantIntermissionsSchema.parse({ timeout: { enabled: false } });
    expect(intermissionFor(off, 'timeout')).toBeNull();
    expect(intermissionFor(off, 'matchEnd', 2)).toBe(off.matchEnd);
  });

  it('a slide is on unless saved off (older documents have no field); a pause with every slide off gives null', () => {
    const saved = TenantIntermissionsSchema.parse({ timeout: { slides: [{ id: 'q', type: 'qr' }] } });
    expect(saved.timeout.slides[0]?.enabled).toBe(true);
    const allOff = TenantIntermissionsSchema.parse({
      timeout: { slides: [{ id: 'q', type: 'qr', enabled: false }] },
      matchEnd: {
        slides: [
          { id: 'q', type: 'qr', enabled: false },
          { id: 'm', type: 'mvp' },
        ],
      },
    });
    expect(allOff.timeout.slides[0]?.enabled).toBe(false);
    expect(intermissionFor(allOff, 'timeout')).toBeNull();
    expect(intermissionFor(allOff, 'matchEnd')).toBe(allOff.matchEnd);
  });

  it('lists every pause and the images of every sponsor slide once', () => {
    expect(allIntermissions(config)).toHaveLength(6);
    expect(intermissionImageIds(config)).toEqual([IMG_A, IMG_B]);
    expect(intermissionImageIds(defaultIntermissions())).toEqual([]);
  });

  it('is part of the public graphics (defaults when an older answer misses it)', () => {
    const res = PublicTenantResponseSchema.parse({
      name: 'SIR',
      branding: {},
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
    });
    expect(res.intermissions).toEqual(defaultIntermissions());
  });
});

describe('afterMatch («Dopo la partita»)', () => {
  it('is off without an image by default, also for documents saved before it existed', () => {
    const expected = { enabled: false, image: null, delayMinutes: AFTER_MATCH_DEFAULT_DELAY_MINUTES };
    expect(defaultIntermissions().afterMatch).toEqual(expected);
    expect(resolveIntermissions({ timeout: { enabled: false } }).afterMatch).toEqual(expected);
    expect(afterMatchImage(defaultIntermissions().afterMatch)).toBeNull();
  });

  it('keeps image and minutes, and checks their limits', () => {
    const on = TenantIntermissionsSchema.parse({ afterMatch: { enabled: true, image: IMG_A, delayMinutes: 0 } });
    expect(on.afterMatch).toEqual({ enabled: true, image: IMG_A, delayMinutes: 0 });
    expect(afterMatchImage(on.afterMatch)).toBe(IMG_A);
    expect(afterMatchImage({ ...on.afterMatch, enabled: false })).toBeNull();
    for (const delayMinutes of [-1, AFTER_MATCH_MAX_DELAY_MINUTES + 1, 1.5])
      expect(TenantIntermissionsSchema.safeParse({ afterMatch: { delayMinutes } }).success).toBe(false);
    expect(TenantIntermissionsSchema.safeParse({ afterMatch: { image: 'logo.png' } }).success).toBe(false);
    expect(TenantIntermissionsSchema.safeParse({ afterMatch: { extra: 1 } }).success).toBe(false);
  });

  it('lists its image with the images of the pauses, even when off', () => {
    const config = TenantIntermissionsSchema.parse({ afterMatch: { image: IMG_B } });
    expect(intermissionImageIds(config)).toEqual([IMG_B]);
  });
});
