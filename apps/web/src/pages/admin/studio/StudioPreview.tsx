import type { IntermissionKind, LayoutDevice, OverlayKind } from '@arenalive/shared';
import {
  adminAssetPath,
  brandPalette,
  LAYOUT_DEVICES,
  overlayPlacement,
  ourTeamSide,
  resolveBrandColors,
  templateOf,
} from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BlockBrand } from '../../../blocks/env.ts';
import { PaletteScopeContext } from '../../../charts/usePalette.ts';
import { SAMPLE_SCHEDULE } from '../../../blocks/sampleSchedule.ts';
import { afterMatchFile, AfterMatchScreen } from '../../../components/AfterMatchScreen.tsx';
import { Intermission } from '../../../components/Intermission.tsx';
import { overlayRegionClass, OverlayBanner, shownBackground } from '../../../components/Overlay.tsx';
import { PreviewFullscreen } from '../../../components/PreviewDock.tsx';
import { buttonClass, Segmented, Spinner } from '../../../components/ui.tsx';
import { previewState, visibleSlides } from '../../../lib/intermission.ts';
import { nextFixture } from '../../../lib/schedule.ts';
import { overlayText } from '../../../lib/overlay.ts';
import { mediaOf } from '../../../lib/overlayMedia.ts';
import { teamColorVars } from '../../../lib/teamColors.ts';
import { useReducedMotion, useResolvedTheme } from '../../../lib/theme.ts';
import type { PauseTarget } from '../intermissionEditor.ts';
import { pauseAt, targetSet } from '../intermissionEditor.ts';
import { DevicePreview, previewPageUrl } from './blockEditors.tsx';
import type { PickBox, RosterSample, StudioDocs, StudioScene, StudioTarget } from './model.ts';
import {
  DEVICE_LABELS,
  OVERLAY_LABELS,
  overlayPreview,
  pauseKindOf,
  pickAt,
  PICKABLE,
  stableJson,
  SCENE_LABELS,
  SCENES,
  targetOf,
  targetSelector,
} from './model.ts';

/** Elements of a setting being highlighted, and the scene where they show (null: every scene). */
export interface StudioHighlight {
  targets: readonly StudioTarget[];
  scene: StudioScene | null;
}

