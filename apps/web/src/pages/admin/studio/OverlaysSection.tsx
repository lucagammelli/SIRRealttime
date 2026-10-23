import type {
  AssetListResponse,
  AssetSummary,
  Overlay,
  OverlayBackground,
  OverlayBackgroundKind,
  OverlayVideoFit,
  OverlayVideoDuration,
  OverlayVideoTeams,
  OverlayKind,
  OverlayPosition,
  OverlaySize,
  TenantOverlays,
} from '@arenalive/shared';
import {
  adminAssetPath,
  defaultOverlay,
  isVideoMime,
  LAYOUT_DEVICES,
  OVERLAY_KINDS,
  OVERLAY_MAX_PRIORITY,
  OVERLAY_MAX_SECONDS,
  OVERLAY_MIN_PRIORITY,
  OVERLAY_MIN_SECONDS,
  OVERLAY_PLACEHOLDERS,
  OVERLAY_POSITIONS,
  OVERLAY_SIZES,
  OVERLAY_TEXT_MAX,
  OverlayBackgroundSchema,
  OverlayTextSchema,
  OVERLAY_VIDEO_FITS,
  OVERLAY_VIDEO_DURATIONS,
  OVERLAY_VIDEO_MAX_SECONDS,
  OVERLAY_VIDEO_TEAMS,
} from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import { useId, useState } from 'react';
import { Button } from '../../../components/ui.tsx';
import { overlayText, sampleEvent } from '../../../lib/overlay.ts';
import { inputClass } from '../forms.tsx';
import { assetOptionText } from '../imageUpload.ts';
import { LibraryLink } from './ColorsSection.tsx';
import { selectClass } from './blockEditors.tsx';
import type { StudioModel } from './model.ts';
import {
  activeOverlayModel,
  ALL_DEVICES_TEXT,
  applyOverlayModel,
  DEVICE_LABELS,
  OVERLAY_LABELS,
  OVERLAY_MODEL_LABELS,
  overlayWhere,
  PLACEHOLDER_LABELS,
  POSITION_LABELS,
  SIZE_LABELS,
} from './model.ts';
import { Advanced, ModelPicker, Setting, SettingsCard, TabList, Toggle } from './StudioUi.tsx';

export type OverlaysTab = 'eventi' | 'aspetto';

/** Value of the «Come le impostazioni generali» option of the own position / size of an overlay. */
const GENERAL = '';

const isPosition = (v: string): v is OverlayPosition => (OVERLAY_POSITIONS as readonly string[]).includes(v);
const isSize = (v: string): v is OverlaySize => (OVERLAY_SIZES as readonly string[]).includes(v);

/** The overlay with its own position (or, for GENERAL / unknown values, without it: the general one applies). */
export function withPosition(overlay: Overlay, value: string): Overlay {
  const { position: _old, ...rest } = overlay;
  return isPosition(value) ? { ...rest, position: value } : rest;
}
export function withSize(overlay: Overlay, value: string): Overlay {
  const { size: _old, ...rest } = overlay;
  return isSize(value) ? { ...rest, size: value } : rest;
}

const SECONDS = Array.from(
  { length: OVERLAY_MAX_SECONDS - OVERLAY_MIN_SECONDS + 1 },
  (_, i) => OVERLAY_MIN_SECONDS + i,
);
const PRIORITIES = Array.from(
  { length: OVERLAY_MAX_PRIORITY - OVERLAY_MIN_PRIORITY + 1 },
  (_, i) => OVERLAY_MAX_PRIORITY - i,
);

/** Problem of a text as the server would see it (same shared schema), null when fine. */
export function textProblem(text: string): string | null {
  const parsed = OverlayTextSchema.safeParse(text);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (text.trim() === '') return 'Il testo non può essere vuoto.';
  if (text.trim().length > OVERLAY_TEXT_MAX) return `Al massimo ${OVERLAY_TEXT_MAX} caratteri.`;
  return issue ? `Testo non valido: ${issue.message}.` : 'Testo non valido.';
}

/** Choice of the background of an overlay: none, an image or a video. */
type BackgroundMode = 'none' | OverlayBackgroundKind;
const BACKGROUND_LABELS: Record<BackgroundMode, string> = { none: 'Nessuno', image: 'Immagine', video: 'Video' };

/** The overlay without background. */
export function withoutBackground(overlay: Overlay): Overlay {
  const { background: _old, ...rest } = overlay;
  return rest;
}

