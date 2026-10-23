import type { OverlayPosition, OverlaySize, TenantOverlays } from '@arenalive/shared';
import type { MatchState, Side } from '@arenalive/volley-stats';
import { useEffect, useRef, useState } from 'react';
import type { Device } from '../lib/layout.ts';
import type { QueuedOverlay } from '../lib/overlay.ts';
import { enqueue, eventsOf, nextOverlay, overlayFor, unseenEvents } from '../lib/overlay.ts';
import type { OverlayMedia } from '../lib/overlayMedia.ts';
import { useOverlayMedia } from '../lib/overlayMedia.ts';
import { useReducedMotion } from '../lib/theme.ts';

const TONE: Record<Side | 'neutral', string> = {
  home: 'bg-home text-on-home',
  away: 'bg-away text-on-away',
  neutral: 'bg-primary text-on-primary',
};

/**
 * Where the overlays appear, over the page and the pause banner, under a full screen pause. Always `pointer-events-none`
 * (taps and clicks go through to the page) and never over the essential controls: near the top, below the scoreboard
 * fixed on the phone; near the bottom, above the banner of a pause; in the middle only the box itself covers the page.
 */
const OVERLAY_REGION_BASE = 'pointer-events-none fixed inset-x-0 z-45 flex justify-center px-3';
export const OVERLAY_REGION_CLASSES: Record<OverlayPosition, string> = {
  top: `${OVERLAY_REGION_BASE} top-[12%]`,
  center: `${OVERLAY_REGION_BASE} inset-y-0 items-center`,
  bottom: `${OVERLAY_REGION_BASE} bottom-[14%]`,
};
/** Default region (near the top). */
export const OVERLAY_REGION_CLASS = OVERLAY_REGION_CLASSES.top;

/** Veil over the background, in the colour of the team: the text stays readable on any image or video. */
const VEIL: Record<Side | 'neutral', string> = {
  home: 'bg-home/65',
  away: 'bg-away/65',
  neutral: 'bg-primary/65',
};
/** Text colour of the box with a background (the box itself has no colour: the media and the veil are under it). */
const TEXT_TONE: Record<Side | 'neutral', string> = {
  home: 'text-on-home',
  away: 'text-on-away',
  neutral: 'text-on-primary',
};
/** With a background the box is larger (16:9), so that the image or the video can be seen. */
const MEDIA_BOX: Record<Device, string> = {
  tv: 'w-[min(56rem,90vw)]',
  tablet: 'w-[min(36rem,90vw)]',
  phone: 'w-[90vw]',
};

/** Padding and text size of the box, by device and size (medium is the look from before the setting existed). */
const BOX_SIZE: Record<Device, Record<OverlaySize, string>> = {
  tv: { small: 'px-6 py-3 text-2xl', medium: 'px-8 py-4 text-4xl', large: 'px-12 py-6 text-6xl' },
  tablet: { small: 'px-4 py-2 text-xl', medium: 'px-6 py-3 text-2xl', large: 'px-8 py-4 text-4xl' },
  phone: { small: 'px-3 py-1.5 text-base', medium: 'px-4 py-2 text-lg', large: 'px-5 py-3 text-2xl' },
};

/**
 * The box of an overlay: plain text (never HTML) in the colour of the team of the event, entering with a short
 * animation (none with reduced motion). With `media` (ready in memory) the box is larger, with the image or the video
 * behind the text under a veil of the team colour; a video plays muted, inline and in a loop while the overlay is on,
 * never with reduced motion (text only, as without media). Also the «Prova» of the editor.
 */
export function OverlayBanner({
  text,
  team,
  device,
  size = 'medium',
  media = null,
}: {
  text: string;
  team: Side | null;
  device: Device;
  size?: OverlaySize;
  media?: OverlayMedia | null;
}) {
  const reduced = useReducedMotion();
  const tone = team ?? 'neutral';
  // No video on the phone nor with reduced motion (the page does not even download it there).
  const shown = media && !((reduced || device === 'phone') && media.kind === 'video') ? media : null;
  if (!shown)
    return (
      <div
        data-overlay={tone}
        data-size={size}
        className={`${reduced ? '' : 'sir-overlay'} max-w-[90%] rounded-panel text-center font-display font-bold uppercase tracking-wide shadow-card ${BOX_SIZE[device][size]} ${TONE[tone]}`}
      >
        {text}
      </div>
    );
  return (
    <div
      data-overlay={tone}
      data-size={size}
      data-background={shown.kind}
      className={`${reduced ? '' : 'sir-overlay'} relative flex aspect-video max-w-[90%] items-center justify-center overflow-hidden rounded-panel text-center font-display font-bold uppercase tracking-wide shadow-card ${MEDIA_BOX[device]} ${TEXT_TONE[tone]}`}
    >
      {shown.kind === 'video' ? (
        <OverlayVideo url={shown.url} />
      ) : (
        <img src={shown.url} alt="" className="absolute inset-0 size-full object-cover" />
      )}
      <div aria-hidden="true" className={`absolute inset-0 ${VEIL[tone]}`} />
      <span className={`relative ${BOX_SIZE[device][size]}`}>{text}</span>
    </div>
  );
}

