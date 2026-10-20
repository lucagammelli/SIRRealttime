import type { TenantIntermissions } from '@arenalive/shared';
import {
  defaultBranding,
  defaultIntermissions,
  defaultLayout,
  defaultOverlays,
  INTERMISSION_KINDS,
  IntermissionSlideSchema,
  LayoutBlockSchema,
  newBlock,
  OVERLAY_KINDS,
} from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import { describe, expect, it } from 'vitest';
import { addBlock, moveBlock, removeBlock, updateBlock } from '../layoutEditor.ts';
import { setOwnPause, withPause } from '../intermissionEditor.ts';
import {
  activeOverlayModel,
  activePauseModel,
  applyOverlayModel,
  applyPauseModel,
  autoScene,
  blockHasSettings,
  brandingChanges,
  intermissionChanges,
  isFirstAccess,
  LEGACY_PAGES,
  layoutChanges,
  listText,
  overlayChanges,
  overlayWhere,
  pauseWhere,
  pickAt,
  sameValue,
  sampleWithOurTeam,
  slideHasSettings,
  stableJson,
  STUDIO_MODELS,
  targetOf,
  targetSelector,
} from './model.ts';

const SPONSOR = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';

const defaults = () => ({
  branding: defaultBranding(),
  layout: defaultLayout(),
  intermissions: defaultIntermissions(),
  overlays: defaultOverlays(),
});

describe('«Rimuovi» asks first only when options of their own would be lost', () => {
  it('blocks: the defaults of the type are not options of their own; position, width and visibility do not count', () => {
    const block = newBlock('message', 'msg', 6);
    expect(blockHasSettings(block)).toBe(false);
    expect(blockHasSettings({ ...block, width: 12, visible: false })).toBe(false);
    expect(
      blockHasSettings(LayoutBlockSchema.parse({ id: 'msg', type: 'message', width: 6, options: { text: 'Ciao' } })),
    ).toBe(true);
    expect(blockHasSettings(newBlock('scoreboard', 'scoreboard'))).toBe(false);
    const court = newBlock('court', 'court');
    expect(blockHasSettings(court)).toBe(false);
    expect(blockHasSettings(LayoutBlockSchema.parse({ ...court, options: { linesOurs: '#ff0000' } }))).toBe(true);
    expect(blockHasSettings(LayoutBlockSchema.parse({ ...court, options: { arrowWidth: 2 } }))).toBe(true);
  });

  it('slides: the defaults of the type are not options of their own; seconds and on/off do not count', () => {
    const slide = IntermissionSlideSchema.parse({ id: 's', type: 'sponsor' });
    expect(slideHasSettings(slide)).toBe(false);
    expect(slideHasSettings({ ...slide, seconds: 20, enabled: false })).toBe(false);
    expect(
      slideHasSettings(IntermissionSlideSchema.parse({ id: 's', type: 'sponsor', options: { sponsors: [SPONSOR] } })),
    ).toBe(true);
  });
});

describe('first access', () => {
  it('only when every document is the default one (the page of the template of the client)', () => {
    expect(isFirstAccess(defaults())).toBe(true);
    // key order does not matter
    const reverse = (v: unknown): unknown =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, reverse(x)]),
          )
        : v;
    const reordered = reverse(defaultOverlays());
    expect(Object.keys(reordered as object)[0]).not.toBe(Object.keys(defaultOverlays())[0]);
    expect(sameValue(reordered, defaultOverlays())).toBe(true);
    expect(isFirstAccess({ ...defaults(), branding: { ...defaultBranding(), colors: { home: '#e30613' } } })).toBe(
      false,
    );
    const sir = { ...defaultBranding(), template: 'sir-volley' as const };
    expect(isFirstAccess({ ...defaults(), branding: sir })).toBe(false);
    expect(isFirstAccess({ ...defaults(), layout: removeBlock(defaultLayout(), 'tv', 'court') })).toBe(false);
    expect(isFirstAccess({ ...defaults(), overlays: { ...defaultOverlays(), size: 'large' } })).toBe(false);
    const pauses = withPause(defaultIntermissions(), 'timeout', { ...defaultIntermissions().timeout, delaySeconds: 9 });
    expect(isFirstAccess({ ...defaults(), intermissions: pauses })).toBe(false);
  });

  it('stableJson ignores the order of the keys and the undefined fields', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
  });
});

describe('scenes', () => {
  it('follow the section and the pause being edited', () => {
    expect(autoScene('colori', 'setBreak')).toBe('play');
    expect(autoScene('pagina', 'timeout')).toBe('play');
    expect(autoScene('pause', 'timeout')).toBe('timeout');
    expect(autoScene('pause', 'milestone')).toBe('milestone');
    expect(autoScene('avvisi', 'setBreak')).toBe('overlay');
  });

  it('old pages lead to their section', () => {
    expect(LEGACY_PAGES).toEqual({ grafica: 'colori', pagina: 'pagina', pause: 'pause', avvisi: 'avvisi' });
  });
});