/** Labels of the options of a video background. */
export const VIDEO_FIT_LABELS: Record<OverlayVideoFit, string> = {
  center: 'Al centro',
  fullscreen: 'A tutto schermo',
};
export const VIDEO_DURATION_LABELS: Record<OverlayVideoDuration, string> = {
  seconds: 'Secondi impostati',
  video: 'Quanto il video',
};
export const VIDEO_TEAMS_LABELS: Record<OverlayVideoTeams, string> = {
  ours: 'Solo la nostra squadra',
  both: 'Entrambe le squadre',
};

/** Pure: the overlay with the file `assetId` as background of `kind`, keeping the options chosen for the one before. */
export function withBackgroundFile(overlay: Overlay, kind: OverlayBackgroundKind, assetId: string): Overlay {
  const fresh = OverlayBackgroundSchema.parse({ kind, assetId });
  const old = overlay.background;
  return {
    ...overlay,
    background: old ? { ...fresh, audio: old.audio, fit: old.fit, teams: old.teams, duration: old.duration } : fresh,
  };
}

/** Pure: the overlay with some options of its background changed (no background: unchanged). */
export function withBackgroundOptions(
  overlay: Overlay,
  options: Partial<Pick<OverlayBackground, 'audio' | 'fit' | 'teams' | 'duration'>>,
): Overlay {
  return overlay.background ? { ...overlay, background: { ...overlay.background, ...options } } : overlay;
}

const isFit = (v: string): v is OverlayVideoFit => (OVERLAY_VIDEO_FITS as readonly string[]).includes(v);
const isDuration = (v: string): v is OverlayVideoDuration => (OVERLAY_VIDEO_DURATIONS as readonly string[]).includes(v);
const isTeams = (v: string): v is OverlayVideoTeams => (OVERLAY_VIDEO_TEAMS as readonly string[]).includes(v);

/** Pure: the files of the client for the backgrounds of `mode` (images or videos uploaded for the overlays). */
export function backgroundFiles(assets: readonly AssetSummary[], mode: OverlayBackgroundKind): AssetSummary[] {
  return assets.filter((a) => a.kind === 'overlay' && isVideoMime(a.mime) === (mode === 'video'));
}

/**
 * «Sfondo»: none, an image or a video behind the text, chosen among the files uploaded for the overlays or uploaded
 * here (an image as the logos, a video MP4 or WebM up to 15 MB: type and size checked before sending).
 */
function BackgroundSetting({
  label,
  overlay,
  assets,
  onChange,
}: {
  label: string;
  overlay: Overlay;
  assets: AssetListResponse;
  onChange: (overlay: Overlay) => void;
}) {
  const [mode, setMode] = useState<BackgroundMode>(overlay.background?.kind ?? 'none');
  const name = useId();
  const files = mode === 'none' ? [] : backgroundFiles(assets.assets, mode);
  const chosen = overlay.background && overlay.background.kind === mode ? overlay.background.assetId : '';
  const choose = (next: BackgroundMode): void => {
    setMode(next);
    if (overlay.background && overlay.background.kind !== next) onChange(withoutBackground(overlay));
  };
  return (
    <div className="space-y-2 text-sm text-text">
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="pb-1">Sfondo</legend>
        {(['none', 'image', 'video'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1.5">
            <input type="radio" name={name} checked={mode === m} onChange={() => choose(m)} />
            {BACKGROUND_LABELS[m]}
          </label>
        ))}
      </fieldset>
      {mode !== 'none' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              aria-label={`${mode === 'video' ? 'Video' : 'Immagine'} dello sfondo: ${label}`}
              value={chosen}
              onChange={(e) =>
                onChange(
                  e.target.value ? withBackgroundFile(overlay, mode, e.target.value) : withoutBackground(overlay),
                )
              }
            >
              <option value="">{files.length === 0 ? 'Nessun file caricato' : 'Scegli…'}</option>
              {files.map((a) => (
                <option key={a.id} value={a.id}>
                  {assetOptionText(a)}
                </option>
              ))}
            </select>
            <LibraryLink />
          </div>
          {chosen &&
            (mode === 'video' ? (
              <video
                // A new element for every file: the same <video> with another src may keep showing the first one.
                key={chosen}
                src={adminAssetPath(chosen)}
                muted
                playsInline
                controls
                preload="metadata"
                aria-label={`Anteprima del video dello sfondo: ${label}`}
                className="max-h-32 rounded-card border border-border"
              />
            ) : (
              <img
                key={chosen}
                src={adminAssetPath(chosen)}
                alt={`Anteprima dell’immagine dello sfondo: ${label}`}
                className="max-h-32 rounded-card border border-border object-contain"
              />
            ))}
          {mode === 'video' && chosen && overlay.background?.kind === 'video' && (
            <VideoOptions label={label} background={overlay.background} overlay={overlay} onChange={onChange} />
          )}
          <p className="text-xs text-muted">
            {mode === 'video'
              ? 'Video della libreria: parte subito e gira per i secondi dell’avviso su TV e tablet. Con «Audio» acceso si sente anche il sonoro, se il browser lo permette (altrimenti parte senza audio). Con «Solo la nostra squadra» gli avvisi della squadra avversaria escono senza video, in casa e in trasferta (la nostra squadra è quella scelta in «Colori e loghi» › «Squadra»: se non la si riconosce nella partita, il video compare per tutte e due). Sul telefono il video non si mostra, e nemmeno a chi ha chiesto meno animazioni: lì l’avviso esce con il solo testo.'
              : 'Immagine della libreria: sta dietro al testo, con una velatura del colore della squadra.'}{' '}
            Il file si scarica all’apertura della pagina (sul telefono solo le immagini, mai il video): se non è ancora
            pronto l’avviso esce con il solo testo.
          </p>
        </div>
      )}
    </div>
  );
}

