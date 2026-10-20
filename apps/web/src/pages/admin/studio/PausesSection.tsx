import type {
  AssetListResponse,
  Sponsor,
  Intermission as PauseConfig,
  IntermissionKind,
  IntermissionMode,
  IntermissionSlide,
  LayoutBlock,
  MilestoneIntermission,
  SetBreakSet,
  SlideType,
  TenantIntermissions,
} from '@sir/shared';
import {
  INTERMISSION_MAX_DELAY_SECONDS,
  INTERMISSION_MAX_SLIDES,
  IntermissionSlideSchema,
  LAYOUT_DEVICES,
  MILESTONE_MAX_EVERY,
  MILESTONE_MAX_STOP_BEFORE_END,
  MILESTONE_MIN_EVERY,
  MILESTONE_MIN_STOP_BEFORE_END,
  SET_BREAK_SETS,
  SLIDE_TYPES,
} from '@sir/shared';
import { setTarget } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { SLIDE_LABELS } from '../../../blocks/IntermissionSlides.tsx';
import { Button } from '../../../components/ui.tsx';
import { inputClass } from '../forms.tsx';
import type { PauseTarget } from '../intermissionEditor.ts';
import {
  addSlide,
  canAddSlide,
  moveSlide,
  pauseAt,
  pauseProblems,
  removeSlide,
  resetPause,
  setOwnPause,
  updateSlide,
  withMilestoneRule,
  withPause,
} from '../intermissionEditor.ts';
import type { StatItem } from '../StatOptionsFields.tsx';
import { StatOptionsFields, withStatOptions } from '../StatOptionsFields.tsx';
import { BlockOptionsEditor, selectClass, SPONSOR_SECONDS } from './blockEditors.tsx';
import type { StudioModel } from './model.ts';
import {
  activePauseModel,
  applyPauseModel,
  DEVICE_LABELS,
  KIND_LABELS,
  MODE_LABELS,
  PAUSE_KINDS,
  PAUSE_MODEL_LABELS,
  pauseWhere,
  slideHasSettings,
} from './model.ts';
import { Advanced, ModelPicker, RemoveButton, Setting, SettingsCard, SwitchRow, TabList, Toggle } from './StudioUi.tsx';

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

export type SetTab = 'all' | SetBreakSet;

/** Pause edited for a kind and a set tab: `setBreak-N` for the own end of set of the set N. */
export const pauseTargetOf = (kind: IntermissionKind, set: SetTab): PauseTarget =>
  kind === 'setBreak' && set !== 'all' ? `setBreak-${set}` : kind;

/** Id of the setting of a slide (target of a click on the slide in the preview). */
export const slideSettingId = (target: PauseTarget, id: string): string => `slide-${target}-${id}`;

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
    case 'nextMatch':
      return { ...base, type: 'nextMatch', options: slide.options };
    case 'standings':
      return { ...base, type: 'standings', options: slide.options };
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
  if (slide.type === 'nextMatch' && block.type === 'nextMatch') return { ...slide, options: block.options };
  if (slide.type === 'standings' && block.type === 'standings') return { ...slide, options: block.options };
  return slide;
}

/** Durations offered for a slide: the list of the sponsor blocks, with the value saved when it is not in it. */
const secondsChoices = (current: number): number[] => [...new Set([...SPONSOR_SECONDS, current])].sort((a, b) => a - b);

/** Whole number within limits from a number field (empty or wrong: the lowest). */
const clampInt = (text: string, min: number, max: number): number => {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
};

/**
 * One slide of the list: on/off, name, up/down and «Rimuovi» (with a confirmation when the slide has options of its
 * own); duration and options under «Opzioni». A slide off stays in the list but is never shown.
 */
function SlideRow({
  slide,
  index,
  count,
  invalid,
  settingId,
  scene,
  children,
  onChange,
  onMove,
  onRemove,
}: {
  slide: IntermissionSlide;
  index: number;
  count: number;
  invalid: boolean;
  settingId: string;
  scene: IntermissionKind;
  children: ReactNode;
  onChange: (slide: IntermissionSlide) => void;
  onMove: (to: number, direction: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const { label, description } = SLIDE_LABELS[slide.type];
  return (
    <li
      data-slide-id={slide.id}
      className={`rounded-card border bg-surface-2 ${invalid ? 'border-danger' : 'border-border'} ${
        slide.enabled ? '' : 'opacity-70'
      }`}
    >
      <Setting
        id={settingId}
        where={
          slide.enabled
            ? `${index + 1}ª diapositiva, ${slide.seconds} secondi sullo schermo`
            : `${index + 1}ª diapositiva, disattivata: non compare`
        }
        scene={scene}
        targets={[`slide:${slide.id}`]}
        className="mx-0 px-2"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-sm font-semibold leading-tight text-text [overflow-wrap:anywhere]">
            {index + 1}. {label}
            {!slide.enabled && <span className="font-normal text-muted"> (disattivata)</span>}
          </span>
          <Toggle
            checked={slide.enabled}
            label={`Attiva: ${label}`}
            title={slide.enabled ? 'Attiva' : 'Disattivata'}
            onChange={(enabled) => onChange({ ...slide, enabled })}
          />
          <Button
            variant="ghost"
            aria-label={`Sposta su ${label}`}
            data-move={`${slide.id}-up`}
            disabled={index === 0}
            onClick={() => onMove(index - 1, 'up')}
            className="px-2"
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            aria-label={`Sposta giù ${label}`}
            data-move={`${slide.id}-down`}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1, 'down')}
            className="px-2"
          >
            ↓
          </Button>
          <RemoveButton name={label} confirm={slideHasSettings(slide)} onRemove={onRemove} />
        </div>
        <details className="text-sm text-text" open={invalid || undefined}>
          <summary className="cursor-pointer text-xs text-muted hover:text-text">Opzioni · {slide.seconds} s</summary>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted">{description}</p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
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
            </div>
            {children}
          </div>
        </details>
        {invalid && <p className="text-xs text-danger">Controlla le opzioni di questa diapositiva (testo vuoto?).</p>}
      </Setting>
    </li>
  );
}

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

