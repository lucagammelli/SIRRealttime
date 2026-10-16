import { MATCH_EVENT_KINDS, MATCH_EVENT_PRIORITY } from '@sir/volley-stats';
import { describe, expect, it } from 'vitest';
import {
  defaultOverlay,
  defaultOverlays,
  defaultOverlayText,
  fillOverlayText,
  OVERLAY_KINDS,
  OVERLAY_MAX_SECONDS,
  OVERLAY_MIN_SECONDS,
  OVERLAY_PLACEHOLDERS,
  OVERLAY_TEXT_MAX,
  OverlaysResponseSchema,
  OverlayTextSchema,
  overlayTextProblem,
  PublicTenantResponseSchema,
  resolveOverlays,
  TenantOverlaysSchema,
} from './index.js';

describe('overlays: defaults', () => {
  it('reads the empty database document as the defaults of every event of volley-stats', () => {
    const config = TenantOverlaysSchema.parse({});
    expect(config).toEqual(defaultOverlays());
    expect(config.version).toBe(1);
    expect([...OVERLAY_KINDS]).toEqual([...MATCH_EVENT_KINDS]);
    for (const kind of OVERLAY_KINDS) {
      expect(config[kind].priority).toBe(MATCH_EVENT_PRIORITY[kind]);
      expect(config[kind].seconds).toBe(4);
      expect(overlayTextProblem(config[kind].text)).toBeNull();
    }
  });

  it('sensible Italian texts; time-out off, substitutions not on the phone', () => {
    expect(defaultOverlayText('ace')).toBe('ACE! {giocatore}');
    expect(defaultOverlayText('matchPoint')).toBe('MATCH POINT {squadra}');
    expect(defaultOverlayText('block')).toBe('Muro di {giocatore}');
    expect(defaultOverlayText('run')).toBe('Break di {serie} punti per {squadra}');
    const config = defaultOverlays();
    expect(config.timeout.enabled).toBe(false);
    expect(config.ace).toEqual({
      enabled: true,
      text: 'ACE! {giocatore}',
      seconds: 4,
      devices: { tv: true, tablet: true, phone: true },
      priority: MATCH_EVENT_PRIORITY.ace,
    });
    expect(config.substitution.devices).toEqual({ tv: true, tablet: true, phone: false });
  });

  it('a partial overlay takes the defaults of its own kind; defaults are new objects', () => {
    const config = TenantOverlaysSchema.parse({ ace: { seconds: 6 }, block: { devices: { phone: false } } });
    expect(config.ace).toEqual({ ...defaultOverlay('ace'), seconds: 6 });
    expect(config.block.devices).toEqual({ tv: true, tablet: true, phone: false });
    const a = defaultOverlays();
    a.ace.devices.tv = false;
    expect(defaultOverlays().ace.devices.tv).toBe(true);
  });

  it('is in the public graphics (missing in an older answer: the defaults) and in the admin answer', () => {
    const pub = PublicTenantResponseSchema.parse({
      name: 'Sir',
      branding: {},
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
    });
    expect(pub.overlays).toEqual(defaultOverlays());
    expect(OverlaysResponseSchema.safeParse({ tenantName: 'Sir', overlays: {} }).success).toBe(true);
  });

  it('an invalid stored document reads as the defaults', () => {
    expect(resolveOverlays(null)).toEqual(defaultOverlays());
    expect(resolveOverlays({ ace: { text: '{nome}' } })).toEqual(defaultOverlays());
    expect(resolveOverlays({ ace: { enabled: false } }).ace.enabled).toBe(false);
  });
});

describe('overlays: validation', () => {
  const parse = (doc: unknown) => TenantOverlaysSchema.safeParse(doc);

  it('accepts every placeholder of the list', () => {
    for (const name of OVERLAY_PLACEHOLDERS) expect(OverlayTextSchema.safeParse(`Testo {${name}}`).success).toBe(true);
    expect(OverlayTextSchema.safeParse('{giocatore} {numero} {squadra} {punteggio} {set} {serie}').success).toBe(true);
    expect(OverlayTextSchema.safeParse('Nessun segnaposto').success).toBe(true);
  });

  it('refuses unknown placeholders, stray braces, HTML, control characters, empty and too long texts', () => {
    expect(overlayTextProblem('Ciao {nome}')).toBe('segnaposto sconosciuto: {nome}');
    expect(overlayTextProblem('{Giocatore}')).toContain('sconosciuto');
    expect(overlayTextProblem('{}')).toContain('sconosciuto');
    expect(overlayTextProblem('{ giocatore }')).toContain('sconosciuto');
    expect(overlayTextProblem('{{giocatore}}')).not.toBeNull();
    expect(overlayTextProblem('ACE {giocatore')).toBe('parentesi graffa senza segnaposto');
    expect(overlayTextProblem('ACE }')).not.toBeNull();
    expect(overlayTextProblem('<b>ACE</b>')).not.toBeNull();
    expect(overlayTextProblem('<img src=x onerror=alert(1)>')).not.toBeNull();
    for (const bad of ['', '   ', 'riga\nnuova', 'x'.repeat(OVERLAY_TEXT_MAX + 1), '<script>']) {
      expect(OverlayTextSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('refuses bad durations and priorities, unknown events and fields, other versions', () => {
    expect(parse({ ace: { seconds: OVERLAY_MIN_SECONDS - 1 } }).success).toBe(false);
    expect(parse({ ace: { seconds: OVERLAY_MAX_SECONDS + 1 } }).success).toBe(false);
    expect(parse({ ace: { seconds: 2.5 } }).success).toBe(false);
    expect(parse({ ace: { priority: 0 } }).success).toBe(false);
    expect(parse({ ace: { priority: 11 } }).success).toBe(false);
    expect(parse({ ace: { devices: { watch: true } } }).success).toBe(false);
    expect(parse({ ace: { html: '<b>' } }).success).toBe(false);
    expect(parse({ goal: {} }).success).toBe(false);
    expect(parse({ version: 2 }).success).toBe(false);
    expect(parse({ ace: { seconds: OVERLAY_MAX_SECONDS, priority: 10, text: 'Ace di {numero}' } }).success).toBe(true);
  });
});

describe('overlays: text of an overlay', () => {
  it('replaces the placeholders with the values, missing ones empty, spaces collapsed', () => {
    expect(fillOverlayText('ACE! {giocatore}', { giocatore: 'Rossi M.' })).toBe('ACE! Rossi M.');
    expect(fillOverlayText('ACE! {giocatore}', {})).toBe('ACE!');
    expect(fillOverlayText('Cambio {squadra}: entra {giocatore} ({numero})', { squadra: 'Alfa', numero: '12' })).toBe(
      'Cambio Alfa: entra (12)',
    );
    expect(
      fillOverlayText('{squadra} vince il {set}° set {punteggio}', { squadra: 'Alfa', set: '2', punteggio: '25-20' }),
    ).toBe('Alfa vince il 2° set 25-20');
  });

  it('a value is inserted as text, never read again as a placeholder or as HTML', () => {
    expect(fillOverlayText('Muro di {giocatore}', { giocatore: '{squadra} <b>' })).toBe('Muro di {squadra} <b>');
  });
});