describe('changes of a section («Vedi modifiche»)', () => {
  it('branding: colours, template, name, team, images', () => {
    const base = defaultBranding();
    const draft = {
      ...base,
      template: 'sir-volley' as const,
      displayName: 'Sir Safety',
      colors: { away: '#003399' },
      ourTeam: { code: 'PER', name: null },
      logoMain: SPONSOR,
    };
    expect(brandingChanges(base, draft)).toEqual([
      { label: 'Modello grafico', detail: 'Standard → SIR VOLLEY' },
      { label: 'Nome visualizzato', detail: 'nome del cliente → Sir Safety' },
      { label: 'Squadra ospite', detail: 'modello → #003399' },
      { label: 'Nostra squadra: codice', detail: 'nessuno → PER' },
      { label: 'Logo orizzontale', detail: 'aggiunto' },
    ]);
    expect(brandingChanges(base, base)).toEqual([]);
  });

  it('layout: added, removed, changed and moved blocks, device by device', () => {
    const base = defaultLayout();
    let draft = addBlock(base, 'tablet', 'message');
    draft = removeBlock(draft, 'phone', 'court');
    draft = updateBlock(draft, 'tv', 'momentum', (b) => ({ ...b, visible: false, width: 12 }));
    draft = moveBlock(draft, 'tv', 0, 2);
    expect(layoutChanges(base, draft)).toEqual([
      { label: 'TV', detail: '«Andamento del set»: nascosto, larghezza 8/12 → 12/12' },
      { label: 'TV', detail: 'ordine dei blocchi' },
      { label: 'Tablet', detail: 'aggiunto «Messaggio»' },
      { label: 'Telefono', detail: 'tolto «Mappe di campo»' },
    ]);
  });

  it('pauses and overlays', () => {
    const base = defaultIntermissions();
    let draft = setOwnPause(base, '3', true);
    draft = withPause(draft, 'timeout', {
      ...base.timeout,
      enabled: false,
      modes: { ...base.timeout.modes, tv: 'fullscreen' },
    });
    draft = { ...draft, milestone: { ...draft.milestone, every: 10 } };
    expect(intermissionChanges(base, draft)).toEqual([
      { label: 'Fine set, 3° set', detail: 'pausa propria' },
      { label: 'Time-out', detail: 'disattivata' },
      { label: 'Time-out', detail: 'TV: Banda in basso → Tutto schermo' },
      { label: 'Ogni N punti', detail: 'ogni 8 → 10 punti' },
    ]);
    const overlays = defaultOverlays();
    expect(
      overlayChanges(overlays, { ...overlays, size: 'large', ace: { ...overlays.ace, text: 'Ace!', seconds: 6 } }),
    ).toEqual([
      { label: 'Dimensione di tutti gli avvisi', detail: 'Medio → Grande' },
      { label: 'Ace', detail: 'testo «Ace!», 4 s → 6 s' },
    ]);
  });
});

describe('ready-made models', () => {
  it('the default pauses and overlays are «Completo»; every model is recognized, a change makes it «Personalizzato»', () => {
    expect(activePauseModel(defaultIntermissions())).toBe('completo');
    expect(activeOverlayModel(defaultOverlays())).toBe('completo');
    for (const m of STUDIO_MODELS) {
      const pauses = applyPauseModel(defaultIntermissions(), m);
      expect(activePauseModel(pauses)).toBe(m);
      const overlays = applyOverlayModel(defaultOverlays(), m);
      expect(activeOverlayModel(overlays)).toBe(m);
    }
    const tweaked = withPause(applyPauseModel(defaultIntermissions(), 'essenziale'), 'timeout', {
      ...defaultIntermissions().timeout,
      delaySeconds: 2,
    });
    expect(activePauseModel(tweaked)).toBeNull();
    const overlays = applyOverlayModel(defaultOverlays(), 'sponsor');
    expect(activeOverlayModel({ ...overlays, tie: { ...overlays.tie, enabled: true } })).toBeNull();
  });

  it('keep the sponsor images and the rule of the «ogni N punti», take away the own pauses of the sets', () => {
    let config: TenantIntermissions = setOwnPause(defaultIntermissions(), '2', true);
    config = withPause(config, 'timeout', {
      ...config.timeout,
      slides: config.timeout.slides.map((s) =>
        s.type === 'sponsor' ? { ...s, options: { ...s.options, images: [SPONSOR] } } : s,
      ),
    });
    config = { ...config, milestone: { ...config.milestone, every: 12, stopBeforeEnd: 3 } };
    for (const m of STUDIO_MODELS) {
      const next = applyPauseModel(config, m);
      expect(next.setBreakBySet).toEqual({});
      expect(next.milestone).toMatchObject({ every: 12, stopBeforeEnd: 3 });
      for (const kind of INTERMISSION_KINDS)
        for (const s of next[kind].slides) if (s.type === 'sponsor') expect(s.options.images).toEqual([SPONSOR]);
      // On the phone the end of set stays a banner at the bottom, as by default.
      expect(next.setBreak.modes.phone).toBe('banner');
      expect(activePauseModel(next)).toBe(m);
    }
  });

  it('the overlay models keep texts, devices and own placements', () => {
    const base = defaultOverlays();
    const own = { ...base, ace: { ...base.ace, text: 'Ace di {numero}', position: 'bottom' as const } };
    const next = applyOverlayModel(own, 'essenziale');
    expect(next.ace).toMatchObject({ text: 'Ace di {numero}', position: 'bottom', enabled: false });
    expect(OVERLAY_KINDS.filter((k) => next[k].enabled)).toEqual(['matchEnd', 'matchPoint', 'setEnd', 'setPoint']);
  });
});

