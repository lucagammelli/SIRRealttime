import type {
  AssetListResponse,
  Intermission as PauseConfig,
  IntermissionKind,
  IntermissionMode,
  IntermissionSlide,
  LayoutBlock,
  LayoutDevice,
  MilestoneIntermission,
  SetBreakSet,
  SlideType,
  TenantIntermissions,
} from '@sir/shared';
import {
  AssetListResponseSchema,
  BrandingResponseSchema,
  INTERMISSION_MAX_DELAY_SECONDS,
  INTERMISSION_MAX_SLIDES,
  IntermissionSlideSchema,
  IntermissionsResponseSchema,
  LAYOUT_DEVICES,
  MILESTONE_MAX_EVERY,
  MILESTONE_MAX_STOP_BEFORE_END,
  MILESTONE_MIN_EVERY,
  MILESTONE_MIN_STOP_BEFORE_END,
  publicAssetPath,
  SET_BREAK_SETS,
  SLIDE_TYPES,
  SPONSOR_MAX_IMAGES,
} from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import { setTarget } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockBrand } from '../../blocks/env.ts';
import { SLIDE_LABELS } from '../../blocks/IntermissionSlides.tsx';
import { loadSampleMatch } from '../../blocks/sampleMatch.ts';
import { Intermission } from '../../components/Intermission.tsx';
import { Button, Card, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { initBranding } from '../../lib/branding.ts';
import { previewState } from '../../lib/intermission.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { socketUrl, useLiveSocket } from '../../lib/useLiveSocket.ts';
import { useApiError } from './auth.tsx';
import { inputClass } from './forms.tsx';
import type { PauseTarget } from './intermissionEditor.ts';
import {
  addSlide,
  canAddSlide,
  moveSlide,
  pauseAt,
  pauseProblems,
  removeSlide,
  resetPause,
  setOwnPause,
  targetSet,
  updateSlide,
  withMilestoneRule,
  withPause,
} from './intermissionEditor.ts';
import type { StatItem } from './StatOptionsFields.tsx';
import { StatOptionsFields, withStatOptions } from './StatOptionsFields.tsx';
import {
  blockBrandOf,
  BlockOptionsEditor,
  DEVICE_LABELS,
  DevicePreview,
  IMAGE_TOO_LARGE,
  previewPageUrl,
  selectClass,
  SPONSOR_SECONDS,
  uploadSponsorImage,
} from './LayoutPage.tsx';

const KIND_LABELS: Record<IntermissionKind, string> = {
  timeout: 'Time-out',
  setBreak: 'Fine set',
  matchEnd: 'Fine partita',
  milestone: 'Ogni N punti',
};
const KIND_HINTS: Record<IntermissionKind, string> = {
  timeout: 'Dal time-out alla prima azione dopo: di solito una banda compatta con gli sponsor.',
  setBreak: 'Dalla fine del set alla prima azione del set successivo.',
  matchEnd: 'Dalla fine dell’ultimo set; resta finché lo spettatore torna alla partita.',
  milestone:
    'Durante il set, ogni N punti giocati (somma dei due punteggi): mostra le sue diapositive una volta e si chiude da sola. Mai nel finale del set, mai sopra un time-out o la fine del set.',
};
/** What «set» means for the statistics slides of each pause. */
const SET_LABELS: Record<IntermissionKind, string> = {
  timeout: 'Il set in corso',
  setBreak: 'Il set appena chiuso',
  matchEnd: 'L’ultimo set',
  milestone: 'Il set in corso',
};
const MODE_LABELS: Record<IntermissionMode, string> = { fullscreen: 'Tutto schermo', banner: 'Banda in basso' };
const KINDS: readonly IntermissionKind[] = ['timeout', 'setBreak', 'matchEnd', 'milestone'];

/** A statistics slide as the item of the options editor shared with the blocks. */
function slideAsStat(slide: IntermissionSlide): StatItem | null {
  switch (slide.type) {
    case 'setScorers':
    case 'aces':
    case 'blocks':
    case 'attack':
    case 'roleDuel':
    case 'teamDuel':
      return slide;
    default:
      return null;
  }
}

/** Options of a slide as the block of the same type, for the options editor of the blocks (sponsor, message, ...). */
function slideAsBlock(slide: IntermissionSlide): LayoutBlock | null {
  const base = { id: slide.id, width: 12, visible: true, collapsed: false };
  switch (slide.type) {
    case 'sponsor':
      return { ...base, type: 'sponsor', options: slide.options };
    case 'message':
      return { ...base, type: 'message', options: slide.options };
    case 'qr':
      return { ...base, type: 'qr', options: slide.options };
    case 'logo':
      return { ...base, type: 'logo', options: slide.options };
    default:
      return null;
  }
}

/** The options of the block back on the slide (same type). */
function withBlockOptions(slide: IntermissionSlide, block: LayoutBlock): IntermissionSlide {
  if (slide.type === 'sponsor' && block.type === 'sponsor') return { ...slide, options: block.options };
  if (slide.type === 'message' && block.type === 'message') return { ...slide, options: block.options };
  if (slide.type === 'qr' && block.type === 'qr') return { ...slide, options: block.options };
  if (slide.type === 'logo' && block.type === 'logo') return { ...slide, options: block.options };
  return slide;
}

/** Durations offered for a slide: the list of the sponsor blocks, with the value saved when it is not in it. */
const secondsChoices = (current: number): number[] => [...new Set([...SPONSOR_SECONDS, current])].sort((a, b) => a - b);

export function TabList<T extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix,
  panelId,
  problem,
}: {
  label: string;
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  idPrefix: string;
  panelId: string;
  problem?: (value: T) => boolean;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          id={`${idPrefix}-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={panelId}
          onClick={() => onChange(t.value)}
          className={`rounded-card px-3 py-1.5 text-sm font-medium ${
            value === t.value ? 'bg-nav-active text-on-nav-active' : 'text-muted hover:text-text'
          } ${problem?.(t.value) ? 'underline decoration-danger' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** One slide of the list: up/down, name, duration, options, removal. */
function SlideRow({
  slide,
  index,
  count,
  invalid,
  children,
  onChange,
  onMove,
  onRemove,
}: {
  slide: IntermissionSlide;
  index: number;
  count: number;
  invalid: boolean;
  children: ReactNode;
  onChange: (slide: IntermissionSlide) => void;
  onMove: (to: number, direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const { label, description } = SLIDE_LABELS[slide.type];
  return (
    <li
      data-slide-id={slide.id}
      className={`space-y-2 rounded-card border bg-surface-2 p-3 ${invalid ? 'border-danger' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text">
            {index + 1}. {label}
          </span>
          <span className="block text-xs text-muted">{description}</span>
        </span>
        <Button
          variant="ghost"
          aria-label={`Sposta su ${label}`}
          data-move={`${slide.id}-up`}
          disabled={index === 0}
          onClick={() => onMove(index - 1, 'up')}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          aria-label={`Sposta giù ${label}`}
          data-move={`${slide.id}-down`}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1, 'down')}
        >
          ↓
        </Button>
        <Button variant="ghost" aria-label={`Rimuovi ${label}`} onClick={onRemove}>
          Rimuovi
        </Button>
      </div>
      <label className="flex items-center gap-2 text-sm text-text">
        Secondi sullo schermo
        <select
          className={selectClass}
          aria-label={`Secondi sullo schermo: ${label}`}
          value={slide.seconds}
          onChange={(e) => onChange({ ...slide, seconds: Number(e.target.value) })}
        >
          {secondsChoices(slide.seconds).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      {children}
      {invalid && <p className="text-xs text-danger">Controlla le opzioni di questa diapositiva (testo vuoto?).</p>}
    </li>
  );
}

/** Settings of one pause: on/off, mode for every device, delay, slides. */
function PauseEditor({
  pause,
  kind,
  assets,
  uploading,
  onChange,
  onUpload,
  onAnnounce,
}: {
  pause: PauseConfig;
  kind: IntermissionKind;
  assets: AssetListResponse;
  uploading: string | null;
  onChange: (change: (pause: PauseConfig) => PauseConfig) => void;
  onUpload: (file: File, slideId: string) => void;
  onAnnounce: (text: string) => void;
}) {
  const [addType, setAddType] = useState<SlideType>('sponsor');
  const [focusMove, setFocusMove] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // After a move with the keyboard the focus stays on the button just used (or the other one of the slide).
  useEffect(() => {
    if (!focusMove) return;
    const id = focusMove.replace(/-(up|down)$/, '');
    const used = list.current?.querySelector<HTMLButtonElement>(`[data-move="${focusMove}"]:not(:disabled)`);
    const other = list.current?.querySelector<HTMLButtonElement>(`[data-move^="${id}-"]:not(:disabled)`);
    (used ?? other)?.focus();
    setFocusMove(null);
  }, [focusMove, pause]);

  const slides = pause.slides;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium text-text">
        <input
          type="checkbox"
          role="switch"
          checked={pause.enabled}
          onChange={(e) => onChange((p) => ({ ...p, enabled: e.target.checked }))}
        />
        Pausa attiva
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-text">Come si mostra</legend>
        <div className="flex flex-wrap gap-3">
          {LAYOUT_DEVICES.map((device) => (
            <label key={device} className="flex items-center gap-2 text-sm text-text">
              {DEVICE_LABELS[device]}
              <select
                className={selectClass}
                aria-label={`Modo su ${DEVICE_LABELS[device]}`}
                value={pause.modes[device]}
                onChange={(e) => {
                  const mode: IntermissionMode = e.target.value === 'banner' ? 'banner' : 'fullscreen';
                  onChange((p) => ({ ...p, modes: { ...p.modes, [device]: mode } }));
                }}
              >
                {(Object.keys(MODE_LABELS) as IntermissionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-wrap items-center gap-2 text-sm text-text">
        Ritardo prima della pausa (secondi)
        <input
          type="number"
          className={`${inputClass} w-24`}
          min={0}
          max={INTERMISSION_MAX_DELAY_SECONDS}
          step={1}
          value={pause.delaySeconds}
          onChange={(e) => {
            const n = Math.round(Number(e.target.value));
            const delaySeconds = Number.isFinite(n) ? Math.max(0, Math.min(INTERMISSION_MAX_DELAY_SECONDS, n)) : 0;
            onChange((p) => ({ ...p, delaySeconds }));
          }}
        />
        <span className="text-xs text-muted">
          {kind === 'setBreak' ? 'Il tabellone mostra prima la fine del set.' : 'Da 0 a 60.'}{' '}
          {kind === 'milestone'
            ? 'La pausa si chiude da sola dopo le sue diapositive.'
            : 'La pausa si chiude da sola alla ripresa del gioco.'}
        </span>
      </label>
      {slides.length === 0 ? (
        <p className="text-sm text-muted">
          Nessuna diapositiva: {pause.enabled ? 'aggiungine almeno una qui sotto.' : 'la pausa è disattivata.'}
        </p>
      ) : (
        <ol ref={list} aria-label={`Diapositive (${KIND_LABELS[kind]})`} className="space-y-2">
          {slides.map((slide, index) => {
            const block = slideAsBlock(slide);
            const stat = slideAsStat(slide);
            return (
              <SlideRow
                key={slide.id}
                slide={slide}
                index={index}
                count={slides.length}
                invalid={!IntermissionSlideSchema.safeParse(slide).success}
                onChange={(next) => onChange((p) => updateSlide(p, slide.id, () => next))}
                onMove={(to, direction) => {
                  const target = Math.max(0, Math.min(slides.length - 1, to));
                  onChange((p) => moveSlide(p, index, target));
                  onAnnounce(`${SLIDE_LABELS[slide.type].label} in posizione ${target + 1} di ${slides.length}.`);
                  setFocusMove(`${slide.id}-${direction}`);
                }}
                onRemove={() => {
                  onChange((p) => removeSlide(p, slide.id));
                  onAnnounce(`${SLIDE_LABELS[slide.type].label} rimossa.`);
                }}
              >
                {stat && (
                  <StatOptionsFields
                    item={stat}
                    name={SLIDE_LABELS[slide.type].label}
                    setLabel={SET_LABELS[kind]}
                    onChange={(next) => onChange((p) => updateSlide(p, slide.id, (s) => withStatOptions(s, next)))}
                  />
                )}
                {block && (
                  <BlockOptionsEditor
                    block={block}
                    assets={assets}
                    uploading={uploading === slide.id}
                    onUpload={(file) => onUpload(file, slide.id)}
                    onChange={(next) => onChange((p) => updateSlide(p, slide.id, (s) => withBlockOptions(s, next)))}
                  />
                )}
              </SlideRow>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-text">
          Tipo di diapositiva
          <select className={selectClass} value={addType} onChange={(e) => setAddType(e.target.value as SlideType)}>
            {SLIDE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SLIDE_LABELS[t].label}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={!canAddSlide(pause)}
          onClick={() => {
            onChange((p) => addSlide(p, addType));
            onAnnounce(`${SLIDE_LABELS[addType].label} aggiunta in fondo.`);
          }}
        >
          Aggiungi diapositiva
        </Button>
        <span className="text-xs text-muted">
          {slides.length} di al massimo {INTERMISSION_MAX_SLIDES} diapositive.
        </span>
      </div>
    </div>
  );
}

/** Whole number within limits from a number field (empty or wrong: the lowest). */
const clampInt = (text: string, min: number, max: number): number => {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
};

/** Rule of the «ogni N punti»: every how many points, not in the last K points of the set. */
function MilestoneRule({
  pause,
  onChange,
}: {
  pause: MilestoneIntermission;
  onChange: (rule: Partial<Pick<MilestoneIntermission, 'every' | 'stopBeforeEnd'>>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-text">
      <label className="flex items-center gap-2">
        Ogni quanti punti
        <input
          type="number"
          className={`${inputClass} w-20`}
          min={MILESTONE_MIN_EVERY}
          max={MILESTONE_MAX_EVERY}
          step={1}
          value={pause.every}
          onChange={(e) => onChange({ every: clampInt(e.target.value, MILESTONE_MIN_EVERY, MILESTONE_MAX_EVERY) })}
        />
      </label>
      <label className="flex items-center gap-2">
        Non negli ultimi punti del set
        <input
          type="number"
          className={`${inputClass} w-20`}
          min={MILESTONE_MIN_STOP_BEFORE_END}
          max={MILESTONE_MAX_STOP_BEFORE_END}
          step={1}
          value={pause.stopBeforeEnd}
          onChange={(e) =>
            onChange({
              stopBeforeEnd: clampInt(e.target.value, MILESTONE_MIN_STOP_BEFORE_END, MILESTONE_MAX_STOP_BEFORE_END),
            })
          }
        />
      </label>
      <p className="w-full text-xs text-muted">
        Con {pause.every}: dopo {pause.every}, {pause.every * 2}, {pause.every * 3} punti giocati nel set (somma dei due
        punteggi). Mai negli ultimi {pause.stopBeforeEnd} punti: niente quando una squadra arriva a{' '}
        {setTarget(1) - pause.stopBeforeEnd} punti (
        {setTarget(5) - pause.stopBeforeEnd > 0
          ? `${setTarget(5) - pause.stopBeforeEnd} al tie-break`
          : 'mai al tie-break'}
        ). N da {MILESTONE_MIN_EVERY} a {MILESTONE_MAX_EVERY}.
      </p>
    </div>
  );
}

type SetTab = 'all' | SetBreakSet;

/** Editor of the pauses of the public page, with the preview of each one. */
function IntermissionsEditor({
  tenantName,
  saved,
  assets,
  look,
  sponsorLogo,
  onAssetsChanged,
}: {
  tenantName: string;
  saved: TenantIntermissions;
  assets: AssetListResponse;
  look: BlockBrand;
  sponsorLogo: string | null;
  onAssetsChanged: () => void;
}) {
  const errorMessage = useApiError();
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [kind, setKind] = useState<IntermissionKind>('setBreak');
  const [setTab, setSetTab] = useState<SetTab>('all');
  const [device, setDevice] = useState<LayoutDevice>('tv');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const target: PauseTarget = kind === 'setBreak' && setTab !== 'all' ? `setBreak-${setTab}` : kind;
  const ownSet = targetSet(target);
  const pause = pauseAt(draft, target);
  const effective = pause ?? draft.setBreak;
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const problems = useMemo(() => pauseProblems(draft), [draft]);
  const invalid = problems.size > 0;

  // The browser asks before leaving the page with changes not saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const live = useLiveSocket(socketUrl('/ws/admin'));
  const liveState = live.data?.kind === 'state' ? live.data.state : null;
  const [sample, setSample] = useState<MatchState | null>(null);
  useEffect(() => {
    if (liveState || sample) return;
    let alive = true;
    void loadSampleMatch().then((s) => {
      if (alive) setSample(s);
    });
    return () => {
      alive = false;
    };
  }, [liveState, sample]);
  const source = liveState ?? sample;
  const shown = useMemo(
    () => (source ? previewState(source, kind, ownSet ? Number(ownSet) : undefined) : null),
    [source, kind, ownSet],
  );

  const change = (update: (p: PauseConfig) => PauseConfig): void => {
    setDraft((d) => {
      const current = pauseAt(d, target);
      return current ? withPause(d, target, update(current)) : d;
    });
  };

  const upload = async (file: File, slideId: string): Promise<void> => {
    setError(null);
    setDone(null);
    setUploading(slideId);
    try {
      const asset = await uploadSponsorImage(file);
      if (!asset) {
        setError(IMAGE_TOO_LARGE);
        return;
      }
      change((p) =>
        updateSlide(p, slideId, (s) =>
          s.type === 'sponsor' && !s.options.images.includes(asset.id) && s.options.images.length < SPONSOR_MAX_IMAGES
            ? { ...s, options: { ...s.options, images: [...s.options.images, asset.id] } }
            : s,
        ),
      );
      onAssetsChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  };

  const save = async (): Promise<void> => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, {
        method: 'PUT',
        body: draft,
      });
      setBase(res.intermissions);
      setDraft(res.intermissions);
      setDone('Pause salvate: valgono da subito per tutti gli spettatori.');
      void initBranding({ fresh: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const kindPanel = 'pannello-pausa';
  const setPanel = 'pannello-set';
  const kindProblem = (k: IntermissionKind): boolean =>
    problems.has(k) || (k === 'setBreak' && SET_BREAK_SETS.some((s) => problems.has(`setBreak-${s}`)));
  const title = ownSet ? `${KIND_LABELS.setBreak}, ${ownSet}° set` : KIND_LABELS[kind];

  const editor = pause ? (
    <PauseEditor
      key={target}
      pause={pause}
      kind={kind}
      assets={assets}
      uploading={uploading}
      onChange={change}
      onUpload={(file, id) => void upload(file, id)}
      onAnnounce={setAnnounce}
    />
  ) : null;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <Card
        title="Pause e sponsor"
        subtitle={`Cliente: ${tenantName}. Cosa vedono gli spettatori durante i time-out, tra un set e l’altro, a fine partita e ogni N punti durante il set.`}
      >
        <div className="space-y-4">
          <TabList
            label="Pausa"
            tabs={KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
            value={kind}
            onChange={setKind}
            idPrefix="scheda-pausa"
            panelId={kindPanel}
            problem={kindProblem}
          />
          <div id={kindPanel} role="tabpanel" aria-labelledby={`scheda-pausa-${kind}`} className="space-y-3">
            <p className="text-xs text-muted">{KIND_HINTS[kind]}</p>
            <p aria-live="polite" className="sr-only">
              {announce}
            </p>
            {kind === 'setBreak' ? (
              <>
                <TabList<SetTab>
                  label="Set"
                  tabs={[
                    { value: 'all', label: 'Tutti i set' },
                    ...SET_BREAK_SETS.map((s) => ({ value: s, label: `${s}° set` })),
                  ]}
                  value={setTab}
                  onChange={setSetTab}
                  idPrefix="scheda-set"
                  panelId={setPanel}
                  problem={(s) => (s === 'all' ? problems.has('setBreak') : problems.has(`setBreak-${s}`))}
                />
                <div id={setPanel} role="tabpanel" aria-labelledby={`scheda-set-${setTab}`} className="space-y-3">
                  {ownSet && (
                    <label className="flex items-center gap-2 text-sm font-medium text-text">
                      <input
                        type="checkbox"
                        checked={pause !== undefined}
                        onChange={(e) => {
                          setDraft((d) => setOwnPause(d, ownSet, e.target.checked));
                          setAnnounce(
                            e.target.checked
                              ? `Pausa propria per il ${ownSet}° set.`
                              : `Il ${ownSet}° set usa la pausa di tutti i set.`,
                          );
                        }}
                      />
                      Pausa propria per la fine del {ownSet}° set
                    </label>
                  )}
                  {ownSet && !pause && (
                    <p className="text-sm text-muted">
                      Alla fine del {ownSet}° set si usa la pausa di «Tutti i set». Attiva la pausa propria per
                      cambiarla solo per questo set.
                    </p>
                  )}
                  {editor}
                </div>
              </>
            ) : kind === 'milestone' ? (
              <>
                <MilestoneRule
                  pause={draft.milestone}
                  onChange={(rule) => setDraft((d) => withMilestoneRule(d, rule))}
                />
                {editor}
              </>
            ) : (
              editor
            )}
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {done && (
            <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
              {done}
            </p>
          )}
          {invalid && (
            <p role="alert" className="text-sm text-danger">
              Alcune pause hanno impostazioni non valide (una pausa attiva senza diapositive o un testo vuoto):
              correggile prima di salvare.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !dirty || invalid} onClick={() => void save()}>
              {busy ? 'Salvataggio…' : 'Salva'}
            </Button>
            <Button
              disabled={busy || !pause}
              title={`Torna alle impostazioni predefinite di «${title}»`}
              onClick={() => {
                setDraft((d) => resetPause(d, target));
                setDone(null);
                setAnnounce(`Impostazioni predefinite per ${title}.`);
              }}
            >
              Ripristina predefinito
            </Button>
            {dirty && (
              <span role="status" className="text-xs text-warn">
                Modifiche non salvate.
              </span>
            )}
          </div>
        </div>
      </Card>
      <Card title="Anteprima" subtitle={`${title}, con le modifiche non ancora salvate.`}>
        <div className="space-y-3">
          <TabList
            label="Dispositivo dell’anteprima"
            tabs={LAYOUT_DEVICES.map((d) => ({ value: d, label: DEVICE_LABELS[d] }))}
            value={device}
            onChange={setDevice}
            idPrefix="anteprima-dispositivo"
            panelId="pannello-anteprima"
          />
          <div id="pannello-anteprima" role="tabpanel" aria-labelledby={`anteprima-dispositivo-${device}`}>
            {!effective.enabled && (
              <p className="mb-2 text-sm text-warn">Pausa disattivata: gli spettatori non la vedono.</p>
            )}
            {shown ? (
              <DevicePreview
                device={device}
                layout={null}
                state={shown}
                look={look}
                source={
                  liveState ? 'Dati della partita live.' : 'Partita d’esempio: nessuna partita live in questo momento.'
                }
              >
                <Intermission
                  key={`${target}-${device}`}
                  state={shown}
                  config={null}
                  device={device}
                  paused={false}
                  look={look}
                  sponsorLogo={sponsorLogo}
                  pageUrl={previewPageUrl()}
                  preview={effective}
                />
              </DevicePreview>
            ) : (
              <Spinner label="Preparazione dell’anteprima…" />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

/** Page «Pause e sponsor» (admin): the pauses of the public match page of the client. */
export function IntermissionsPage() {
  const errorMessage = useApiError();
  const loadPauses = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, { signal }),
    [],
  );
  const loadAssets = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const loadBranding = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/branding', BrandingResponseSchema, { signal }),
    [],
  );
  const pauses = useAsync(loadPauses);
  const assets = useAsync(loadAssets);
  const branding = useAsync(loadBranding);

  useEffect(() => {
    document.title = 'Pause e sponsor · Area riservata';
  }, []);

  const look = useMemo(() => (branding.data ? blockBrandOf(branding.data) : null), [branding.data]);

  for (const part of [pauses, branding]) {
    if (part.error !== null) return <ErrorBox onRetry={part.reload}>{errorMessage(part.error)}</ErrorBox>;
  }
  if (assets.error !== null && !assets.data)
    return <ErrorBox onRetry={assets.reload}>{errorMessage(assets.error)}</ErrorBox>;
  if (!pauses.data || !assets.data || !look || !branding.data) return <Spinner label="Caricamento delle pause…" />;
  const sponsorLogo = branding.data.branding.sponsorLogo;
  return (
    <IntermissionsEditor
      tenantName={pauses.data.tenantName}
      saved={pauses.data.intermissions}
      assets={assets.data}
      look={look}
      sponsorLogo={sponsorLogo ? publicAssetPath(sponsorLogo) : null}
      onAssetsChanged={assets.reload}
    />
  );
}
