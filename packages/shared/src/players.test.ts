import { describe, expect, it } from 'vitest';
import { AssetKindSchema, VideoUploadQuerySchema } from './assets.js';
import { OverlayPlayerMediaSchema, playerBackground, TenantOverlaysSchema } from './overlays.js';
import {
  CreatePlayerRequestSchema,
  PLAYER_MEDIA_MAX,
  PLAYER_ROLE_LABELS,
  PlayerMediaRequestSchema,
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
    { number: 4, photo: A, images: [B, C], videos: [V1, V2] },
    { number: 6, photo: null, images: [], videos: [] },
    { number: 9, photo: null, images: [C], videos: [] },
  ];
  const event = (
    over: Partial<{
      id: string;
      kind: 'ace' | 'block' | 'substitution' | 'tie';
      team: 'home' | 'away' | null;
      number: number | null;
    }> = {},
  ) => ({
    id: over.id ?? 'ev-1',
    kind: over.kind ?? 'ace',
    team: over.team === undefined ? 'home' : over.team,
    player: over.number === null ? null : { number: over.number ?? 4, firstName: 'Mathis', lastName: 'Henno' },
  });
  const media = (input: Record<string, unknown>) => ({ playerMedia: OverlayPlayerMediaSchema.parse(input) });

  it('is optional on the overlays: the documents saved before keep the fixed background', () => {
    expect(TenantOverlaysSchema.parse({}).ace.playerMedia).toBeUndefined();
    expect(TenantOverlaysSchema.parse({ ace: { playerMedia: { source: 'video' } } }).ace.playerMedia).toEqual({
      source: 'video',
      pick: 'default',
      audio: false,
      fit: 'center',
      duration: 'seconds',
    });
    expect(TenantOverlaysSchema.safeParse({ ace: { playerMedia: { source: 'gif' } } }).success).toBe(false);
    expect(playerBackground({}, event(), 'home', players, { videos: true })).toBeUndefined();
  });

  it('the main video of the player of our team, with the options of the overlay', () => {
    expect(
      playerBackground(
        media({ source: 'video', audio: true, fit: 'fullscreen', duration: 'video' }),
        event(),
        'home',
        players,
        {
          videos: true,
        },
      ),
    ).toEqual({ kind: 'video', assetId: V1, audio: true, fit: 'fullscreen', teams: 'ours', duration: 'video' });
    expect(playerBackground(media({ source: 'photo' }), event(), 'home', players, { videos: true })).toMatchObject({
      kind: 'image',
      assetId: A,
    });
  });

  it('only for an action of a player of our team, of an overlay of a player, with a player of the roster', () => {
    const m = media({ source: 'photo' });
    expect(playerBackground(m, event({ team: 'away' }), 'home', players, { videos: true })).toBeUndefined();
    expect(playerBackground(m, event(), null, players, { videos: true })).toBeUndefined();
    expect(playerBackground(m, event({ kind: 'tie' }), 'home', players, { videos: true })).toBeUndefined();
    expect(playerBackground(m, event({ number: null }), 'home', players, { videos: true })).toBeUndefined();
    expect(playerBackground(m, event({ number: 22 }), 'home', players, { videos: true })).toBeUndefined();
    // Our team away: its players are the away ones.
    expect(playerBackground(m, event({ team: 'away' }), 'away', players, { videos: true })?.assetId).toBe(A);
  });

  it('a video falls back to the photo without videos (phone, reduced motion) or when the player has none; nothing: undefined', () => {
    const m = media({ source: 'video' });
    expect(playerBackground(m, event(), 'home', players, { videos: false })).toMatchObject({
      kind: 'image',
      assetId: A,
    });
    expect(playerBackground(m, event({ number: 9 }), 'home', players, { videos: true })).toMatchObject({
      kind: 'image',
      assetId: C,
      duration: 'seconds',
    });
    expect(playerBackground(m, event({ number: 6 }), 'home', players, { videos: true })).toBeUndefined();
  });

  it('«random» picks among the photos or videos, always the same one for the same event', () => {
    const m = media({ source: 'photo', pick: 'random' });
    const picks = new Set(
      Array.from(
        { length: 30 },
        (_, i) => playerBackground(m, event({ id: `ev-${i}` }), 'home', players, { videos: true })?.assetId,
      ),
    );
    expect([...picks].sort()).toEqual([A, B, C].sort());
    const once = playerBackground(m, event({ id: 'fisso' }), 'home', players, { videos: true });
    expect(playerBackground(m, event({ id: 'fisso' }), 'home', players, { videos: true })).toEqual(once);
    const videos = new Set(
      Array.from(
        { length: 20 },
        (_, i) =>
          playerBackground(media({ source: 'video', pick: 'random' }), event({ id: `v-${i}` }), 'home', players, {
            videos: true,
          })?.assetId,
      ),
    );
    expect([...videos].sort()).toEqual([V1, V2].sort());
  });
});
