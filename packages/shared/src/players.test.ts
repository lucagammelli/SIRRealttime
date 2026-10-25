import { describe, expect, it } from 'vitest';
import { AssetKindSchema, VideoUploadQuerySchema } from './assets.js';
import { OverlayPlayerMediaSchema, playerBackground, playerMediaFile, TenantOverlaysSchema } from './overlays.js';
import {
  CreatePlayerRequestSchema,
  PLAYER_MEDIA_MAX,
  PLAYER_ROLE_LABELS,
  PlayerMediaRequestSchema,
  PublicPlayerMediaSchema,
  roleFromLeague,
  RosterQuerySchema,
  UpdatePlayerRequestSchema,
} from './players.js';
import { PublicTenantResponseSchema } from './tenant.js';

const A = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const B = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';
const C = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const V1 = '2b3c4d5e-6f7a-4b2c-9d3e-4f5a6b7c8d9e';
const V2 = '3c4d5e6f-7a8b-4c3d-8e4f-5a6b7c8d9e0f';

describe('roster: contracts', () => {
  it('reads the roles of the site of the league and names them in Italian', () => {
    expect(roleFromLeague('Schiacciatore ')).toBe('outside');
    expect(roleFromLeague('Palleggiatore')).toBe('setter');
    expect(roleFromLeague('CENTRALE')).toBe('middle');
    expect(roleFromLeague('Opposto')).toBe('opposite');
    expect(roleFromLeague('Libero')).toBe('libero');
    expect(roleFromLeague('Allenatore')).toBeNull();
    expect(PLAYER_ROLE_LABELS.outside).toBe('Schiacciatore');
  });

  it('a player added by hand: number 0-99, names, optional data checked', () => {
    const p = CreatePlayerRequestSchema.parse({
      number: 4,
      firstName: ' Mathis ',
      lastName: 'Henno',
      nationality: 'fra',
    });
    expect(p).toEqual({
      number: 4,
      firstName: 'Mathis',
      lastName: 'Henno',
      role: null,
      birthYear: null,
      heightCm: null,
      birthplace: null,
      nationality: 'FRA',
    });
    for (const bad of [
      { number: 100, firstName: 'a', lastName: 'b' },
      { number: 1.5, firstName: 'a', lastName: 'b' },
      { number: 1, firstName: '', lastName: 'b' },
      { number: 1, firstName: 'a', lastName: 'b'.repeat(61) },
      { number: 1, firstName: 'a', lastName: 'b', heightCm: 119 },
      { number: 1, firstName: 'a', lastName: 'b', nationality: 'ITAL' },
      { number: 1, firstName: 'a', lastName: 'b', role: 'coach' },
      { number: 1, firstName: 'a\u0007', lastName: 'b' },
      { number: 1, firstName: 'a', lastName: 'b', source: 'league' },
    ])
      expect(CreatePlayerRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('a change needs a field; «removed: false» puts a player back, «true» is not a change', () => {
    expect(UpdatePlayerRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdatePlayerRequestSchema.parse({ removed: false })).toEqual({ removed: false });
    expect(UpdatePlayerRequestSchema.safeParse({ removed: true }).success).toBe(false);
    expect(UpdatePlayerRequestSchema.parse({ role: null, heightCm: 201 })).toEqual({ role: null, heightCm: 201 });
  });

  it('photos and videos of a player: each file once, at most the limit', () => {
    expect(PlayerMediaRequestSchema.parse({ photoAssetId: null, mediaIds: [A, B] }).mediaIds).toEqual([A, B]);
    expect(PlayerMediaRequestSchema.safeParse({ photoAssetId: null, mediaIds: [A, A] }).success).toBe(false);
    const many = Array.from(
      { length: PLAYER_MEDIA_MAX + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(PlayerMediaRequestSchema.safeParse({ photoAssetId: null, mediaIds: many }).success).toBe(false);
  });

  it('the photo and video of each overlay: only files of the player, only the overlays of a player', () => {
    const ok = PlayerMediaRequestSchema.parse({
      photoAssetId: A,
      mediaIds: [B, V1],
      events: { ace: { photoAssetId: B, videoAssetId: V1 }, block: { videoAssetId: V1 } },
    });
    expect(ok.events).toEqual({
      ace: { photoAssetId: B, videoAssetId: V1 },
      block: { photoAssetId: null, videoAssetId: V1 },
    });
    expect(PlayerMediaRequestSchema.parse({ photoAssetId: null, mediaIds: [] }).events).toBeUndefined();
    // The main photo is not one of the other files: «Nessuna» already shows it.
    for (const events of [
      { ace: { photoAssetId: A } },
      { substitution: { videoAssetId: C } },
      { tie: { photoAssetId: B } },
      { ace: { photoAssetId: B, extra: 1 } },
    ])
      expect(PlayerMediaRequestSchema.safeParse({ photoAssetId: A, mediaIds: [B, V1], events }).success).toBe(false);
  });

  it('the season of the query, the kind of the files and the players of the public graphics', () => {
    expect(RosterQuerySchema.parse({ season: '2026' })).toEqual({ season: 2026 });
    expect(RosterQuerySchema.parse({})).toEqual({});
    expect(RosterQuerySchema.safeParse({ season: 'x' }).success).toBe(false);
    expect(AssetKindSchema.parse('player')).toBe('player');
    expect(VideoUploadQuerySchema.parse({})).toEqual({ kind: 'overlay' });
    expect(VideoUploadQuerySchema.parse({ kind: 'player' })).toEqual({ kind: 'player' });
    expect(VideoUploadQuerySchema.safeParse({ kind: 'logo' }).success).toBe(false);
    const tenant = PublicTenantResponseSchema.parse({
      name: 'x',
      branding: {},
      images: { logoMain: null, logoMark: null, sponsorLogo: null },
    });
    expect(tenant.players).toEqual([]);
  });
});

describe('photo or video of the player behind an overlay', () => {
  const players = [
    {
      number: 4,
      photo: A,
      events: {
        ace: { photo: B, video: V1 },
        block: { photo: null, video: V2 },
        substitution: { photo: C, video: null },
      },
    },
    { number: 6, photo: null, events: {} },
    { number: 9, photo: C, events: {} },
    { number: 11, photo: null, events: { ace: { photo: null, video: V1 } } },
  ];
  const event = (
    over: Partial<{
      kind: 'ace' | 'block' | 'substitution' | 'tie';
      team: 'home' | 'away' | null;
      number: number | null;
    }> = {},
  ) => ({
    kind: over.kind ?? 'ace',
    team: over.team === undefined ? 'home' : over.team,
    player: over.number === null ? null : { number: over.number ?? 4, firstName: 'Mathis', lastName: 'Henno' },
  });
  const media = (input: Record<string, unknown>) => ({ playerMedia: OverlayPlayerMediaSchema.parse(input) });
  const on = { videos: true };

  it('is optional on the overlays: the documents saved before keep the fixed background', () => {
    expect(TenantOverlaysSchema.parse({}).ace.playerMedia).toBeUndefined();
    expect(TenantOverlaysSchema.parse({ ace: { playerMedia: { source: 'video' } } }).ace.playerMedia).toEqual({
      source: 'video',
      audio: false,
      fit: 'center',
      duration: 'seconds',
      showText: true,
    });
    expect(OverlayPlayerMediaSchema.parse({ source: 'video', showText: false }).showText).toBe(false);
    expect(TenantOverlaysSchema.safeParse({ ace: { playerMedia: { source: 'gif' } } }).success).toBe(false);
    expect(playerBackground({}, event(), 'home', players, on)).toBeUndefined();
  });

  it('a document saved with the old «Quale» (main or random) stays valid and drops it', () => {
    for (const pick of ['default', 'random']) {
      const parsed = TenantOverlaysSchema.parse({ block: { playerMedia: { source: 'photo', pick, audio: true } } });
      expect(parsed.block.playerMedia).toEqual({
        source: 'photo',
        audio: true,
        fit: 'center',
        duration: 'seconds',
        showText: true,
      });
      expect(TenantOverlaysSchema.parse(parsed)).toEqual(parsed);
    }
    expect(TenantOverlaysSchema.safeParse({ ace: { playerMedia: { source: 'photo', pick: 'all' } } }).success).toBe(
      false,
    );
  });

  it('the video of the overlay of the player of our team, with the options of the overlay', () => {
    expect(
      playerBackground(
        media({ source: 'video', audio: true, fit: 'fullscreen', duration: 'video' }),
        event(),
        'home',
        players,
        on,
      ),
    ).toEqual({
      kind: 'video',
      assetId: V1,
      audio: true,
      fit: 'fullscreen',
      teams: 'ours',
      duration: 'video',
      showText: true,
    });
    expect(playerBackground(media({ source: 'video' }), event({ kind: 'block' }), 'home', players, on)?.assetId).toBe(
      V2,
    );
    // Photo: the one of the overlay, the main one when none is chosen for it.
    expect(playerBackground(media({ source: 'photo' }), event(), 'home', players, on)).toMatchObject({
      kind: 'image',
      assetId: B,
      duration: 'seconds',
    });
    expect(playerBackground(media({ source: 'photo' }), event({ kind: 'block' }), 'home', players, on)?.assetId).toBe(
      A,
    );
    expect(
      playerBackground(media({ source: 'photo' }), event({ kind: 'substitution' }), 'home', players, on)?.assetId,
    ).toBe(C);
  });

  it('only for an action of a player of our team, of an overlay of a player, with a player of the roster', () => {
    const m = media({ source: 'photo' });
    expect(playerBackground(m, event({ team: 'away' }), 'home', players, on)).toBeUndefined();
    expect(playerBackground(m, event(), null, players, on)).toBeUndefined();
    expect(playerBackground(m, event({ kind: 'tie' }), 'home', players, on)).toBeUndefined();
    expect(playerBackground(m, event({ number: null }), 'home', players, on)).toBeUndefined();
    expect(playerBackground(m, event({ number: 22 }), 'home', players, on)).toBeUndefined();
    // Our team away: its players are the away ones.
    expect(playerBackground(m, event({ team: 'away' }), 'away', players, on)?.assetId).toBe(B);
  });

  it('a video falls back to the photo of the overlay, then to the main photo; nothing: undefined', () => {
    const m = media({ source: 'video', duration: 'video' });
    // No videos (phone, reduced motion): the photo of the overlay.
    expect(playerBackground(m, event(), 'home', players, { videos: false })).toMatchObject({
      kind: 'image',
      assetId: B,
      duration: 'seconds',
    });
    // No video for this overlay: its photo, else the main photo.
    expect(playerBackground(m, event({ kind: 'substitution' }), 'home', players, on)?.assetId).toBe(C);
    expect(playerBackground(m, event({ kind: 'block' }), 'home', players, { videos: false })?.assetId).toBe(A);
    expect(playerBackground(m, event({ number: 9 }), 'home', players, on)).toMatchObject({ kind: 'image', assetId: C });
    expect(playerBackground(m, event({ number: 6 }), 'home', players, on)).toBeUndefined();
    expect(playerBackground(m, event({ number: 11 }), 'home', players, { videos: false })).toBeUndefined();
    expect(playerBackground(m, event({ number: 11 }), 'home', players, on)?.assetId).toBe(V1);
    // A photo overlay never shows the video.
    expect(playerBackground(media({ source: 'photo' }), event({ number: 11 }), 'home', players, on)).toBeUndefined();
  });

  it('the file of a player for an overlay, as the preload sees it', () => {
    const [p4] = players;
    if (!p4) throw new Error('no player');
    expect(playerMediaFile('video', 'ace', p4, on)).toEqual({ kind: 'video', assetId: V1 });
    expect(playerMediaFile('photo', 'ace', p4, on)).toEqual({ kind: 'image', assetId: B });
    expect(playerMediaFile('video', 'block', p4, { videos: false })).toEqual({ kind: 'image', assetId: A });
  });
});

describe('public media of the players', () => {
  it('reads the media of each overlay; an old answer without them reads as none', () => {
    expect(PublicPlayerMediaSchema.parse({ number: 4, photo: A })).toEqual({ number: 4, photo: A, events: {} });
    expect(
      PublicPlayerMediaSchema.parse({ number: 4, photo: null, events: { ace: { photo: null, video: V1 } } }).events,
    ).toEqual({ ace: { photo: null, video: V1 } });
    expect(PublicPlayerMediaSchema.safeParse({ number: 4, photo: null, events: { tie: {} } }).success).toBe(false);
    // The old fields for the pages opened before: optional, kept when sent.
    expect(PublicPlayerMediaSchema.parse({ number: 4, photo: A, events: {}, images: [B], videos: [V1] })).toEqual({
      number: 4,
      photo: A,
      events: {},
      images: [B],
      videos: [V1],
    });
  });
});