/** Video behind an overlay: muted (the only way a browser starts it by itself), inline, in a loop, no controls. */
function OverlayVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React does not always write `muted` as an attribute: set on the element, so that autoplay is allowed.
    video.muted = true;
    void video.play?.()?.catch(() => undefined);
  }, [url]);
  return (
    <video
      ref={ref}
      src={url}
      aria-hidden="true"
      muted
      playsInline
      autoPlay
      loop
      preload="auto"
      disablePictureInPicture
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/**
 * Overlays of the public page: a short message over the page when a new event of the match arrives live (ace, set
 * point, ...), for the seconds chosen by the client and only on the devices chosen. One at a time, from a queue by
 * priority (a match point goes before an ace); one waiting too long is dropped. Nothing for the events already in the
 * state when the page opens, after a reconnection or a resync (`live` false), nor for a past rally corrected by the
 * scout (new id before the last line already seen): only the new ones. While `blocked` (a
 * full screen pause is on) new events are dropped and the overlay on screen goes away. The region is `aria-live`
 * polite: screen readers read the text without moving the focus.
 */
export function Overlay({
  state,
  live,
  config,
  device,
  blocked = false,
}: {
  state: MatchState;
  /** The state is a live update (see `LiveData.live`). */
  live: boolean;
  /** Overlays of the client (the defaults when its graphics could not be loaded); null while loading: none. */
  config: TenantOverlays | null;
  device: Device;
  blocked?: boolean;
}) {
  const seen = useRef<Set<string> | null>(null);
  /** Highest scout line of the events already seen: a new id before it is a corrected past rally, not news. */
  const maxSeenIndex = useRef(-1);
  const queue = useRef<QueuedOverlay[]>([]);
  const [current, setCurrent] = useState<QueuedOverlay | null>(null);
  const [arrivals, setArrivals] = useState(0);
  // The backgrounds of the overlays on for this device, read into memory now: an overlay lasts only a few seconds.
  const media = useOverlayMedia(config, device, useReducedMotion());

  // New events of a live update go in the queue; everything else is only remembered as seen.
  useEffect(() => {
    const events = eventsOf(state);
    const known = seen.current;
    const from = maxSeenIndex.current;
    maxSeenIndex.current = Math.max(from, ...events.map((e) => e.index));
    if (known === null) {
      seen.current = new Set(events.map((e) => e.id));
      return;
    }
    // DataVolley rewrites the scores after a corrected rally: those events get new ids but are old.
    const fresh = unseenEvents(events, known).filter((e) => e.index >= from);
    if (!live || config === null || blocked || fresh.length === 0) return;
    const now = Date.now();
    const items = fresh
      .map((e) => overlayFor(e, state, config, device, now))
      .filter((o): o is QueuedOverlay => o !== null);
    if (items.length === 0) return;
    queue.current = enqueue(queue.current, items);
    setArrivals((n) => n + 1);
  }, [state, live, config, device, blocked]);

  // A full screen pause: nothing over it.
  useEffect(() => {
    if (!blocked) return;
    queue.current = [];
    setCurrent(null);
  }, [blocked]);

  // Next overlay when none is on screen.
  useEffect(() => {
    if (current || blocked) return;
    const { next, rest } = nextOverlay(queue.current, Date.now());
    queue.current = rest;
    if (next) setCurrent(next);
  }, [current, arrivals, blocked]);

  // Each overlay stays for its seconds.
  useEffect(() => {
    if (!current) return;
    const id = setTimeout(() => setCurrent(null), current.seconds * 1000);
    return () => clearTimeout(id);
  }, [current]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-overlay-region={current?.position ?? 'top'}
      className={OVERLAY_REGION_CLASSES[current?.position ?? 'top']}
    >
      {current && (
        <OverlayBanner
          key={current.id}
          text={current.text}
          team={current.team}
          device={device}
          size={current.size}
          media={current.background ? (media.get(current.background.assetId) ?? null) : null}
        />
      )}
    </div>
  );
}
