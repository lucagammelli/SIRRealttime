import type { Intermission as PauseConfig, ScheduleResponse, TenantIntermissions } from '@arenalive/shared';
import { adminAssetPath, SLIDE_VIDEO_MAX_SECONDS } from '@arenalive/shared';
import type { MatchState, PointMilestone } from '@arenalive/volley-stats';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { BlockBrand } from '../blocks/env.ts';
import type { SlideEnv } from '../blocks/IntermissionSlides.tsx';
import { renderSlide } from '../blocks/IntermissionSlides.tsx';
import { teamName } from '../lib/format.ts';
import type { ActivePause, MilestoneMemory, SlideContext } from '../lib/intermission.ts';
import {
  activePause,
  describePause,
  milestonePause,
  milestoneStep,
  pauseTitle,
  phaseOf,
  slideMediaFiles,
  visibleSlides,
} from '../lib/intermission.ts';
import type { Device } from '../lib/layout.ts';
import { videoHoldSeconds } from '../lib/overlay.ts';
import { directMediaUrl, useMediaFiles } from '../lib/overlayMedia.ts';
import { intermissionsUseSchedule, isScheduleType, useSchedule } from '../lib/schedule.ts';
import { useReducedMotion } from '../lib/theme.ts';
import { useElementHeight, useTouch, useTouchScreen } from '../lib/useLayout.ts';
import { SlideFit } from './SlideFit.tsx';

const BUTTON =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-card px-3 py-1.5 text-sm font-medium transition-opacity';
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Pause of the public page: when the phase of the match is a time-out, the end of a set or the end of the match and
 * the client has that pause on, it shows its slides in turn, after the delay chosen (at once when the page is opened
 * during the pause). Full screen (dialog over the page, «Torna alla partita» and Esc close it) or banner fixed at the
 * bottom (the page and its scoreboard stay visible), as chosen for the device. It closes by itself when the play
 * starts again. The slides stop with «Ferma rotazione» (the same switch of the big screen) and with reduced motion.
 * During the set the «ogni N punti» pause opens when a live update reaches a new threshold (`milestoneStep`): never at
 * the first state, after a reconnection or a resync (`live` false), never over a time-out, an end of set or the end
 * of the match (they go first and close it); it shows its slides once and closes by itself.
 * `preview`: the pause of the editor, shown at once, never focused nor closed (in play: the «ogni N punti»).
 * The files of the «Foto o video» slides of the pause are read into memory as soon as the pause starts (during its
 * delay); a slide whose file is not ready (or deleted) is skipped. A slide can hide the title of the pause
 * (`showTitle`): it stays for screen readers and the slide takes its space.
 * The slide on screen carries `data-studio-slide` (its id): an inert mark for the preview of the «Studio grafico».
 */
