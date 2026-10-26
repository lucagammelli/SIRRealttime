import type { OverlayBackgroundKind } from '@arenalive/shared';
import { useEffect, useRef } from 'react';

/**
 * Whole picture (never cropped), centred; the sides are filled with the page background colour (a video) or with a
 * blurred copy of the same image (an image). Nothing is laid over the real picture.
 */
export const CONTAIN_MEDIA_CLASS = 'absolute inset-0 size-full object-contain';
export const CONTAIN_FILL_CLASS = 'absolute inset-0 size-full scale-110 object-cover blur-2xl';
/** The whole space, the edges that do not fit are cut. */
export const COVER_MEDIA_CLASS = 'absolute inset-0 size-full object-cover';

/** `contain`: the whole picture with the sides filled; `cover`: the whole space, cutting the edges. */
export type MediaPictureFit = 'contain' | 'cover';

/**
 * An image or a video of the client drawn on the whole box of its parent (which must be positioned: `relative`,
 * `fixed`, ...), decorative (`aria-hidden`: the parent says what it is): behind the text of an overlay, or a «Foto o
 * video» slide of a pause. `contain` adds the fill of the sides (`data-fill`: `blur` for an image, `color` for a video).
 * A video as `MediaVideo`. One component for both, so the overlays and the pauses play their files the same way.
 */
export function MediaPicture({
  kind,
  url,
  fit,
  audio = false,
  once = false,
  onLength,
  onEnd,
}: {
  kind: OverlayBackgroundKind;
  url: string;
  fit: MediaPictureFit;
  audio?: boolean;
  once?: boolean;
  onLength?: ((seconds: number | null) => void) | undefined;
  onEnd?: (() => void) | undefined;
}) {
  const className = fit === 'contain' ? CONTAIN_MEDIA_CLASS : COVER_MEDIA_CLASS;
  return (
    <>
      {fit === 'contain' && (
        <div aria-hidden="true" data-fill={kind === 'image' ? 'blur' : 'color'} className="absolute inset-0 bg-bg">
          {kind === 'image' && <img src={url} alt="" className={CONTAIN_FILL_CLASS} />}
        </div>
      )}
      {kind === 'video' ? (
        // A new element for every file: the same <video> with another src may keep showing the first one.
        <MediaVideo
          key={url}
          url={url}
          audio={audio}
          once={once}
          className={className}
          onLength={onLength}
          onEnd={onEnd}
        />
      ) : (
        <img key={url} src={url} alt="" className={className} />
      )}
    </>
  );
}

/**
 * Video of the client: inline, in a loop (or once), no controls. Muted unless `audio`; with `audio` a browser that
 * refuses to start it with its sound (no click on the page yet) plays it muted, without any error. Played once
 * (`once`): `onLength` gets its length in seconds once known (null when it cannot be read or does not start), `onEnd`
 * is called at its end.
 */
export function MediaVideo({
  url,
  audio,
  once,
  className,
  onLength,
  onEnd,
}: {
  url: string;
  className: string;
  audio: boolean;
  /** Played once (the overlay or the slide follows its length) instead of in a loop. */
  once: boolean;
  onLength?: ((seconds: number | null) => void) | undefined;
  onEnd?: (() => void) | undefined;
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
      className={className}
    />
  );
}