/** A «Prova» of an overlay: shown again (with its animation) at every new key. */
export interface OverlayTrial {
  key: number;
  kind: OverlayKind;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Box of an element; for an element without its own box (`display: contents`) the box around its children. */
function elementBox(el: Element): Box {
  // A plain object: the fields of a DOMRect are getters, lost by a spread.
  const rect = el.getBoundingClientRect();
  const r = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  if (r.width > 0 || r.height > 0 || el.children.length === 0) return r;
  const boxes = [...el.children].map(elementBox).filter((b) => b.width > 0 && b.height > 0);
  if (boxes.length === 0) return r;
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

const sameBoxes = (a: readonly Box[], b: readonly Box[]): boolean =>
  a.length === b.length &&
  a.every(
    (x, i) =>
      Math.abs(x.left - (b[i]?.left ?? 0)) < 0.5 &&
      Math.abs(x.top - (b[i]?.top ?? 0)) < 0.5 &&
      Math.abs(x.width - (b[i]?.width ?? 0)) < 0.5 &&
      Math.abs(x.height - (b[i]?.height ?? 0)) < 0.5,
  );

/** The marked elements under a point of the preview, as boxes for `pickAt`. */
export function pickBoxes(root: Element): PickBox[] {
  return [...root.querySelectorAll<HTMLElement>(PICKABLE)].map((el) => ({
    target: targetOf({
      block: el.dataset.studioBlock,
      slide: el.dataset.studioSlide,
      intermission: el.dataset.intermission !== undefined,
      overlay: el.dataset.overlay !== undefined,
    }),
    ...elementBox(el),
  }));
}

/**
 * The page of the client in the preview with the colours being edited: own tokens (`data-sir-scope` with the template
 * and the theme of the draft, the palette of the draft and the colours of «nostra squadra» of the draft), so the real
 * components of the public page show the draft and the reserved area around keeps its own.
 */
function BrandScope({
  docs,
  state,
  tv,
  children,
}: {
  docs: StudioDocs;
  state: MatchState;
  /** Preview of the big screen: its tokens do not follow the width of the window (fixed canvas). */
  tv: boolean;
  children: ReactNode;
}) {
  const resolved = useResolvedTheme();
  const { template, colors, ourTeam } = docs.branding;
  const theme = templateOf(template).forcedTheme ?? resolved;
  const side = ourTeamSide(state.teams, ourTeam);
  const style: CSSProperties = useMemo(
    () => ({
      ...brandPalette(template === 'standard' ? resolveBrandColors(colors) : colors, template)[theme],
      ...teamColorVars(side),
    }),
    [colors, template, theme, side],
  );
  // The charts inside read their palette on this element (the colours of the draft), not on <html>.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const key = `${template}-${theme}-${hashText(stableJson(style))}`;
  const scope = useMemo(() => (root ? { root, key } : null), [root, key]);
  return (
    <div
      ref={setRoot}
      data-testid="anteprima-studio"
      data-sir-scope=""
      data-template={template}
      data-theme={theme}
      {...(tv ? { 'data-tv-canvas': '' } : {})}
      style={style}
      className="h-full w-full font-sans text-text"
    >
      <PaletteScopeContext.Provider value={scope}>{children}</PaletteScopeContext.Provider>
    </div>
  );
}

/** Pure: short hash of a text (name of the ECharts theme of a palette). */
export function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/** What the stage shows: the page of the device and, over it, the pause or the overlay of the scene. */
function Stage({
  device,
  scene,
  state,
  docs,
  look,
  sponsorLogo,
  pauseTarget,
  overlayKind,
  trial,
  sample,
  fit,
  top,
  live,
  onNotice,
  onTrialLength,
  onTrialEnd,
}: {
  device: LayoutDevice;
  scene: StudioScene;
  state: MatchState;
  docs: StudioDocs;
  look: BlockBrand | null;
  sponsorLogo: string | null;
  pauseTarget: PauseTarget;
  overlayKind: OverlayKind;
  trial: OverlayTrial | null;
  /** A player of the roster with a photo or video, for the overlays of a player. */
  sample: RosterSample | null;
  fit: boolean;
  top: boolean;
  /** The match is the live one (not the example): the caption says so. */
  live: boolean;
  onNotice?: (text: string | null) => void;
  /** «Prova» of an overlay whose video sets its length: the length of the video (null: not readable). */
  onTrialLength?: ((seconds: number | null) => void) | undefined;
  /** «Prova»: the video reached its end. */
  onTrialEnd?: (() => void) | undefined;
}) {
  const kind: IntermissionKind | null = pauseKindOf(scene);
  const ownTarget = kind !== null && pauseTarget.startsWith(kind) ? pauseTarget : kind;
  const pause = kind && ownTarget ? (pauseAt(docs.intermissions, ownTarget) ?? docs.intermissions.setBreak) : null;
  const set = kind === 'setBreak' && ownTarget ? targetSet(ownTarget) : null;
  const shown = useMemo(
    () => (kind ? previewState(state, kind, set ? Number(set) : undefined) : state),
    [state, kind, set],
  );
  const overlayKindShown = trial?.kind ?? overlayKind;
  const overlay = docs.overlays[overlayKindShown];
  const placement = overlayPlacement(docs.overlays, overlay);
  const reducedMotion = useReducedMotion();
  // The example event is of our team (home when the team of the client is not in the match): its video is shown.
  const trialSide = ourTeamSide(shown.teams, docs.branding.ourTeam) ?? 'home';
  const preview = overlayPreview(overlayKindShown, overlay, shown, trialSide, sample, trial?.key ?? 0);
  const previewBackground = preview.background;
  const previewMedia = previewBackground
    ? {
        ...mediaOf(previewBackground, adminAssetPath(previewBackground.assetId), preview.player),
        // The sound only in a «Prova»: the preview always in view stays silent.
        audio: previewBackground.audio && trial !== null,
        // Always in view (no «Prova»): the video loops; in a «Prova» it plays once and ends the test.
        duration: trial === null ? ('seconds' as const) : previewBackground.duration,
      }
    : null;
  const slides =
    pause && kind
      ? visibleSlides(
          shown,
          { set: set ? Number(set) : shown.live.set, pause },
          // The files of the «Foto o video» slides are read from the reserved area, as the preview shows them.
          { sponsorLogo, schedule: SAMPLE_SCHEDULE, sponsors: look?.sponsors ?? [], mediaUrl: adminAssetPath },
        )
      : [];
  let notice: string | null = null;
  if (pause && !pause.enabled) notice = 'Pausa disattivata: gli spettatori non la vedono.';
  else if (pause && slides.length === 0)
    notice =
      'Nessuna diapositiva da mostrare (uno sponsor senza immagini, una «Foto o video» senza file?): la pausa non compare.';
  const afterMatch = docs.intermissions.afterMatch;
  const afterMatchPhoto = scene === 'afterMatch' ? afterMatch.image : null;
  if (scene === 'afterMatch' && afterMatchPhoto === null)
    notice =
      'Dopo la partita: scegli una foto o un video e accendi «Mostra foto o video dopo la partita», altrimenti la schermata non compare.';
  else if (scene === 'afterMatch' && !afterMatch.enabled)
    notice = 'Dopo la partita è spento: gli spettatori non lo vedono (qui lo vedi comunque).';
  if (scene === 'overlay' && !overlay.enabled) notice = 'Avviso spento: gli spettatori non lo vedono.';
  else if (scene === 'overlay' && !overlay.devices[device])
    notice = `Su ${DEVICE_LABELS[device]} questo avviso non compare.`;
  useLayoutEffect(() => onNotice?.(notice), [notice, onNotice]);
  const showOverlay = scene === 'overlay' && overlay.enabled && overlay.devices[device];
  return (
    <DevicePreview
      device={device}
      template={docs.branding.template}
      layout={docs.layout}
      state={shown}
      look={look}
      fit={fit}
      top={top}
      source={live ? 'Partita live' : 'Partita d’esempio'}
    >
      {pause && (
        <Intermission
          key={`${ownTarget ?? ''}-${device}`}
          state={shown}
          config={null}
          device={device}
          paused={false}
          look={look}
          sponsorLogo={sponsorLogo}
          pageUrl={previewPageUrl()}
          schedule={SAMPLE_SCHEDULE}
          preview={pause}
        />
      )}
      {scene === 'afterMatch' && (docs.intermissions.afterMatch.image ?? null) !== null && (
        <AfterMatchScreen
          file={afterMatchFile(
            docs.intermissions.afterMatch,
            adminAssetPath(docs.intermissions.afterMatch.image ?? ''),
          )}
          fixture={nextFixture(SAMPLE_SCHEDULE)}
          device={device}
          contained
        />
      )}
      {scene === 'overlay' && (
        <div className={overlayRegionClass(placement.position, shownBackground(previewMedia, reducedMotion))} data-testid="prova-avviso">
          {showOverlay && (
            <OverlayBanner
              key={trial ? `prova-${trial.key}` : overlayKindShown}
              text={overlayText(preview.event, shown, overlay)}
              team={trialSide}
              device={device}
              size={placement.size}
              media={previewMedia}
              position={placement.position}
              onVideoEnd={onTrialEnd}
              onVideoLength={onTrialLength}
            />
          )}
        </div>
      )}
    </DevicePreview>
  );
}

/**
 * Preview column of the Studio, always in view: the device and the scene (In gioco, Fine set, Time-out, Ogni N punti,
 * Fine partita, Avviso), the page drawn with the real components of the public page and the drafts of every section.
 * The elements of the setting under the mouse (or the keyboard focus) are outlined; when they are not in the scene,
 * a button offers the scene where they are. A click on an element of the page opens its setting (`onPick`).
 */
export function StudioPreview({
  device,
  onDevice,
  scene,
  onScene,
  state,
  live,
  docs,
  look,
  sponsorLogo,
  pauseTarget,
  overlayKind,
  trial,
  sample = null,
  highlight,
  onPick,
  toolbar = true,
  wide,
  onWide,
  onTrialLength,
  onTrialEnd,
}: {
  device: LayoutDevice;
  onDevice: (device: LayoutDevice) => void;
  scene: StudioScene;
  onScene: (scene: StudioScene) => void;
  /** Match of the preview (null: still loading). */
  state: MatchState | null;
  /** The match is the live one (not the example). */
  live: boolean;
  docs: StudioDocs;
  look: BlockBrand | null;
  sponsorLogo: string | null;
  pauseTarget: PauseTarget;
  overlayKind: OverlayKind;
  trial: OverlayTrial | null;
  /** A player of the roster with a photo or video, for the preview of the overlays of a player. */
  sample?: RosterSample | null;
  highlight: StudioHighlight | null;
  onPick: (target: StudioTarget) => void;
  /** Device, scene and full screen buttons (the guided setup has its own). */
  toolbar?: boolean;
  /** «Allarga anteprima» on (the columns of the Studio make room); missing: no button (phone). */
  wide?: boolean;
  onWide?: () => void;
  onTrialLength?: ((seconds: number | null) => void) | undefined;
  onTrialEnd?: (() => void) | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [marks, setMarks] = useState<Box[]>([]);
  const [full, setFull] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closeFull = useCallback(() => setFull(false), []);

  // Outlines of the highlighted elements, measured again while they stay highlighted (the page moves: groups, slides).
  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const measure = (): void => {
      const found: Box[] = [];
      if (highlight && highlight.targets.length > 0) {
        const base = root.getBoundingClientRect();
        for (const target of highlight.targets)
          for (const el of root.querySelectorAll(targetSelector(target))) {
            const b = elementBox(el);
            if (b.width > 0 && b.height > 0)
              found.push({ left: b.left - base.left, top: b.top - base.top, width: b.width, height: b.height });
          }
      }
      setMarks((old) => (sameBoxes(old, found) ? old : found));
    };
    measure();
    if (!highlight) return;
    const id = setInterval(measure, 300);
    return () => clearInterval(id);
  }, [highlight, device, scene, docs, state]);

  // A highlighted setting not in this scene: a button offers its scene. It stays a few seconds after the mouse leaves
  // the setting, so it can be reached.
  const away =
    highlight !== null && highlight.targets.length > 0 && marks.length === 0 && highlight.scene !== null
      ? highlight.scene !== scene
        ? highlight.scene
        : null
      : null;
  const [hidden, setHidden] = useState<StudioScene | null>(null);
  useLayoutEffect(() => {
    if (away) setHidden(away);
    else if (highlight) setHidden(null);
  }, [away, highlight]);
  useLayoutEffect(() => setHidden(null), [scene]);
  useLayoutEffect(() => {
    if (!hidden || highlight) return;
    const id = setTimeout(() => setHidden(null), 5000);
    return () => clearTimeout(id);
  }, [hidden, highlight]);

  const pick = (e: MouseEvent<HTMLDivElement>): void => {
    const root = box.current;
    if (!root) return;
    const target = pickAt(pickBoxes(root), e.clientX, e.clientY);
    if (target) onPick(target);
  };

  const sceneLabel = (s: StudioScene): string =>
    s === 'overlay' ? `Avviso «${OVERLAY_LABELS[trial?.kind ?? overlayKind].label}»` : SCENE_LABELS[s];
  const stage = (full: boolean) =>
    state ? (
      <BrandScope docs={docs} state={state} tv={device === 'tv'}>
        <Stage
          device={device}
          scene={scene}
          state={state}
          docs={docs}
          look={look}
          sponsorLogo={sponsorLogo}
          pauseTarget={pauseTarget}
          overlayKind={overlayKind}
          trial={trial}
          sample={sample}
          onTrialLength={onTrialLength}
          onTrialEnd={onTrialEnd}
          fit
          top={!full}
          live={live}
          {...(full ? {} : { onNotice: setNotice })}
        />
      </BrandScope>
    ) : (
      <Spinner label="Preparazione dell’anteprima…" />
    );

  return (
    <section aria-label="Anteprima" className="flex h-full min-h-0 min-w-0 flex-col">
      {toolbar && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Dispositivo</span>
            <Segmented
              label="Dispositivo dell’anteprima"
              size="xs"
              options={LAYOUT_DEVICES.map((d) => ({ value: d, label: DEVICE_LABELS[d] }))}
              value={device}
              onChange={onDevice}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Scena</span>
            <Segmented
              label="Scena dell’anteprima"
              size="xs"
              options={SCENES.map((s) => ({ value: s.id, label: sceneLabel(s.id) }))}
              value={scene}
              onChange={onScene}
            />
          </div>
          {onWide && (
            <button
              type="button"
              className={`${buttonClass('ghost')} ml-auto`}
              aria-pressed={wide}
              onClick={onWide}
              title={
                wide ? 'Torna alle colonne normali' : 'Stringe le sezioni e le impostazioni per un’anteprima più grande'
              }
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d={wide ? 'M14 8l-4 4 4 4M4 4v16' : 'M10 8l4 4-4 4M4 4v16'} />
              </svg>
              Allarga anteprima
            </button>
          )}
          <button
            type="button"
            ref={opener}
            className={`${buttonClass('ghost')} ${onWide ? '' : 'ml-auto'}`}
            aria-label="Anteprima a tutto schermo"
            title="Anteprima a tutto schermo"
            onClick={() => setFull(true)}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </svg>
            <span className="hidden 2xl:inline">Tutto schermo</span>
          </button>
        </div>
      )}
      <div ref={box} className="relative min-h-0 flex-1 p-3">
        {/* The page is inert: a click is read here, on the element under the pointer (see `pickAt`). */}
        <div className="h-full w-full cursor-pointer" onClick={pick} data-testid="anteprima-palco">
          {stage(false)}
        </div>
        {marks.map((m, i) => (
          <div
            key={i}
            aria-hidden="true"
            data-testid="evidenziato"
            className="pointer-events-none absolute rounded-card outline-2 outline-offset-2 outline-focus motion-safe:animate-pulse"
            style={{ left: m.left, top: m.top, width: m.width, height: m.height }}
          />
        ))}
        {(notice || hidden) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
            {hidden ? (
              <button
                type="button"
                onClick={() => onScene(hidden)}
                className="pointer-events-auto rounded-full bg-text px-4 py-1.5 text-sm font-medium text-bg shadow-card"
              >
                Non si vede in questa scena. Mostra «{sceneLabel(hidden)}»
              </button>
            ) : (
              <p role="status" className="rounded-full bg-surface px-4 py-1.5 text-sm text-warn shadow-card">
                {notice}
              </p>
            )}
          </div>
        )}
      </div>
      {toolbar && (
        <p className="px-3 pb-2 text-xs text-muted">
          {live ? 'Dati della partita live.' : 'Partita d’esempio: nessuna partita live in questo momento.'} Clicca un
          elemento per aprirne le impostazioni.
        </p>
      )}
      {full && (
        <PreviewFullscreen label="Anteprima a tutto schermo" onClose={closeFull} returnFocus={opener}>
          {stage(true)}
        </PreviewFullscreen>
      )}
    </section>
  );
}
