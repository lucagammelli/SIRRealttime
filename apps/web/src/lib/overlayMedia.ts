import type {
  LayoutDevice,
  OverlayBackground,
  OverlayBackgroundKind,
  OverlayVideoDuration,
  OverlayVideoFit,
  PublicPlayerMedia,
  TenantOverlays,
} from '@arenalive/shared';
import { OVERLAY_KINDS, OVERLAY_PLAYER_KINDS, publicAssetPath } from '@arenalive/shared';
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
}

/** Pure: the media of `background` at `url`, with the options of a video. */
export const mediaOf = (background: OverlayBackground, url: string): OverlayMedia => ({
  kind: background.kind,
  url,
  audio: background.audio,
  fit: background.fit,
  duration: background.duration,
});

/** The players of our team whose photos and videos are kept ready: the roster media of the public page and their shirt numbers. */
export interface PlayerPreload {
  players: readonly PublicPlayerMedia[];
  numbers: ReadonlySet<number>;
}

/**
 * Pure: the shirt numbers of our team whose files are worth keeping ready: the players on court and, when the overlay of
 * the substitution shows the player, the whole bench (the one who comes in is not on court yet). None when our team is
 * not known in the match.
 */
export function playerNumbersInPlay(
  state: Pick<MatchState, 'live' | 'players'>,
  ourSide: Side | null,
  config: TenantOverlays | null,
): Set<number> {
  const numbers = new Set<number>();
  if (ourSide === null) return numbers;
  for (const n of state.live.lineups[ourSide]) if (n !== null) numbers.add(n);
  if (config?.substitution.enabled && config.substitution.playerMedia)
    for (const p of state.players[ourSide]) numbers.add(p.number);
  return numbers;
}

/**
 * Pure: the backgrounds to keep ready on this device: of the overlays on and shown on `device`, each file once; no
 * videos on the phone (data and memory of a mobile connection) nor with reduced motion: the overlay then shows its
 * text only. With `preload`, also the photos (always) and videos (when allowed) of the players of our team in play for the
 * overlays that show the player (the main one, or all of them with «Casuale»).
 */
export function wantedBackgrounds(
  config: TenantOverlays | null,
  device: LayoutDevice,
  reducedMotion: boolean,
  preload?: PlayerPreload,
): OverlayBackground[] {
  if (!config) return [];
  const out = new Map<string, OverlayBackground>();
  const videosAllowed = !reducedMotion && device !== 'phone';
  if (preload && preload.numbers.size > 0) {
    for (const kind of OVERLAY_PLAYER_KINDS) {
      const overlay = config[kind];
      const pm = overlay.playerMedia;
      if (!pm || !overlay.enabled || !overlay.devices[device]) continue;
      const some = (ids: readonly string[]): string[] => (pm.pick === 'random' ? [...ids] : ids.slice(0, 1));
      for (const player of preload.players) {
        if (!preload.numbers.has(player.number)) continue;
        const common = { audio: pm.audio, fit: pm.fit, teams: 'ours' as const };
        const photos = player.photo ? [player.photo, ...player.images] : player.images;
        for (const assetId of some(photos))
          if (!out.has(assetId)) out.set(assetId, { kind: 'image', assetId, ...common, duration: 'seconds' });
        if (pm.source === 'video' && videosAllowed)
          for (const assetId of some(player.videos))
            if (!out.has(assetId)) out.set(assetId, { kind: 'video', assetId, ...common, duration: pm.duration });
      }
    }
  }
  for (const kind of OVERLAY_KINDS) {
    const overlay = config[kind];
    const background = overlay.background;
    if (!overlay.enabled || !overlay.devices[device] || !background) continue;
    if ((reducedMotion || device === 'phone') && background.kind === 'video') continue;
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