describe('«Compare: …»', () => {
  it('says where a pause and an overlay appear', () => {
    const pauses = defaultIntermissions();
    expect(pauseWhere(pauses.setBreak, 'setBreak')).toBe(
      'a tutto schermo su TV e tablet, banda in basso su telefono, a fine set',
    );
    expect(pauseWhere({ ...pauses.timeout, enabled: false }, 'timeout')).toBe('spenta, non compare');
    expect(pauseWhere(undefined, 'setBreak')).toBe('come «Tutti i set», a fine set');
    const overlays = defaultOverlays();
    expect(overlayWhere(overlays, overlays.longRally)).toBe('TV e tablet, in alto, medio, sopra la partita');
    expect(overlayWhere(overlays, overlays.timeout)).toBe('spento, non compare');
    expect(listText(['a'])).toBe('a');
  });
});

describe('marks of the preview', () => {
  it('selectors and targets', () => {
    expect(targetSelector('block:momentum')).toBe('[data-studio-block="momentum"]');
    expect(targetSelector('type:scoreboard')).toBe('[data-studio-type="scoreboard"]');
    expect(targetSelector('slide:sponsor')).toBe('[data-studio-slide="sponsor"], [data-studio-slide^="sponsor:"]');
    expect(targetOf({ slide: 'roleDuel:opposite' })).toBe('slide:roleDuel');
    expect(targetSelector('pause')).toBe('[data-intermission]');
    expect(targetSelector('overlay')).toBe('[data-overlay]');
    expect(targetSelector('page')).toBe('[data-studio-page]');
    expect(targetOf({ block: 'court' })).toBe('block:court');
    expect(targetOf({ slide: 'mvp', intermission: false })).toBe('slide:mvp');
    expect(targetOf({ intermission: true })).toBe('pause');
    expect(targetOf({ overlay: true })).toBe('overlay');
    expect(targetOf({})).toBe('page');
  });

  it('a click picks the smallest element under the pointer', () => {
    const boxes = [
      { target: 'page' as const, left: 0, top: 0, width: 1000, height: 600 },
      { target: 'block:scoreboard' as const, left: 0, top: 0, width: 1000, height: 150 },
      { target: 'block:momentum' as const, left: 0, top: 160, width: 500, height: 300 },
      { target: 'block:empty' as const, left: 0, top: 0, width: 0, height: 0 },
    ];
    expect(pickAt(boxes, 100, 200)).toBe('block:momentum');
    expect(pickAt(boxes, 100, 100)).toBe('block:scoreboard');
    expect(pickAt(boxes, 900, 500)).toBe('page');
    expect(pickAt(boxes, 2000, 2000)).toBeNull();
  });

  it('the example match takes the team of the client as home team', () => {
    const state = { teams: { home: { name: 'Pallavolo Città', code: 'PAL' }, away: { name: 'Lugo', code: 'VOL' } } };
    const sample = state as unknown as MatchState;
    expect(sampleWithOurTeam(sample, { code: null, name: null }, 'Sir')).toBe(sample);
    expect(sampleWithOurTeam(sample, { code: 'PER', name: 'Perugia' }, 'Sir').teams.home).toEqual({
      name: 'Perugia',
      code: 'PER',
    });
    expect(sampleWithOurTeam(sample, { code: 'PER', name: null }, 'Sir Safety').teams.home.name).toBe('Sir Safety');
  });
});
