import type { Intermission as PauseConfig, TenantIntermissions } from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { BlockBrand } from '../blocks/env.ts';
import type { SlideEnv } from '../blocks/IntermissionSlides.tsx';
import { renderSlide } from '../blocks/IntermissionSlides.tsx';
import { teamName } from '../lib/format.ts';
import type { ActivePause } from '../lib/intermission.ts';
import { activePause, describePause, pauseTitle, phaseOf, visibleSlides } from '../lib/intermission.ts';
import type { Device } from '../lib/layout.ts';
import { useReducedMotion } from '../lib/theme.ts';
import { useElementHeight } from '../lib/useLayout.ts';

const BUTTON =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-card px-3 py-1.5 text-sm font-medium transition-opacity';
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Pause of the public page: when the phase of the match is a time-out, the end of a set or the end of the match and
 * the client has that pause on, it shows its slides in turn, after the delay chosen (at once when the page is opened
 * during the pause). Full screen (dialog over the page, «Torna alla partita» and Esc close it) or banner fixed at the
 * bottom (the page and its scoreboard stay visible), as chosen for the device. It closes by itself when the play
 * starts again. The slides stop with «Ferma rotazione» (the same switch of the big screen) and with reduced motion.
 * `preview`: the pause of the editor, shown at once, never focused nor closed.
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
}: {
  state: MatchState;
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
}) {
  const phase = phaseOf(state);
  const described = describePause(phase);
  // A pause already in progress when the page opens is shown at once.
  const [initialKey] = useState(() => described?.key ?? null);
  const active: ActivePause | null = preview
    ? described && { ...described, pause: preview }
    : config
      ? activePause(state, config)
      : null;
  const key = active?.key ?? null;
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

  if (!active || shownKey !== key || closedKey === key) return null;
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
  pageUrl?: string;
  preview: boolean;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const mode = active.pause.modes[device];
  const slides = visibleSlides(state, active, { sponsorLogo });
  const [tick, setTick] = useState(0);
  const index = slides.length > 0 ? tick % slides.length : 0;
  const slide = slides[index];
  const rotating = slides.length > 1 && !paused && !reduced;
  const seconds = slide?.seconds ?? 0;

  // Every slide stays on screen for its own seconds.
  useEffect(() => {
    if (!rotating) return;
    const id = setTimeout(() => setTick((t) => t + 1), seconds * 1000);
    return () => clearTimeout(id);
  }, [rotating, seconds, tick]);

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
  const env: SlideEnv = {
    state,
    device,
    brandInScoreboard: false,
    brand: look,
    paused: paused || reduced,
    set: active.set,
    sponsorLogo,
    ...(pageUrl === undefined ? {} : { pageUrl }),
  };
  const toggle =
    slides.length > 1 && !reduced && onTogglePaused ? (
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
          className="sir-flash fixed inset-x-0 bottom-0 z-40 border-t-4 border-accent bg-surface shadow-card"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 sm:px-5">
            <h2 id={titleId} className="font-display text-sm font-bold uppercase tracking-wide text-accent">
              {title}
            </h2>
            <div key={`${slide.id}-${tick}`} className="sir-fade min-w-0 flex-1 basis-48">
              {renderSlide(slide, env, 'compact')}
            </div>
            <div className="flex items-center gap-2">
              {dots}
              {toggle}
              {!preview && (
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-intermission="fullscreen"
      onKeyDown={trap}
      className="sir-flash fixed inset-0 z-50 flex flex-col gap-3 border-t-4 border-accent bg-bg p-4 text-text lg:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="font-display text-2xl font-bold uppercase tracking-wide text-accent">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {toggle}
          {!preview && (
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
      <div key={`${slide.id}-${tick}`} className="sir-fade min-h-0 flex-1 overflow-hidden">
        {renderSlide(slide, env, 'full')}
      </div>
      {dots}
    </div>
  );
}