/** Settings of one pause: on/off and mode of every device (visible), slides, and under «Avanzate» the delay. */
function PauseEditor({
  pause,
  kind,
  target,
  assets,
  sponsors,
  onChange,
  onAnnounce,
}: {
  pause: PauseConfig;
  kind: IntermissionKind;
  target: PauseTarget;
  assets: AssetListResponse;
  sponsors: readonly Sponsor[];
  onChange: (change: (pause: PauseConfig) => PauseConfig) => void;
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
  const where = pauseWhere(pause, kind);
  return (
    <>
      <SettingsCard title="Quando e come">
        <Setting id="pause-enabled" where={where} scene={kind} targets={['pause']}>
          <SwitchRow
            label="Pausa attiva"
            checked={pause.enabled}
            onChange={(on) => onChange((p) => ({ ...p, enabled: on }))}
          />
        </Setting>
        <Setting id="pause-modes" where={where} scene={kind} targets={['pause']}>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-text">Come si mostra</legend>
            <div className="grid gap-2">
              {LAYOUT_DEVICES.map((device) => (
                <label key={device} className="flex items-center justify-between gap-2 text-sm text-text">
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
        </Setting>
      </SettingsCard>
      <SettingsCard title="Diapositive">
        {slides.length === 0 ? (
          <p className="text-sm text-muted">
            Nessuna diapositiva: {pause.enabled ? 'aggiungine almeno una qui sotto.' : 'la pausa è disattivata.'}
          </p>
        ) : (
          <>
            {pause.enabled && !slides.some((s) => s.enabled) && (
              <p className="text-sm text-muted">Tutte le diapositive sono disattivate: la pausa non compare.</p>
            )}
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
                    settingId={slideSettingId(target, slide.id)}
                    scene={kind}
                    invalid={!IntermissionSlideSchema.safeParse(slide).success}
                    onChange={(next) => onChange((p) => updateSlide(p, slide.id, () => next))}
                    onMove={(to, direction) => {
                      const at = Math.max(0, Math.min(slides.length - 1, to));
                      onChange((p) => moveSlide(p, index, at));
                      onAnnounce(`${SLIDE_LABELS[slide.type].label} in posizione ${at + 1} di ${slides.length}.`);
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
                        sponsors={sponsors}
                        onChange={(next) => onChange((p) => updateSlide(p, slide.id, (s) => withBlockOptions(s, next)))}
                      />
                    )}
                  </SlideRow>
                );
              })}
            </ol>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-2">
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
      </SettingsCard>
    </>
  );
}

/**
 * Section «Pause» (the old page «Pause»): ready-made models, then the four pauses in tabs (the end of set also set by
 * set), each with on/off, mode for every device, slides with their options, delay; the rule of the «ogni N punti».
 */
export function PausesSection({
  draft,
  onChange,
  kind,
  onKind,
  setTab,
  onSetTab,
  assets,
  sponsors,
}: {
  draft: TenantIntermissions;
  onChange: (change: (config: TenantIntermissions) => TenantIntermissions) => void;
  kind: IntermissionKind;
  onKind: (kind: IntermissionKind) => void;
  setTab: SetTab;
  onSetTab: (set: SetTab) => void;
  assets: AssetListResponse;
  /** Sponsors of the client (the sponsor slides choose among them). */
  sponsors: readonly Sponsor[];
}) {
  const [announce, setAnnounce] = useState('');
  const target = pauseTargetOf(kind, setTab);
  const ownSet = kind === 'setBreak' && setTab !== 'all' ? setTab : null;
  const pause = pauseAt(draft, target);
  const problems = pauseProblems(draft);
  const title = ownSet ? `${KIND_LABELS.setBreak}, ${ownSet}° set` : KIND_LABELS[kind];

  const change = (update: (p: PauseConfig) => PauseConfig): void => {
    onChange((d) => {
      const current = pauseAt(d, target);
      return current ? withPause(d, target, update(current)) : d;
    });
  };

  const kindProblem = (k: IntermissionKind): boolean =>
    problems.has(k) || (k === 'setBreak' && SET_BREAK_SETS.some((s) => problems.has(`setBreak-${s}`)));
  const editor = pause ? (
    <PauseEditor
      key={target}
      pause={pause}
      kind={kind}
      target={target}
      assets={assets}
      sponsors={sponsors}
      onChange={change}
      onAnnounce={setAnnounce}
    />
  ) : null;
  const kindPanel = 'pannello-pausa';
  const setPanel = 'pannello-set';
  return (
    <div className="space-y-3">
      <ModelPicker
        labels={PAUSE_MODEL_LABELS}
        active={activePauseModel(draft)}
        onApply={(m: StudioModel) => {
          onChange((d) => applyPauseModel(d, m));
          setAnnounce(`Modello «${PAUSE_MODEL_LABELS[m].label}» applicato alle pause.`);
        }}
      />
      <TabList
        label="Pausa"
        tabs={PAUSE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))}
        value={kind}
        onChange={onKind}
        idPrefix="scheda-pausa"
        panelId={kindPanel}
        problem={kindProblem}
      />
      <div id={kindPanel} role="tabpanel" aria-labelledby={`scheda-pausa-${kind}`} className="space-y-3">
        <p className="text-xs text-muted">{KIND_HINTS[kind]}</p>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
        {kind === 'setBreak' && (
          <TabList<SetTab>
            label="Set"
            tabs={[
              { value: 'all', label: 'Tutti i set' },
              ...SET_BREAK_SETS.map((s) => ({ value: s, label: `${s}° set` })),
            ]}
            value={setTab}
            onChange={onSetTab}
            idPrefix="scheda-set"
            panelId={setPanel}
            problem={(s) => (s === 'all' ? problems.has('setBreak') : problems.has(`setBreak-${s}`))}
          />
        )}
        <div
          id={setPanel}
          {...(kind === 'setBreak' ? { role: 'tabpanel', 'aria-labelledby': `scheda-set-${setTab}` } : {})}
          className="space-y-3"
        >
          {ownSet && (
            <Setting id="pause-own" where={pauseWhere(pause, 'setBreak')} scene="setBreak" targets={['pause']}>
              <label className="flex items-center gap-2 text-sm font-medium text-text">
                <input
                  type="checkbox"
                  checked={pause !== undefined}
                  onChange={(e) => {
                    onChange((d) => setOwnPause(d, ownSet, e.target.checked));
                    setAnnounce(
                      e.target.checked
                        ? `Pausa propria per il ${ownSet}° set.`
                        : `Il ${ownSet}° set usa la pausa di tutti i set.`,
                    );
                  }}
                />
                Pausa propria per la fine del {ownSet}° set
              </label>
              {!pause && (
                <p className="text-sm text-muted">
                  Alla fine del {ownSet}° set si usa la pausa di «Tutti i set». Attiva la pausa propria per cambiarla
                  solo per questo set.
                </p>
              )}
            </Setting>
          )}
          {kind === 'milestone' && (
            <SettingsCard title="Regola">
              <Setting
                id="milestone-rule"
                where={pauseWhere(draft.milestone, 'milestone')}
                scene="milestone"
                targets={['pause']}
              >
                <MilestoneRule
                  pause={draft.milestone}
                  onChange={(rule) => onChange((d) => withMilestoneRule(d, rule))}
                />
              </Setting>
            </SettingsCard>
          )}
          {editor}
          {pause && (
            <Advanced>
              <Setting id="pause-delay" where={pauseWhere(pause, kind)} scene={kind} targets={['pause']}>
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
                      const delaySeconds = clampInt(e.target.value, 0, INTERMISSION_MAX_DELAY_SECONDS);
                      change((p) => ({ ...p, delaySeconds }));
                    }}
                  />
                  <span className="text-xs text-muted">
                    {kind === 'setBreak' ? 'Il tabellone mostra prima la fine del set.' : 'Da 0 a 60.'}{' '}
                    {kind === 'milestone'
                      ? 'La pausa si chiude da sola dopo le sue diapositive.'
                      : 'La pausa si chiude da sola alla ripresa del gioco.'}
                  </span>
                </label>
              </Setting>
              <div className="space-y-1 pt-1">
                <Button
                  title={`Torna alle impostazioni predefinite di «${title}»`}
                  onClick={() => {
                    onChange((d) => resetPause(d, target));
                    setAnnounce(`Impostazioni predefinite per ${title}.`);
                  }}
                >
                  Ripristina predefinito
                </Button>
                <p className="text-xs text-muted">Solo per «{title}».</p>
              </div>
            </Advanced>
          )}
        </div>
      </div>
    </div>
  );
}
