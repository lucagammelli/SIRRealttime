import type { OverlayPosition, OverlaySize, PublicPlayerMedia, TenantOverlays } from '@arenalive/shared';
import { OVERLAY_VIDEO_MAX_SECONDS } from '@arenalive/shared';
import type { MatchState, Side } from '@arenalive/volley-stats';
import { useEffect, useRef, useState } from 'react';
import type { Device } from '../lib/layout.ts';
import type { QueuedOverlay } from '../lib/overlay.ts';
import { enqueue, eventsOf, nextOverlay, overlayFor, unseenEvents, videoHoldSeconds } from '../lib/overlay.ts';
import type { OverlayMedia } from '../lib/overlayMedia.ts';
import { mediaOf, playerNumbersInPlay, useOverlayMedia } from '../lib/overlayMedia.ts';
import { useOurSide, useTenantLook } from '../lib/branding.ts';
import { useReducedMotion } from '../lib/theme.ts';

/** No photos or videos of players (roster not loaded or empty). */
const NO_PLAYERS: readonly PublicPlayerMedia[] = [];

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
/** Light band only behind the text of a photo or video of a player (the media itself is never covered). */
const TEXT_BAND: Record<Side | 'neutral', string> = {
  home: 'bg-home/60',
  away: 'bg-away/60',
  neutral: 'bg-primary/60',
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
 * behind the text under a veil of the team colour (the photo or video of a player has no veil: only a light band behind
 * its text, or no text at all); a video plays inline and in a loop while the overlay is on, muted
 * unless its sound is on (muted anyway when the browser refuses the sound), in the box or on the whole screen
 * (`fit`), never with reduced motion (text only, as without media). Also the «Prova» of the editor.
 */
export function OverlayBanner({
  text,
  team,
  device,
  size = 'medium',
  media = null,
  onVideoLength,
  onVideoEnd,
}: {
  text: string;
  team: Side | null;
  device: Device;
  size?: OverlaySize;
  media?: OverlayMedia | null;
  /**
   * A video that follows its length (`media.duration` `video`): its length in seconds once known, `null` when it cannot
   * be read or the video does not start.
   */
  onVideoLength?: ((seconds: number | null) => void) | undefined;
  /** A video that follows its length reached its end. */
  onVideoEnd?: (() => void) | undefined;
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
  // The photo of a player can fill the screen too, like a video (a fixed image stays in the box).
  const fullscreen = (shown.kind === 'video' || shown.player !== undefined) && shown.fit === 'fullscreen';
  // On the whole screen (of the page, or of the frame of the preview): the region is only where the text would be.
  const box = fullscreen
    ? 'fixed inset-0'
    : `relative aspect-video max-w-[90%] rounded-panel shadow-card ${MEDIA_BOX[device]}`;
  return (
    <div
      data-overlay={tone}
      data-size={size}
      data-background={shown.kind}
      data-fit={fullscreen ? 'fullscreen' : 'center'}
      className={`${reduced ? '' : 'sir-overlay'} flex items-center justify-center overflow-hidden text-center font-display font-bold uppercase tracking-wide ${box} ${TEXT_TONE[tone]}`}
    >
      {shown.kind === 'video' ? (
        // A new element for every file: the same <video> with another src may keep showing the first one.
        <OverlayVideo
          key={shown.url}
          url={shown.url}
          audio={shown.audio === true}
          once={shown.duration === 'video'}
          onLength={onVideoLength}
          onEnd={onVideoEnd}
        />
      ) : (
        <img key={shown.url} src={shown.url} alt="" className="absolute inset-0 size-full object-cover" />
      )}
      {shown.player ? (
        // Photo or video of a player: as the original file, no veil. The text, when shown, has a band of its own.
        <span
          data-player-text={shown.player.showText ? 'shown' : 'hidden'}
          className={
            shown.player.showText
              ? `relative max-w-[90%] rounded-panel ${TEXT_BAND[tone]} ${BOX_SIZE[device][size]}`
              : 'sr-only'
          }
        >
          {text}
        </span>
      ) : (
        <>
          <div aria-hidden="true" className={`absolute inset-0 ${VEIL[tone]}`} />
          <span className={`relative ${BOX_SIZE[device][size]}`}>{text}</span>
        </>
      )}
    </div>
  );
}

/**
 * Video behind an overlay: inline, in a loop, no controls. Muted unless `audio`; with `audio` a browser that refuses
 * to start it with its sound (no click on the page yet) plays it muted, without any error.
 */
function OverlayVideo({
  url,
  audio,
  once,
  onLength,
  onEnd,
}: {
  url: string;
  audio: boolean;
  /** Played once (the overlay follows its length) instead of in a loop. */
  once: boolean;
  onLength: ((seconds: number | null) => void) | undefined;
  onEnd: (() => void) | undefined;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onLength, onEnd });
  callbacks.current = { onLength, onEnd };
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // React does not always write `muted` as an attribute: set on the element, so that autoplay is allowed.
    video.muted = !audio;
    const started = video.play?.();
    const failed = () => {
      if (ref.current === video && once) callbacks.current.onLength?.(null);
    };
    void started?.catch(() => {
      if (!audio || ref.current !== video) {
        failed();
        return;
      }
      video.muted = true;
      void video.play?.()?.catch(failed);
    });
  }, [url, audio, once]);
  return (
    <video
      ref={ref}
      src={url}
      aria-hidden="true"
      muted={!audio}
      playsInline
      autoPlay
      loop={!once}
      preload="auto"
      disablePictureInPicture
      data-audio={audio ? 'on' : 'off'}
      onLoadedMetadata={(e) => {
        if (once) callbacks.current.onLength?.(e.currentTarget.duration);
      }}
      onError={() => {
        if (once) callbacks.current.onLength?.(null);
      }}
      onEnded={() => {
        if (once) callbacks.current.onEnd?.();
      }}
      className="absolute inset-0 size-full object-cover"
    />
  );
}

