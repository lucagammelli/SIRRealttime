import { MATCH_EVENT_KINDS, MATCH_EVENT_PRIORITY } from '@arenalive/volley-stats';
import { describe, expect, it } from 'vitest';
import {
  backgroundForTeam,
  OverlayBackgroundSchema,
  AssetKindSchema,
  AssetSummarySchema,
  defaultOverlay,
  defaultOverlays,
  defaultOverlayText,
  fillOverlayText,
  OVERLAY_KINDS,
  overlayPlacement,
  OVERLAY_MAX_SECONDS,
  OVERLAY_MIN_SECONDS,
  OVERLAY_VIDEO_DURATIONS,
  OVERLAY_VIDEO_MAX_SECONDS,
  OVERLAY_PLACEHOLDERS,
  OVERLAY_TEXT_MAX,
  OverlaysResponseSchema,
  OverlayTextSchema,
  overlayTextProblem,
  PublicTenantResponseSchema,
  resolveOverlays,
  TenantOverlaysSchema,
  isVideoMime,
  overlayBackgrounds,
  withoutOverlayBackgrounds,
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

  it('point in attack: off by default, also in a stored document saved before it existed', () => {
    expect(defaultOverlayText('attack')).toBe('Attacco vincente di {giocatore}');
    expect(defaultOverlays().attack).toEqual({
      enabled: false,
      text: 'Attacco vincente di {giocatore}',
      seconds: 4,
      devices: { tv: true, tablet: true, phone: true },
      priority: MATCH_EVENT_PRIORITY.attack,
    });
    const old = TenantOverlaysSchema.parse({ version: 1, ace: { enabled: false }, block: { seconds: 6 } });
    expect(old.attack).toEqual(defaultOverlay('attack'));
    expect(resolveOverlays({ attack: { enabled: true } }).attack.enabled).toBe(true);
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

describe('overlays: position and size', () => {
  it('defaults are the look before the setting: top, medium; no own value on the single overlays', () => {
    const config = defaultOverlays();
    expect(config.position).toBe('top');
    expect(config.size).toBe('medium');
    expect(config.ace.position).toBeUndefined();
    expect(config.ace.size).toBeUndefined();
    expect(overlayPlacement(config, config.ace)).toEqual({ position: 'top', size: 'medium' });
  });

  it('a stored document without the new fields stays valid and reads as the defaults', () => {
    const old = { version: 1, ace: { enabled: false, text: 'ACE', seconds: 3, devices: {}, priority: 4 } };
    const config = TenantOverlaysSchema.parse(old);
    expect(config.position).toBe('top');
    expect(config.size).toBe('medium');
    expect(config.ace.enabled).toBe(false);
  });

  it('the general setting and the own override of an overlay', () => {
    const config = TenantOverlaysSchema.parse({ position: 'center', size: 'large', ace: { position: 'bottom' } });
    expect(overlayPlacement(config, config.ace)).toEqual({ position: 'bottom', size: 'large' });
    expect(overlayPlacement(config, config.block)).toEqual({ position: 'center', size: 'large' });
    const sized = TenantOverlaysSchema.parse({ ace: { size: 'small' } });
    expect(overlayPlacement(sized, sized.ace)).toEqual({ position: 'top', size: 'small' });
  });

  it('refuses unknown positions and sizes', () => {
    expect(TenantOverlaysSchema.safeParse({ position: 'left' }).success).toBe(false);
    expect(TenantOverlaysSchema.safeParse({ size: 'huge' }).success).toBe(false);
    expect(TenantOverlaysSchema.safeParse({ ace: { position: 'middle' } }).success).toBe(false);
    expect(TenantOverlaysSchema.safeParse({ ace: { size: 'xl' } }).success).toBe(false);
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

describe('overlays: background', () => {
  const ID = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
  const ID2 = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';

  it('is optional: the documents saved before stay valid, and an image or a video is accepted', () => {
    expect(TenantOverlaysSchema.parse({ ace: { text: 'ACE!' } }).ace.background).toBeUndefined();
    const doc = TenantOverlaysSchema.parse({
      ace: { background: { kind: 'video', assetId: ID } },
      block: { background: { kind: 'image', assetId: ID2 } },
    });
    // A background saved before the options of the video: muted, in the box, our team only.
    const plainOptions = { audio: false, fit: 'center', teams: 'ours', duration: 'seconds', showText: true } as const;
    expect(doc.ace.background).toEqual({ kind: 'video', assetId: ID, ...plainOptions });
    expect(overlayBackgrounds(doc)).toEqual([
      { kind: 'video', assetId: ID, ...plainOptions },
      { kind: 'image', assetId: ID2, ...plainOptions },
    ]);
    const plain = withoutOverlayBackgrounds(doc);
    expect(overlayBackgrounds(plain)).toEqual([]);
    expect(doc.ace.background).toBeDefined();
  });

  it('refuses another kind, an id that is not a uuid and extra fields', () => {
    for (const background of [
      { kind: 'gif', assetId: ID },
      { kind: 'image', assetId: 'x' },
      { kind: 'image', assetId: ID, url: 'https://evil.test/a.png' },
      { kind: 'image' },
      { kind: 'video', assetId: ID, audio: 'sì' },
      { kind: 'video', assetId: ID, fit: 'cover' },
      { kind: 'video', assetId: ID, teams: 'away' },
      { kind: 'video', assetId: ID, teams: 'home' },
      { kind: 'video', assetId: ID, duration: 'forever' },
      { kind: 'video', assetId: ID, duration: 30 },
    ])
      expect(TenantOverlaysSchema.safeParse({ ace: { background } }).success).toBe(false);
  });

  it('keeps the options of a video: sound, whole screen, both teams', () => {
    const doc = TenantOverlaysSchema.parse({
      ace: { background: { kind: 'video', assetId: ID, audio: true, fit: 'fullscreen', teams: 'both' } },
    });
    expect(doc.ace.background).toEqual({
      kind: 'video',
      assetId: ID,
      audio: true,
      fit: 'fullscreen',
      teams: 'both',
      duration: 'seconds',
      showText: true,
    });
  });

  it('duration of the overlay: the seconds chosen by default (documents saved before), or the length of the video', () => {
    const old = OverlayBackgroundSchema.parse({ kind: 'video', assetId: ID, audio: true });
    expect(old.duration).toBe('seconds');
    const follows = OverlayBackgroundSchema.parse({ kind: 'video', assetId: ID, duration: 'video' });
    expect(follows.duration).toBe('video');
    expect(OVERLAY_VIDEO_DURATIONS).toEqual(['seconds', 'video']);
    expect(OVERLAY_VIDEO_MAX_SECONDS).toBe(30);
    // It survives the round trip of the document.
    const doc = TenantOverlaysSchema.parse({ ace: { background: follows } });
    expect(TenantOverlaysSchema.parse(JSON.parse(JSON.stringify(doc))).ace.background?.duration).toBe('video');
  });

  it('a background for our team only is dropped for an event of the opponent, at home or away, and with our side unknown', () => {
    const video = OverlayBackgroundSchema.parse({ kind: 'video', assetId: ID });
    const both = OverlayBackgroundSchema.parse({ kind: 'video', assetId: ID, teams: 'both' });
    const image = OverlayBackgroundSchema.parse({ kind: 'image', assetId: ID2 });
    // Our team at home.
    expect(backgroundForTeam(video, 'home', 'home')).toBe(video);
    expect(backgroundForTeam(video, 'away', 'home')).toBeUndefined();
    // Our team away: the video goes with the away side.
    expect(backgroundForTeam(video, 'away', 'away')).toBe(video);
    expect(backgroundForTeam(video, 'home', 'away')).toBeUndefined();
    // An event of no team stays; our side unknown: no background for our team only.
    expect(backgroundForTeam(video, null, 'home')).toBe(video);
    expect(backgroundForTeam(video, 'away', null)).toBeUndefined();
    expect(backgroundForTeam(both, 'away', 'home')).toBe(both);
    expect(backgroundForTeam(both, 'away', null)).toBe(both);
    // The same for an image (default, also for the documents saved before `teams`).
    expect(backgroundForTeam(image, 'home', 'home')).toBe(image);
    expect(backgroundForTeam(image, 'away', 'home')).toBeUndefined();
    expect(backgroundForTeam(image, 'home', null)).toBeUndefined();
    const imageBoth = OverlayBackgroundSchema.parse({ kind: 'image', assetId: ID2, teams: 'both' });
    expect(backgroundForTeam(imageBoth, 'away', 'home')).toBe(imageBoth);
    expect(backgroundForTeam(undefined, 'home', 'home')).toBeUndefined();
  });

  it('showText: shown by default (documents saved before), kept in the round trip and in the export', () => {
    expect(OverlayBackgroundSchema.parse({ kind: 'image', assetId: ID }).showText).toBe(true);
    const doc = TenantOverlaysSchema.parse({ ace: { background: { kind: 'image', assetId: ID, showText: false } } });
    const back = TenantOverlaysSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(back.ace.background).toMatchObject({ showText: false, teams: 'ours' });
    expect(OverlayBackgroundSchema.safeParse({ kind: 'image', assetId: ID, showText: 'no' }).success).toBe(false);
  });

  it('assets: kind overlay and video types in the summary', () => {
    expect(AssetKindSchema.parse('overlay')).toBe('overlay');
    expect(isVideoMime('video/webm')).toBe(true);
    expect(isVideoMime('image/png')).toBe(false);
    const summary = {
      id: ID,
      kind: 'overlay',
      mime: 'video/mp4',
      width: 1280,
      height: 720,
      bytes: 1000,
      sha256: 'a'.repeat(64),
      createdAt: '2026-10-14T10:00:00.000Z',
      url: `/api/admin/assets/${ID}/file`,
    };
    expect(AssetSummarySchema.parse(summary).mime).toBe('video/mp4');
    // An older answer without the name reads as a file without name.
    expect(AssetSummarySchema.parse(summary).name).toBeNull();
    expect(AssetSummarySchema.parse({ ...summary, name: 'ace.mp4' }).name).toBe('ace.mp4');
    expect(AssetSummarySchema.safeParse({ ...summary, mime: 'video/quicktime' }).success).toBe(false);
  });
});