export function Intermission({
  state,
  config,
  device,
  paused,
  onTogglePaused,
  look = null,
  sponsorLogo = null,
  pageUrl,
  preview,
  onFullscreenChange,
  live = false,
  schedule,
}: {
  state: MatchState;
  /** The state is a live update (`LiveData.live`): only these can open the «ogni N punti». */
  live?: boolean;
  /** Pauses of the client (the defaults when its graphics could not be loaded); null while loading: none. */
  config: TenantIntermissions | null;
  device: Device;
  /** Rotation stopped by the viewer. */
  paused: boolean;
  onTogglePaused?: () => void;
  look?: BlockBrand | null;
  sponsorLogo?: string | null;
  pageUrl?: string;
  /** Editor: this pause, for the phase of `state`, even when it is off. */
  preview?: PauseConfig;
  /** Told whether a full screen pause is on screen (the overlays of the events stay away from it). */
  onFullscreenChange?: (shown: boolean) => void;
  /** Matches and standings of the club (the editor passes an example); missing: read from the server when needed. */
  schedule?: ScheduleResponse | null;
}) {
  const needsSchedule = preview
    ? preview.slides.some((s) => s.enabled && isScheduleType(s.type))
    : intermissionsUseSchedule(config);
  const fetched = useSchedule(
    schedule === undefined && needsSchedule,
    `${state.status}:${state.setsWon.home}-${state.setsWon.away}`,
  );
  const data = schedule === undefined ? fetched : schedule;
  const phase = phaseOf(state);
  const described = describePause(phase);
  // A pause already in progress when the page opens is shown at once.
  const [initialKey] = useState(() => described?.key ?? null);
  const phaseActive = !preview && config ? activePause(state, config) : null;
  const milestoneConfig = !preview && config ? config.milestone : null;

  // «Ogni N punti»: every new state goes through the rule; a more important pause closes the one on screen.
  const memory = useRef<MilestoneMemory | null>(null);
  const [milestone, setMilestone] = useState<PointMilestone | null>(null);
  const blocked = phaseActive !== null;
  useEffect(() => {
    const step = milestoneStep(memory.current, state, { pause: milestoneConfig, live, blocked });
    memory.current = step.memory;
    if (step.open) setMilestone(step.open);
    else if (blocked || !milestoneConfig?.enabled) setMilestone(null);
  }, [state, live, blocked, milestoneConfig]);

  const previewMilestone: Omit<ActivePause, 'pause'> = {
    kind: 'milestone',
    key: 'milestone-preview',
    set: state.live.set,
    team: null,
    score: { home: state.live.homeScore, away: state.live.awayScore },
  };
  // «Pausa attiva» off wins over everything: whatever the state says, a pause that is off is never the one on screen
  // (not even for the frame before the effect above closes the «ogni N punti»).
  const candidate: ActivePause | null = preview
    ? { ...(described ?? previewMilestone), pause: preview }
    : (phaseActive ?? (milestone && milestoneConfig ? milestonePause(milestone, milestoneConfig) : null));
  const active = candidate && (preview || candidate.pause.enabled) ? candidate : null;
  const key = active?.key ?? null;
  // Files of the «Foto o video» slides of this pause (the preview uses the addresses of the reserved area as they are).
  const reduced = useReducedMotion();
  const files = useMediaFiles(
    slideMediaFiles(active?.pause ?? null, reduced),
    preview ? directMediaUrl : undefined,
    preview ? adminAssetPath : undefined,
  );
  const context: SlideContext = {
    sponsorLogo,
    schedule: data,
    sponsors: look?.sponsors ?? [],
    mediaUrl: (id) => files.get(id)?.url ?? null,
    reducedMotion: reduced,
  };
  const delayMs = preview || key === initialKey ? 0 : (active?.pause.delaySeconds ?? 0) * 1000;
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const close = useCallback(() => setClosedKey(key), [key]);

  useEffect(() => {
    if (key === null) return;
    if (delayMs === 0) {
      setShownKey(key);
      return;
    }
    const id = setTimeout(() => setShownKey(key), delayMs);
    return () => clearTimeout(id);
  }, [key, delayMs]);

  const visible = active !== null && shownKey === key && closedKey !== key;
  // The «ogni N punti» shows its slides once, then the match comes back.
  const onceMs =
    visible && !preview && active.kind === 'milestone'
      ? visibleSlides(state, active, context).reduce((sum, s) => sum + s.seconds, 0) * 1000
      : null;
  // Counted from when the pause shows: the next points (new states) do not restart it.
  const once = useRef(0);
  once.current = onceMs ?? 0;
  const counting = onceMs !== null;
  useEffect(() => {
    if (!counting) return;
    const id = setTimeout(() => setMilestone(null), once.current);
    return () => clearTimeout(id);
  }, [key, counting]);
  const fullscreen =
    visible &&
    !preview &&
    active.pause.modes[device] === 'fullscreen' &&
    visibleSlides(state, active, context).length > 0;
  useEffect(() => {
    onFullscreenChange?.(fullscreen);
  }, [fullscreen, onFullscreenChange]);
  useEffect(() => () => onFullscreenChange?.(false), [onFullscreenChange]);

  if (!active || !visible) return null;
  return (
    <PauseView
      key={active.key}
      state={state}
      active={active}
      device={device}
      paused={paused}
      {...(onTogglePaused ? { onTogglePaused } : {})}
      look={look}
      sponsorLogo={sponsorLogo}
      schedule={data}
      context={context}
      {...(pageUrl === undefined ? {} : { pageUrl })}
      preview={preview !== undefined}
      onClose={close}
    />
  );
}