/** The media of the background of an overlay, from the files read into memory; null when none or not ready yet. */
function backgroundMedia(
  background: QueuedOverlay['background'],
  ready: ReadonlyMap<string, OverlayMedia>,
  player?: QueuedOverlay['player'],
): OverlayMedia | null {
  const file = background ? ready.get(background.assetId) : undefined;
  return background && file ? mediaOf(background, file.url, player) : null;
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
  const reducedMotion = useReducedMotion();
  // Side of our team, claimed by the match view (team chosen in «Grafica»): a video for our team only follows it.
  const ourSide = useOurSide();
  // Photos and videos of the players of our team (roster): kept ready for the ones on court; no video on the phone nor
  // with reduced motion (the photo is used).
  const players = useTenantLook()?.players ?? NO_PLAYERS;
  const videos = device !== 'phone' && !reducedMotion;
  const numbers = playerNumbersInPlay(state, ourSide, config);
  const media = useOverlayMedia(config, device, reducedMotion, undefined, { players, numbers });

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
      .map((e) => overlayFor(e, state, config, device, now, ourSide, { players, videos }))
      .filter((o): o is QueuedOverlay => o !== null);
    if (items.length === 0) return;
    queue.current = enqueue(queue.current, items);
    setArrivals((n) => n + 1);
  }, [state, live, config, device, blocked, ourSide, players, videos]);

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

  // The video of the overlay on screen, when the overlay follows its length (not on the phone nor with reduced motion:
  // there the video is not shown and the seconds apply).
  const shownMedia = current ? backgroundMedia(current.background, media, current.player) : null;
  const followsVideo = shownMedia?.kind === 'video' && shownMedia.duration === 'video';
  // Length of that video: its id, the seconds (null: not readable or not started); nothing yet while it loads.
  const [length, setLength] = useState<{ id: string; seconds: number | null } | null>(null);
  const known = current && length?.id === current.id ? length.seconds : undefined;

  // Each overlay stays for its seconds; one that follows its video, for the length of the video (never over the limit),
  // or the seconds when the video cannot tell.
  useEffect(() => {
    if (!current) return;
    let ms = current.seconds * 1000;
    if (followsVideo) {
      // Waiting for the length: the limit; known: the length plus a moment for the end of the video to close it first.
      ms = (known === undefined ? OVERLAY_VIDEO_MAX_SECONDS : videoHoldSeconds(known, current.seconds)) * 1000;
      if (typeof known === 'number' && Number.isFinite(known) && known > 0) ms += 500;
    }
    const id = setTimeout(() => setCurrent(null), ms);
    return () => clearTimeout(id);
  }, [current, followsVideo, known]);

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
          media={shownMedia}
          onVideoLength={(seconds) => setLength({ id: current.id, seconds })}
          onVideoEnd={() => setCurrent(null)}
        />
      )}
    </div>
  );
}
