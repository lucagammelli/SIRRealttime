import type { LayoutDevice, OverlayBackground, OverlayBackgroundKind, TenantOverlays } from '@arenalive/shared';
import { OVERLAY_KINDS, publicAssetPath } from '@arenalive/shared';
import { useEffect, useRef, useState } from 'react';

/** Media ready to be drawn behind an overlay: its kind and an address (an object URL in memory, or a file path). */
export interface OverlayMedia {
  kind: OverlayBackgroundKind;
  url: string;
}

/**
 * Pure: the backgrounds to keep ready on this device: of the overlays on and shown on `device`, each file once; no
 * videos on the phone (data and memory of a mobile connection) nor with reduced motion: the overlay then shows its
 * text only.
 */
export function wantedBackgrounds(
  config: TenantOverlays | null,
  device: LayoutDevice,
  reducedMotion: boolean,
): OverlayBackground[] {
  if (!config) return [];
  const out = new Map<string, OverlayBackground>();
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
): ReadonlyMap<string, OverlayMedia> {
  const wanted = wantedBackgrounds(config, device, reducedMotion);
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