function PauseView({
  state,
  active,
  device,
  paused,
  onTogglePaused,
  look,
  sponsorLogo,
  schedule,
  context,
  pageUrl,
  preview,
  onClose,
}: {
  state: MatchState;
  active: ActivePause;
  device: Device;
  paused: boolean;
  onTogglePaused?: () => void;
  look: BlockBrand | null;
  sponsorLogo: string | null;
  schedule: ScheduleResponse | null;
  /** What the slides need to be shown (`visibleSlides`). */
  context: SlideContext;
  pageUrl?: string;
  preview: boolean;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  // Buttons of the pause: option «Touch» of the club AND a real touch screen (the Studio preview follows the option only).
  const screenTouch = useTouchScreen();
  const touchOption = useTouch();
  const touch = touchOption && (preview || screenTouch);
  const titleId = useId();
  const mode = active.pause.modes[device];
  const slides = visibleSlides(state, active, context);
  const [tick, setTick] = useState(0);
  const index = slides.length > 0 ? tick % slides.length : 0;
  const slide = slides[index];
  const rotating = slides.length > 1 && !paused && !reduced;
  const seconds = slide?.seconds ?? 0;
  // A «Foto o video» slide that follows its video while the slides rotate: the video plays once and the slide lasts
  // as long as it (at most SLIDE_VIDEO_MAX_SECONDS; its seconds when the length cannot be read). Not rotating: it loops.
  const slideKey = slide ? `${slide.id}-${tick}` : '';
  const followsVideo =
    rotating && slide?.type === 'media' && slide.options.kind === 'video' && slide.options.duration === 'video';
  const [length, setLength] = useState<{ key: string; seconds: number | null } | null>(null);
  const known = length?.key === slideKey ? length.seconds : undefined;
  let holdMs = seconds * 1000;
  if (followsVideo) {
    // Waiting for the length: the limit; known: the length plus a moment for the end of the video to move on first.
    holdMs =
      (known === undefined ? SLIDE_VIDEO_MAX_SECONDS : videoHoldSeconds(known, seconds, SLIDE_VIDEO_MAX_SECONDS)) *
      1000;
    if (typeof known === 'number' && Number.isFinite(known) && known > 0) holdMs += 500;
  }

  // Every slide stays on screen for its own seconds (a video that it follows: for its length).
  useEffect(() => {
    if (!rotating) return;
    const id = setTimeout(() => setTick((t) => t + 1), holdMs);
    return () => clearTimeout(id);
  }, [rotating, holdMs, tick]);

  // Esc closes the pause (not in the editor).
  useEffect(() => {
    if (preview) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [preview, onClose]);

  // Full screen: the focus goes to «Torna alla partita» and back where it was when the pause closes.
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (preview || mode !== 'fullscreen') return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    back.current?.focus();
    return () => before?.focus();
  }, [preview, mode]);

  const banner = useRef<HTMLElement>(null);
  const bannerHeight = useElementHeight(banner, mode);

  if (!slide) return null;
  const title = pauseTitle(active, (side) => teamName(state.teams, side));
  // Hidden for this slide: the title stays for screen readers (it names the dialog or the banner).
  const showTitle = slide.showTitle;
  const media = slide.type === 'media';
  const env: SlideEnv = {
    state,
    device,
    brandInScoreboard: false,
    brand: look,
    paused: paused || reduced,
    schedule,
    set: active.set,
    sponsorLogo,
    mediaUrl: context.mediaUrl,
    video: {
      follow: followsVideo,
      // The preview of the Studio stays silent.
      muted: preview,
      onLength: (s) => setLength({ key: slideKey, seconds: s }),
      onEnd: () => setTick((t) => t + 1),
    },
    ...(pageUrl === undefined ? {} : { pageUrl }),
  };
  const toggle =
    touch && slides.length > 1 && !reduced && onTogglePaused ? (
      <button
        type="button"
        onClick={onTogglePaused}
        aria-pressed={paused}
        aria-label="Ferma rotazione"
        title={paused ? 'Riprendi rotazione' : 'Ferma rotazione'}
        className={`${BUTTON} border border-border bg-surface text-text hover:bg-surface-2`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {paused ? <path d="M8 5l11 7-11 7z" /> : <path d="M9 5v14M15 5v14" />}
        </svg>
      </button>
    ) : null;
  const dots =
    slides.length > 1 ? (
      <div role="img" aria-label={`Schermata ${index + 1} di ${slides.length}`} className="flex justify-center gap-1.5">
        {slides.map((s, i) => (
          <span
            key={s.id}
            className={`inline-block h-1.5 rounded-full transition-all motion-reduce:transition-none ${
              i === index ? 'w-6 bg-primary' : 'w-1.5 bg-axis'
            }`}
          />
        ))}
      </div>
    ) : null;

  if (mode === 'banner') {
    return (
      <>
        {device !== 'tv' && <div aria-hidden="true" style={{ height: bannerHeight }} />}
        {/* The banner does not take the focus: a short status tells screen readers that the pause began. */}
        <p role="status" className="sr-only">
          {title}
        </p>
        <section
          ref={banner}
          aria-labelledby={titleId}
          data-intermission="banner"
          className="fixed inset-x-0 bottom-0 z-40 border-t-4 border-accent bg-surface shadow-card"
        >
          {/* Only the content comes in: the band itself is always opaque (never the page through it). */}
          <div className="sir-flash mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 sm:px-5">
            <h2
              id={titleId}
              data-title={showTitle ? 'shown' : 'hidden'}
              className={showTitle ? 'font-display text-sm font-bold uppercase tracking-wide text-accent' : 'sr-only'}
            >
              {title}
            </h2>
            <div key={slideKey} data-studio-slide={slide.id} className="sir-fade min-w-0 flex-1 basis-full sm:basis-48">
              {renderSlide(slide, env, 'compact')}
            </div>
            <div className="flex items-center gap-2">
              {dots}
              {toggle}
              {!preview && touch && (
                <button
                  type="button"
                  onClick={onClose}
                  className={`${BUTTON} border border-border bg-surface-2 text-text hover:bg-surface`}
                >
                  Chiudi
                </button>
              )}
            </div>
          </div>
        </section>
      </>
    );
  }

  // Tab stays inside the dialog.
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const heading = (
    <h2
      id={titleId}
      data-title={showTitle ? 'shown' : 'hidden'}
      className={showTitle ? 'font-display text-2xl font-bold uppercase tracking-wide text-accent' : 'sr-only'}
    >
      {title}
    </h2>
  );
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-intermission="fullscreen"
      onKeyDown={trap}
      // Opaque from the first frame, on the whole screen also while the slide scrolls: no entrance animation on the
      // dialog itself (an opacity animation not run to its end, e.g. a browser that skips frames, left the page
      // visible under it); only its content comes in.
      className="fixed inset-0 z-50 flex flex-col gap-3 overflow-hidden border-t-4 border-accent bg-bg p-4 text-text lg:p-6"
    >
      {showTitle || toggle || (!preview && touch) ? (
        <header
          className={`sir-flash flex flex-wrap items-center gap-3 ${showTitle ? 'justify-between' : 'justify-end'}`}
        >
          {heading}
          <div className="flex items-center gap-2">
            {toggle}
            {!preview && touch && (
              <button
                ref={back}
                type="button"
                onClick={onClose}
                className={`${BUTTON} bg-primary text-on-primary hover:opacity-90`}
              >
                Torna alla partita
              </button>
            )}
          </div>
        </header>
      ) : (
        // No title and no buttons: no header at all, the slide takes the whole height.
        heading
      )}
      {/* Taller than the screen (many rows, small screen): the slide scrolls, it is never cut; bigger or fitted to the
          space as the pause chooses. */}
      {/* A «Foto o video» slide fills its whole space as it is (never scaled nor scrolled). */}
      <SlideFit
        key={slideKey}
        data-studio-slide={slide.id}
        size={media ? 'normal' : active.pause.fullscreenSize}
        cut={media || (!touchOption && device === 'tv')}
        className={`sir-fade min-h-0 flex-1 ${media ? 'relative' : ''}`}
      >
        {renderSlide(slide, env, 'full')}
      </SlideFit>
      {dots}
    </div>
  );
}