/** Options of a video background: sound, where it plays, for which team. */
function VideoOptions({
  label,
  background,
  overlay,
  onChange,
}: {
  label: string;
  background: OverlayBackground;
  overlay: Overlay;
  onChange: (overlay: Overlay) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={background.audio}
          aria-label={`Audio del video: ${label}`}
          onChange={(e) => onChange(withBackgroundOptions(overlay, { audio: e.target.checked }))}
        />
        Audio
      </label>
      <label className="flex items-center gap-1.5">
        Posizione del video
        <select
          className={selectClass}
          aria-label={`Posizione del video: ${label}`}
          value={background.fit}
          onChange={(e) => {
            if (isFit(e.target.value)) onChange(withBackgroundOptions(overlay, { fit: e.target.value }));
          }}
        >
          {OVERLAY_VIDEO_FITS.map((f) => (
            <option key={f} value={f}>
              {VIDEO_FIT_LABELS[f]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        Video per
        <select
          className={selectClass}
          aria-label={`Video per: ${label}`}
          value={background.teams}
          onChange={(e) => {
            if (isTeams(e.target.value)) onChange(withBackgroundOptions(overlay, { teams: e.target.value }));
          }}
        >
          {OVERLAY_VIDEO_TEAMS.map((t) => (
            <option key={t} value={t}>
              {VIDEO_TEAMS_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        Durata
        <select
          className={selectClass}
          aria-label={`Durata: ${label}`}
          value={background.duration}
          onChange={(e) => {
            if (isDuration(e.target.value)) onChange(withBackgroundOptions(overlay, { duration: e.target.value }));
          }}
        >
          {OVERLAY_VIDEO_DURATIONS.map((d) => (
            <option key={d} value={d}>
              {VIDEO_DURATION_LABELS[d]}
            </option>
          ))}
        </select>
      </label>
      {background.duration === 'video' && (
        <p className="w-full text-xs text-muted">
          L’avviso resta finché il video finisce (al massimo {OVERLAY_VIDEO_MAX_SECONDS} secondi). Se la durata non si
          legge, o il video non si vede (telefono, movimento ridotto), dura i secondi impostati ({overlay.seconds}).
        </p>
      )}
    </div>
  );
}

/** Id of the setting of an overlay (target of a click on the overlay in the preview). */
export const overlaySettingId = (kind: OverlayKind): string => `overlay-${kind}`;

/** Settings of the overlay being edited: text, duration, devices, own position and size; priority under «Avanzate». */
function OverlayDetail({
  kind,
  config,
  overlay,
  state,
  assets,
  onChange,
  onTry,
  onReset,
}: {
  kind: OverlayKind;
  config: TenantOverlays;
  overlay: Overlay;
  state: MatchState | null;
  assets: AssetListResponse;
  onChange: (overlay: Overlay) => void;
  onTry: () => void;
  onReset: () => void;
}) {
  const id = useId();
  const { label, hint } = OVERLAY_LABELS[kind];
  const problem = textProblem(overlay.text);
  const result = state && !problem ? overlayText(sampleEvent(kind, state), state, overlay) : null;
  const where = overlayWhere(config, overlay);
  return (
    <div className="space-y-1 border-t border-border pt-2" data-overlay-detail={kind}>
      <p className="text-xs text-muted">{hint}</p>
      <Setting id={`${overlaySettingId(kind)}-text`} where={where} scene="overlay" targets={['overlay']}>
        <label className="block space-y-1">
          <span className="text-sm text-text">Testo</span>
          <input
            className={inputClass}
            value={overlay.text}
            maxLength={OVERLAY_TEXT_MAX + 20}
            aria-invalid={problem !== null}
            aria-describedby={`${id}-esito`}
            onChange={(e) => onChange({ ...overlay, text: e.target.value })}
          />
        </label>
        <p id={`${id}-esito`} className={`text-xs ${problem ? 'text-danger' : 'text-muted'}`}>
          {problem ?? (result !== null ? `Risultato: ${result}` : '')}
        </p>
        <p className="text-xs text-muted">
          Segnaposto:{' '}
          {OVERLAY_PLACEHOLDERS.map((p, i) => (
            <span key={p}>
              {i > 0 && ', '}
              <code className="text-text">{`{${p}}`}</code> {PLACEHOLDER_LABELS[p]}
            </span>
          ))}
          .
        </p>
      </Setting>
      <Setting id={`${overlaySettingId(kind)}-show`} where={where} scene="overlay" targets={['overlay']}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-text">
          <label className="flex items-center gap-2">
            Secondi
            <select
              className={selectClass}
              value={overlay.seconds}
              onChange={(e) => onChange({ ...overlay, seconds: Number(e.target.value) })}
            >
              {SECONDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">Dispositivi: {label}</legend>
            {LAYOUT_DEVICES.map((device) => (
              <label key={device} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={overlay.devices[device]}
                  onChange={(e) =>
                    onChange({ ...overlay, devices: { ...overlay.devices, [device]: e.target.checked } })
                  }
                />
                {DEVICE_LABELS[device]}
              </label>
            ))}
          </fieldset>
        </div>
      </Setting>
      <Setting id={`${overlaySettingId(kind)}-place`} where={where} scene="overlay" targets={['overlay']}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-text">
          <label className="flex items-center gap-2">
            Posizione
            <select
              className={selectClass}
              aria-label={`Posizione: ${label}`}
              value={overlay.position ?? GENERAL}
              onChange={(e) => onChange(withPosition(overlay, e.target.value))}
            >
              <option value={GENERAL}>Come tutti gli avvisi</option>
              {OVERLAY_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {POSITION_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Dimensione
            <select
              className={selectClass}
              aria-label={`Dimensione: ${label}`}
              value={overlay.size ?? GENERAL}
              onChange={(e) => onChange(withSize(overlay, e.target.value))}
            >
              <option value={GENERAL}>Come tutti gli avvisi</option>
              {OVERLAY_SIZES.map((z) => (
                <option key={z} value={z}>
                  {SIZE_LABELS[z]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Setting>
      <Setting id={`${overlaySettingId(kind)}-background`} where={where} scene="overlay" targets={['overlay']}>
        <BackgroundSetting label={label} overlay={overlay} assets={assets} onChange={onChange} />
      </Setting>
      <div className="flex flex-wrap items-center gap-2 py-1">
        <Button variant="primary" disabled={problem !== null || !state} onClick={onTry} aria-label={`Prova ${label}`}>
          Prova
        </Button>
        <span className="text-xs text-muted">Lo mostra nell’anteprima per i suoi secondi, con l’animazione.</span>
      </div>
      <Advanced>
        <Setting id={`${overlaySettingId(kind)}-priority`} where={where} scene="overlay" targets={['overlay']}>
          <label className="flex items-center gap-2 text-sm text-text">
            Priorità
            <select
              className={selectClass}
              value={overlay.priority}
              onChange={(e) => onChange({ ...overlay, priority: Number(e.target.value) })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">Con più avvisi insieme si mostra prima quello con la priorità più alta.</p>
        </Setting>
        <Button variant="ghost" onClick={onReset} aria-label={`Ripristina predefinito ${label}`}>
          Ripristina predefinito
        </Button>
      </Advanced>
    </div>
  );
}

/**
 * Section «Avvisi» (the old page «Avvisi»): ready-made models, the events with their switch (the one being edited
 * open, with text, placeholders, duration, devices, own position and size, «Prova»), the position and size of every
 * overlay.
 */
export function OverlaysSection({
  draft,
  onChange,
  kind,
  onKind,
  tab,
  onTab,
  state,
  onTry,
  assets,
}: {
  draft: TenantOverlays;
  onChange: (change: (config: TenantOverlays) => TenantOverlays) => void;
  /** Overlay being edited (shown by the scene «Avviso»). */
  kind: OverlayKind;
  onKind: (kind: OverlayKind) => void;
  tab: OverlaysTab;
  onTab: (tab: OverlaysTab) => void;
  state: MatchState | null;
  onTry: (kind: OverlayKind) => void;
  /** Files of the client: the backgrounds are chosen among the ones uploaded for the overlays. */
  assets: AssetListResponse;
}) {
  const [announce, setAnnounce] = useState('');
  const set = (k: OverlayKind, overlay: Overlay): void => onChange((d) => ({ ...d, [k]: overlay }));
  const panelId = 'pannello-avvisi';
  return (
    <div className="space-y-3">
      <ModelPicker
        labels={OVERLAY_MODEL_LABELS}
        active={activeOverlayModel(draft)}
        onApply={(m: StudioModel) => {
          onChange((d) => applyOverlayModel(d, m));
          setAnnounce(`Modello «${OVERLAY_MODEL_LABELS[m].label}» applicato agli avvisi.`);
        }}
      />
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <TabList<OverlaysTab>
        label="Avvisi"
        tabs={[
          { value: 'eventi', label: 'Quali avvisi' },
          { value: 'aspetto', label: 'Posizione e dimensione' },
        ]}
        value={tab}
        onChange={onTab}
        idPrefix="scheda-avvisi"
        panelId={panelId}
        problem={(t) => t === 'eventi' && OVERLAY_KINDS.some((k) => textProblem(draft[k].text) !== null)}
      />
      <div id={panelId} role="tabpanel" aria-labelledby={`scheda-avvisi-${tab}`} className="space-y-3">
        {tab === 'eventi' ? (
          <SettingsCard title="Eventi">
            <p className="text-xs text-muted">
              Messaggi brevi sopra la pagina pubblica quando succede qualcosa in partita. Solo testo semplice: niente
              HTML. «Modifica» apre testo, durata, dispositivi e posizione.
            </p>
            <ul aria-label="Eventi" className="space-y-2">
              {OVERLAY_KINDS.map((k) => {
                const overlay = draft[k];
                const open = k === kind;
                const { label } = OVERLAY_LABELS[k];
                const invalid = textProblem(overlay.text) !== null;
                return (
                  <li
                    key={k}
                    data-overlay-kind={k}
                    className={`rounded-card border bg-surface-2 px-2 ${invalid ? 'border-danger' : open ? 'border-focus' : 'border-border'}`}
                  >
                    <Setting
                      id={overlaySettingId(k)}
                      where={overlayWhere(draft, overlay)}
                      scene="overlay"
                      targets={open ? ['overlay'] : []}
                      className="mx-0"
                    >
                      <div className="flex items-center gap-2">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-text">
                          <Toggle checked={overlay.enabled} onChange={(enabled) => set(k, { ...overlay, enabled })} />
                          {label}
                        </label>
                        <Button
                          variant="ghost"
                          aria-expanded={open}
                          aria-label={`Modifica ${label}`}
                          onClick={() => onKind(k)}
                        >
                          {open ? 'In modifica' : 'Modifica'}
                        </Button>
                      </div>
                    </Setting>
                    {open && (
                      <OverlayDetail
                        kind={k}
                        config={draft}
                        overlay={overlay}
                        state={state}
                        assets={assets}
                        onChange={(o) => set(k, o)}
                        onTry={() => onTry(k)}
                        onReset={() => {
                          set(k, defaultOverlay(k));
                          setAnnounce(`Impostazioni predefinite per ${label}.`);
                        }}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </SettingsCard>
        ) : (
          <SettingsCard title="Posizione e dimensione di tutti gli avvisi">
            <Setting
              id="overlay-general"
              where={`${ALL_DEVICES_TEXT}, sopra la partita (ogni avviso può avere la sua)`}
              scene="overlay"
              targets={['overlay']}
            >
              <div className="flex flex-wrap items-center gap-3 text-sm text-text">
                <label className="flex items-center gap-2">
                  Posizione
                  <select
                    className={selectClass}
                    value={draft.position}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (isPosition(value)) onChange((d) => ({ ...d, position: value }));
                    }}
                  >
                    {OVERLAY_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  Dimensione
                  <select
                    className={selectClass}
                    value={draft.size}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (isSize(value)) onChange((d) => ({ ...d, size: value }));
                    }}
                  >
                    {OVERLAY_SIZES.map((z) => (
                      <option key={z} value={z}>
                        {SIZE_LABELS[z]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-muted">
                Valgono per tutti gli avvisi; ogni avviso può avere la sua. Al centro l’avviso non blocca i tocchi sulla
                pagina; in alto sta sotto il tabellone, in basso sopra il banner delle pause.
              </p>
            </Setting>
          </SettingsCard>
        )}
      </div>
    </div>
  );
}
