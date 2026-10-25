import type {
  LayoutDevice,
  OverlayBackground,
  OverlayBackgroundKind,
  OverlayVideoDuration,
  OverlayVideoFit,
  PublicPlayerMedia,
  TenantOverlays,
} from '@arenalive/shared';
import { OVERLAY_KINDS, OVERLAY_PLAYER_KINDS, playerMediaFile, publicAssetPath } from '@arenalive/shared';
import type { MatchState, Side } from '@arenalive/volley-stats';
import { useEffect, useRef, useState } from 'react';

/**
 * Media ready to be drawn behind an overlay: its kind and an address (an object URL in memory, or a file path); for a
 * video also its sound and where it plays (missing: muted, in the box).
 */
export interface OverlayMedia {
  kind: OverlayBackgroundKind;
  url: string;
  audio?: boolean;
  fit?: OverlayVideoFit;
  /** `video`: the video plays once and the overlay lasts as long as it (missing: in a loop, for the seconds). */
  duration?: OverlayVideoDuration;
  /** The photo or video of a player: shown as the original file (no veil); `showText` false hides the text. */
  player?: { showText: boolean };
  /** A fixed background: false hides the text (no veil, the text stays for screen readers); missing: shown. */
  showText?: boolean;
}

/** Pure: the media of `background` at `url`, with the options of a video. */
export const mediaOf = (background: OverlayBackground, url: string, player?: { showText: boolean }): OverlayMedia => ({
  kind: background.kind,
  url,
  audio: background.audio,
  fit: background.fit,
  duration: background.duration,
  ...(player ? { player } : { showText: background.showText }),
});

/**
 * The players of our team whose photos and videos are kept ready: the roster media of the public page and their shirt
 * numbers, the ones on court (`court`: ACE!, Muro) and the whole team of the match (`team`, the bench too: who comes in
 * with a substitution).
 */
export interface PlayerPreload {
  players: readonly PublicPlayerMedia[];
  court: ReadonlySet<number>;
  team: ReadonlySet<number>;
}

/** Pure: the shirt numbers of our team on court and of the whole team of the match; none when our team is not known. */
export function playerNumbersInPlay(
  state: Pick<MatchState, 'live' | 'players'>,
  ourSide: Side | null,
): { court: Set<number>; team: Set<number> } {
  const court = new Set<number>();
  const team = new Set<number>();
  if (ourSide === null) return { court, team };
  for (const n of state.live.lineups[ourSide]) if (n !== null) court.add(n);
  for (const n of court) team.add(n);
  for (const p of state.players[ourSide]) team.add(p.number);
  return { court, team };
}

/**
 * Pure: the backgrounds to keep ready on this device: of the overlays on and shown on `device`, each file once; no
 * videos with reduced motion: the overlay then shows its text only. With `preload`, also the file of each player for each
 * overlay that shows the player (the one of
 * `playerMediaFile`: the video of that overlay, else its photo, else the main photo): of the players on court for ACE!
 * and Muro, of the whole team for Cambio.
 */
export function wantedBackgrounds(
  config: TenantOverlays | null,
  device: LayoutDevice,
  reducedMotion: boolean,
  preload?: PlayerPreload,
): OverlayBackground[] {
  if (!config) return [];
  const out = new Map<string, OverlayBackground>();
  const videos = !reducedMotion;
  if (preload) {
    for (const kind of OVERLAY_PLAYER_KINDS) {
      const overlay = config[kind];
      const pm = overlay.playerMedia;
      if (!pm || !overlay.enabled || !overlay.devices[device]) continue;
      const numbers = kind === 'substitution' ? preload.team : preload.court;
      const common = { audio: pm.audio, fit: pm.fit, teams: 'ours' as const, showText: pm.showText };
      for (const player of preload.players) {
        if (!numbers.has(player.number)) continue;
        const file = playerMediaFile(pm.source, kind, player, { videos });
        if (file && !out.has(file.assetId))
          out.set(file.assetId, { ...file, ...common, duration: file.kind === 'video' ? pm.duration : 'seconds' });
      }
    }
  }
  for (const kind of OVERLAY_KINDS) {
    const overlay = config[kind];
    const background = overlay.background;
    if (!overlay.enabled || !overlay.devices[device] || !background) continue;
    if (reducedMotion && background.kind === 'video') continue;
    if (!out.has(background.assetId)) out.set(background.assetId, background);
  }
  return [...out.values()];
}

/** Reads a file of the client into memory: its object URL, null when it cannot be read. */
export type MediaLoader = (path: string, signal: AbortSignal) => Promise<string | null>;

const fetchObjectUrl: MediaLoader = async (path, signal) => {
  const res = await fetch(path, { credentials: 'omit', signal });
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
};

/**
 * The backgrounds of the overlays read into memory as soon as the page knows them (an overlay lasts a few seconds:
 * its video must start at once), by asset id. A file no longer wanted is dropped and its object URL revoked, all of
 * them when the component goes away. One not read yet is missing: the overlay shows its text only.
 */
export function useOverlayMedia(
  config: TenantOverlays | null,
  device: LayoutDevice,
  reducedMotion: boolean,
  load: MediaLoader = fetchObjectUrl,
  /** The players of our team in play: their photos and videos are kept ready for the overlays that show them. */
  preload?: PlayerPreload,
): ReadonlyMap<string, OverlayMedia> {
  const wanted = wantedBackgrounds(config, device, reducedMotion, preload);
  const key = wanted.map((b) => `${b.kind}:${b.assetId}`).join(',');
  const [ready, setReady] = useState<ReadonlyMap<string, OverlayMedia>>(() => new Map());
  /** Object URLs made here, by asset id (also the ones still loading: their controller). */
  const held = useRef(new Map<string, { kind: OverlayBackgroundKind; url: string | null; abort: AbortController }>());

  useEffect(() => {
    const keep = new Map(
      key === ''
        ? []
        : key.split(',').map((item) => {
            const [kind, assetId = ''] = item.split(':') as [OverlayBackgroundKind, string];
            return [assetId, kind] as const;
          }),
    );
    const current = held.current;
    for (const [id, entry] of current) {
      if (keep.get(id) === entry.kind) continue;
      entry.abort.abort();
      if (entry.url) URL.revokeObjectURL(entry.url);
      current.delete(id);
    }
    const publish = (): void => {
      const next = new Map<string, OverlayMedia>();
      for (const [id, entry] of current) if (entry.url) next.set(id, { kind: entry.kind, url: entry.url });
      setReady(next);
    };
    publish();
    for (const [id, kind] of keep) {
      if (current.has(id)) continue;
      const entry = { kind, url: null as string | null, abort: new AbortController() };
      current.set(id, entry);
      load(publicAssetPath(id), entry.abort.signal).then(
        (url) => {
          if (current.get(id) !== entry || entry.abort.signal.aborted) {
            if (url) URL.revokeObjectURL(url);
            return;
          }
          entry.url = url;
          publish();
        },
        () => undefined,
      );
    }
  }, [key, load]);

  // Everything goes with the component.
  useEffect(() => {
    const current = held.current;
    return () => {
      for (const entry of current.values()) {
        entry.abort.abort();
        if (entry.url) URL.revokeObjectURL(entry.url);
      }
      current.clear();
    };
  }, []);

  return ready;
}
