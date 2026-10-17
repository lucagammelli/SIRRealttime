import type {
  AssetListResponse,
  AssetSummary,
  BlockType,
  BrandingResponse,
  LayoutBlock,
  LayoutDevice,
  TemplateId,
  TenantLayout,
} from '@sir/shared';
import {
  ASSET_MAX_BYTES,
  AssetListResponseSchema,
  AssetSummarySchema,
  BrandingResponseSchema,
  LAYOUT_DEVICES,
  LAYOUT_MAX_BLOCKS,
  LayoutResponseSchema,
  MESSAGE_MAX_LENGTH,
  publicAssetPath,
  QR_CAPTION_MAX_LENGTH,
  SPONSOR_MAX_IMAGES,
  SPONSOR_MAX_SECONDS,
  SPONSOR_MIN_SECONDS,
  TOP_PLAYERS_MAX,
} from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import type { DragEvent, ReactNode, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlockBrand } from '../../blocks/env.ts';
import { BLOCKS, REGISTRY_TYPES } from '../../blocks/registry.tsx';
import { loadSampleMatch } from '../../blocks/sampleMatch.ts';
import { SAMPLE_SCHEDULE } from '../../blocks/sampleSchedule.ts';
import { MatchView } from '../../components/MatchView.tsx';
import { PreviewDock } from '../../components/PreviewDock.tsx';
import { Button, Card, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { fileToBase64 } from '../../lib/base64.ts';
import { initBranding } from '../../lib/branding.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { LayoutScaleContext, useElementSize } from '../../lib/useLayout.ts';
import { socketUrl, useLiveSocket } from '../../lib/useLiveSocket.ts';
import { useApiError } from './auth.tsx';
import { inputClass } from './forms.tsx';
import { CalendarOptionsFields } from './CalendarOptionsFields.tsx';
import { StatOptionsFields, withStatOptions } from './StatOptionsFields.tsx';
import { addBlock, canAdd, layoutProblems, moveBlock, removeBlock, resetDevice, updateBlock } from './layoutEditor.ts';

export const DEVICE_LABELS: Record<LayoutDevice, string> = { tv: 'TV', tablet: 'Tablet', phone: 'Telefono' };

/** Page drawn in the preview (CSS px) and proportions of its frame: 16:9, 4:3, 9:19.5. */
const VIRTUAL: Record<LayoutDevice, { width: number; height: number; frame: string }> = {
  tv: { width: 1920, height: 1080, frame: 'w-full' },
  tablet: { width: 1024, height: 768, frame: 'w-full max-w-xl' },
  phone: { width: 390, height: 845, frame: 'w-full max-w-[15rem]' },
};

const WIDTH_NAMES: Record<number, string> = {
  12: 'Intera',
  8: 'Due terzi',
  6: 'Metà',
  4: 'Un terzo',
  3: 'Un quarto',
};
const widthLabel = (w: number): string => `${WIDTH_NAMES[w] ?? 'Colonne'} (${w}/12)`;

export const SPONSOR_SECONDS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60].filter(
  (s) => s >= SPONSOR_MIN_SECONDS && s <= SPONSOR_MAX_SECONDS,
);
/** Example short link encoded by the QR of the preview. */
const PREVIEW_CODE = 'K7M2QX9P';
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

export const selectClass = `${inputClass} w-auto`;

/** Text shown when a chosen image is over the limit (nothing is sent). */
export const IMAGE_TOO_LARGE = 'Immagine troppo grande: al massimo 2 MB.';

/** Uploads a sponsor image of the client; null when the file is over ASSET_MAX_BYTES (nothing sent). */
export async function uploadSponsorImage(file: File): Promise<AssetSummary | null> {
  if (file.size > ASSET_MAX_BYTES) return null;
  const data = await fileToBase64(file);
  return apiRequest('/api/admin/assets', AssetSummarySchema, { method: 'POST', body: { kind: 'sponsor', data } });
}

/** Width (px) of an element, followed with ResizeObserver; 0 before the first measure. */
function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Example short link encoded by the QR of the previews. */
export const previewPageUrl = (): string => `${window.location.origin}/l/${PREVIEW_CODE}`;

/**
 * The page of one device, drawn at its real size and scaled into a frame with the proportions of the screen. Not
 * interactive (`inert`): it only shows what the public page will look like. `children` go over the page, inside the
 * frame (an element `fixed` there stays in the frame: the scaled box is its containing block).
 */
export function DevicePreview({
  device,
  layout,
  state,
  look,
  source,
  fit = false,
  children,
}: {
  device: LayoutDevice;
  layout: TenantLayout | null;
  state: MatchState;
  look: BlockBrand | null;
  source: string;
  /** Full screen view: the frame is as big as fits the parent (which must have a size), keeping the proportions. */
  fit?: boolean;
  children?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(frame);
  const room = useElementSize(area);
  const size = VIRTUAL[device];
  // `fit`: the biggest scale at which the whole page fits the room (minus the 4 px border on each side).
  const fitScale =
    room.width > 0 && room.height > 0
      ? Math.max(0.05, Math.min((room.width - 8) / size.width, (room.height - 8) / size.height))
      : 0.25;
  const scale = fit ? fitScale : measured > 0 ? measured / size.width : 0.25;
  const tv = device === 'tv';
  return (
    <figure
      className={fit ? 'flex h-full w-full flex-col' : 'space-y-2'}
      aria-label={`Anteprima ${DEVICE_LABELS[device]}`}
    >
      <div ref={area} className={fit ? 'flex min-h-0 flex-1 items-center justify-center' : 'contents'}>
        <div
          ref={frame}
          data-testid={`anteprima-${device}`}
          className={`relative overflow-hidden rounded-panel border-4 border-border bg-bg ${fit ? 'shrink-0' : `mx-auto ${size.frame}`}`}
          style={
            fit
              ? { width: size.width * scale + 8, height: size.height * scale + 8 }
              : { aspectRatio: `${size.width} / ${size.height}` }
          }
        >
          <div
            inert
            className={`absolute left-0 top-0 border-t-4 border-accent bg-bg text-text ${
              tv ? 'flex flex-col overflow-hidden p-5' : 'overflow-y-auto p-3'
            }`}
            style={{ width: size.width, height: size.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}
          >
            <LayoutScaleContext.Provider value={scale}>
              <div className={tv ? 'min-h-0 flex-1' : ''}>
                <MatchView
                  state={state}
                  device={device}
                  brand={tv}
                  layout={layout}
                  look={look}
                  pageUrl={previewPageUrl()}
                  schedule={SAMPLE_SCHEDULE}
                />
              </div>
              {children}
            </LayoutScaleContext.Provider>
          </div>
        </div>
      </div>
      {!fit && <figcaption className="text-center text-xs text-muted">{source}</figcaption>}
    </figure>
  );
}

/** Options of a block, by type (also the options of the slides of the pauses, which are the same). */
export function BlockOptionsEditor({
  block,
  onChange,
  assets,
  uploading,
  onUpload,
}: {
  block: LayoutBlock;
  onChange: (block: LayoutBlock) => void;
  assets: AssetListResponse;
  uploading: boolean;
  onUpload: (file: File, block: LayoutBlock) => void;
}) {
  const label = BLOCKS[block.type].label;
  switch (block.type) {
    case 'logo':
      return (
        <label className="flex flex-wrap items-center gap-2 text-sm text-text">
          Logo
          <select
            className={selectClass}
            value={block.options.variant}
            onChange={(e) => onChange({ ...block, options: { variant: e.target.value === 'mark' ? 'mark' : 'main' } })}
          >
            <option value="main">Orizzontale</option>
            <option value="mark">Quadrato</option>
          </select>
        </label>
      );
    case 'message':
      return (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 space-y-1 text-sm text-text">
            <span>Testo del messaggio</span>
            <input
              type="text"
              className={inputClass}
              value={block.options.text}
              maxLength={MESSAGE_MAX_LENGTH}
              aria-invalid={block.options.text.trim() === ''}
              onChange={(e) => onChange({ ...block, options: { ...block.options, text: e.target.value } })}
            />
          </label>
          <label className="space-y-1 text-sm text-text">
            <span>Dimensione</span>
            <select
              className={selectClass}
              value={block.options.size}
              onChange={(e) =>
                onChange({
                  ...block,
                  options: { ...block.options, size: e.target.value === 'large' ? 'large' : 'normal' },
                })
              }
            >
              <option value="normal">Normale</option>
              <option value="large">Grande</option>
            </select>
          </label>
        </div>
      );
    case 'qr':
      return (
        <label className="block space-y-1 text-sm text-text">
          <span>Testo sopra il codice QR</span>
          <input
            type="text"
            className={inputClass}
            value={block.options.caption}
            maxLength={QR_CAPTION_MAX_LENGTH}
            aria-invalid={block.options.caption.trim() === ''}
            onChange={(e) => onChange({ ...block, options: { caption: e.target.value } })}
          />
        </label>
      );
    case 'nextMatch':
    case 'standings':
      return <CalendarOptionsFields block={block} onChange={onChange} name={label} />;
    case 'topPlayers':
      return (
        <div className="flex flex-wrap items-center gap-3 text-sm text-text">
          <label className="flex items-center gap-2">
            Quanti
            <select
              className={selectClass}
              value={block.options.count}
              onChange={(e) => onChange({ ...block, options: { ...block.options, count: Number(e.target.value) } })}
            >
              {Array.from({ length: TOP_PLAYERS_MAX }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Squadra
            <select
              className={selectClass}
              value={block.options.team}
              onChange={(e) => {
                const team = e.target.value === 'home' ? 'home' : e.target.value === 'away' ? 'away' : 'both';
                onChange({ ...block, options: { ...block.options, team } });
              }}
            >
              <option value="both">Entrambe</option>
              <option value="home">Casa</option>
              <option value="away">Ospiti</option>
            </select>
          </label>
        </div>
      );
    case 'sponsor': {
      const chosen = new Set(block.options.images);
      const toggle = (id: string, on: boolean): void => {
        const images = on ? [...block.options.images, id] : block.options.images.filter((i) => i !== id);
        onChange({ ...block, options: { ...block.options, images } });
      };
      return (
        <div className="space-y-2 text-sm text-text">
          <fieldset className="space-y-1">
            <legend className="text-sm text-text">
              Immagini a rotazione ({block.options.images.length} di al massimo {SPONSOR_MAX_IMAGES})
            </legend>
            {assets.assets.length === 0 ? (
              <p className="text-xs text-muted">Nessuna immagine caricata: caricane una qui sotto.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {assets.assets.map((a, i) => (
                  <li key={a.id}>
                    <label className="flex items-center gap-2 rounded-card border border-border bg-surface px-2 py-1">
                      <input
                        type="checkbox"
                        checked={chosen.has(a.id)}
                        disabled={!chosen.has(a.id) && chosen.size >= SPONSOR_MAX_IMAGES}
                        onChange={(e) => toggle(a.id, e.target.checked)}
                      />
                      <img src={a.url} alt="" className="size-8 object-contain" />
                      <span className="text-xs">
                        Immagine {i + 1} · {a.width}×{a.height} px
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Secondi per immagine
              <select
                className={selectClass}
                value={block.options.seconds}
                onChange={(e) => onChange({ ...block, options: { ...block.options, seconds: Number(e.target.value) } })}
              >
                {SPONSOR_SECONDS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex min-h-9 cursor-pointer items-center rounded-card border border-border bg-surface px-3 py-1.5 font-medium hover:bg-surface-2">
              {uploading ? 'Caricamento…' : 'Carica immagine sponsor'}
              <input
                type="file"
                accept={ACCEPT}
                className="sr-only"
                disabled={uploading}
                aria-label={`Carica immagine sponsor per ${label}`}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) onUpload(file, block);
                }}
              />
            </label>
          </div>
        </div>
      );
    }
    case 'setScorers':
    case 'aces':
    case 'blocks':
    case 'attack':
    case 'roleDuel':
    case 'teamDuel':
      return (
        <StatOptionsFields
          item={block}
          name={label}
          setLabel="Il set in corso"
          onChange={(item) => onChange(withStatOptions(block, item))}
        />
      );
    default:
      return null;
  }
}

/** One block of the list: drag handle, up/down, name, visibility, width, options, removal. */
function BlockRow({
  block,
  index,
  count,
  device,
  invalid,
  dropTarget,
  children,
  onChange,
  onMove,
  onRemove,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: {
  block: LayoutBlock;
  index: number;
  count: number;
  device: LayoutDevice;
  invalid: boolean;
  dropTarget: boolean;
  children: ReactNode;
  onChange: (block: LayoutBlock) => void;
  onMove: (to: number, direction: 'up' | 'down') => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const definition = BLOCKS[block.type];
  const name = definition.label;
  return (
    <li
      data-block-id={block.id}
      onDragOver={(e) => {
        e.preventDefault();
        onDragEnter();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      className={`space-y-2 rounded-card border bg-surface-2 p-3 ${
        dropTarget ? 'border-focus' : invalid ? 'border-danger' : 'border-border'
      } ${block.visible ? '' : 'opacity-70'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          title="Trascina per spostare"
          aria-hidden="true"
          className="cursor-grab select-none px-1 text-lg leading-none text-muted active:cursor-grabbing"
        >
          ⠿
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text">
            {index + 1}. {name}
          </span>
          <span className="block text-xs text-muted">{definition.description}</span>
        </span>
        <Button
          variant="ghost"
          aria-label={`Sposta su ${name}`}
          data-move={`${block.id}-up`}
          disabled={index === 0}
          onClick={() => onMove(index - 1, 'up')}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          aria-label={`Sposta giù ${name}`}
          data-move={`${block.id}-down`}
          disabled={index === count - 1}
          onClick={() => onMove(index + 1, 'down')}
        >
          ↓
        </Button>
        <Button variant="ghost" aria-label={`Rimuovi ${name}`} onClick={onRemove}>
          Rimuovi
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm text-text">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            role="switch"
            checked={block.visible}
            aria-label={`Visibile: ${name}`}
            onChange={(e) => onChange({ ...block, visible: e.target.checked })}
          />
          Visibile
        </label>
        {device === 'phone' ? (
          block.type !== 'scoreboard' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={block.collapsed}
                onChange={(e) => onChange({ ...block, collapsed: e.target.checked })}
              />
              Chiuso all’apertura
            </label>
          )
        ) : (
          <label className="flex items-center gap-2">
            Larghezza
            <select
              className={selectClass}
              aria-label={`Larghezza: ${name}`}
              value={block.width}
              onChange={(e) => onChange({ ...block, width: Number(e.target.value) })}
            >
              {definition.widths.map((w) => (
                <option key={w} value={w}>
                  {widthLabel(w)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {children}
      {invalid && <p className="text-xs text-danger">Controlla le opzioni di questo blocco (testo vuoto?).</p>}
    </li>
  );
}

/** Editor of the blocks of the public page for the three devices, with live preview. */
function LayoutEditor({
  tenantName,
  saved,
  assets,
  look,
  template,
  onAssetsChanged,
}: {
  tenantName: string;
  saved: TenantLayout;
  assets: AssetListResponse;
  look: BlockBrand;
  /** Graphic template of the client: its default page for «Ripristina predefinito». */
  template: TemplateId;
  onAssetsChanged: () => void;
}) {
  const errorMessage = useApiError();
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [device, setDevice] = useState<LayoutDevice>('tv');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [addType, setAddType] = useState<BlockType>('message');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [focusMove, setFocusMove] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const problems = useMemo(() => layoutProblems(draft), [draft]);
  const invalid = Object.keys(problems).length > 0;
  const blocks = draft[device];

  // The browser asks before leaving the page with changes not saved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // After a move with the keyboard the focus stays on the button just used.
  useEffect(() => {
    if (!focusMove) return;
    // At the top (or bottom) the button just used is disabled: the other one of the same block takes the focus.
    const id = focusMove.replace(/-(up|down)$/, '');
    const used = list.current?.querySelector<HTMLButtonElement>(`[data-move="${focusMove}"]:not(:disabled)`);
    const other = list.current?.querySelector<HTMLButtonElement>(`[data-move^="${id}-"]:not(:disabled)`);
    (used ?? other)?.focus();
    setFocusMove(null);
  }, [focusMove, draft]);

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
  const previewState = liveState ?? sample;

  const move = (from: number, to: number, focus?: string): void => {
    const target = Math.max(0, Math.min(blocks.length - 1, to));
    const block = blocks[from];
    if (!block || from === target) return;
    setDraft((d) => moveBlock(d, device, from, target));
    setAnnounce(`${BLOCKS[block.type].label} in posizione ${target + 1} di ${blocks.length}.`);
    if (focus) setFocusMove(focus);
  };

  const upload = async (file: File, block: LayoutBlock): Promise<void> => {
    setError(null);
    setDone(null);
    setUploading(block.id);
    try {
      const asset = await uploadSponsorImage(file);
      if (!asset) {
        setError(IMAGE_TOO_LARGE);
        return;
      }
      setDraft((d) =>
        updateBlock(d, device, block.id, (b) =>
          b.type === 'sponsor' && !b.options.images.includes(asset.id) && b.options.images.length < SPONSOR_MAX_IMAGES
            ? { ...b, options: { ...b.options, images: [...b.options.images, asset.id] } }
            : b,
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
      const res = await apiRequest('/api/admin/layout', LayoutResponseSchema, { method: 'PUT', body: draft });
      setBase(res.layout);
      setDraft(res.layout);
      setDone('Pagina pubblica salvata: la vedono da subito tutti gli spettatori.');
      void initBranding({ fresh: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const preview = (shown: MatchState, fit: boolean) => (
    <DevicePreview
      device={device}
      layout={draft}
      state={shown}
      look={look}
      fit={fit}
      source={liveState ? 'Dati della partita live.' : 'Partita d’esempio: nessuna partita live in questo momento.'}
    />
  );
  const panelId = 'pannello-dispositivo';
  return (
    <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <Card
        title="Pagina pubblica"
        subtitle={`Cliente: ${tenantName}. Scegli i blocchi della pagina della partita per ogni tipo di schermo.`}
      >
        <div className="space-y-4">
          <div role="tablist" aria-label="Dispositivo" className="flex flex-wrap gap-1">
            {LAYOUT_DEVICES.map((d) => (
              <button
                key={d}
                type="button"
                role="tab"
                id={`scheda-${d}`}
                aria-selected={device === d}
                aria-controls={panelId}
                onClick={() => setDevice(d)}
                className={`rounded-card px-3 py-1.5 text-sm font-medium ${
                  device === d ? 'bg-nav-active text-on-nav-active' : 'text-muted hover:text-text'
                } ${problems[d] ? 'underline decoration-danger' : ''}`}
              >
                {DEVICE_LABELS[d]}
              </button>
            ))}
          </div>
          <div id={panelId} role="tabpanel" aria-labelledby={`scheda-${device}`} className="space-y-3">
            {device === 'phone' && (
              <p className="text-xs text-muted">Sul telefono ogni blocco occupa tutta la larghezza.</p>
            )}
            {device === 'tv' && (
              <p className="text-xs text-muted">
                Sulla TV il tabellone resta sempre in alto; gli altri blocchi si alternano a gruppi se non stanno in una
                schermata.
              </p>
            )}
            <p aria-live="polite" className="sr-only">
              {announce}
            </p>
            {blocks.length === 0 ? (
              <p className="text-sm text-muted">Nessun blocco: la pagina sarà vuota. Aggiungine uno qui sotto.</p>
            ) : (
              <ol ref={list} aria-label={`Blocchi (${DEVICE_LABELS[device]})`} className="space-y-2">
                {blocks.map((block, index) => (
                  <BlockRow
                    key={block.id}
                    block={block}
                    index={index}
                    count={blocks.length}
                    device={device}
                    invalid={problems[device]?.has(block.id) ?? false}
                    dropTarget={dragFrom !== null && dragOver === index && dragFrom !== index}
                    onChange={(next) => setDraft((d) => updateBlock(d, device, block.id, () => next))}
                    onMove={(to, direction) => move(index, to, `${block.id}-${direction}`)}
                    onRemove={() => {
                      setDraft((d) => removeBlock(d, device, block.id));
                      setAnnounce(`${BLOCKS[block.type].label} rimosso.`);
                    }}
                    onDragStart={(e) => {
                      setDragFrom(index);
                      e.dataTransfer?.setData('text/plain', block.id);
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnter={() => setDragOver(index)}
                    onDrop={() => {
                      if (dragFrom !== null) move(dragFrom, index);
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  >
                    <BlockOptionsEditor
                      block={block}
                      assets={assets}
                      uploading={uploading === block.id}
                      onUpload={(file, b) => void upload(file, b)}
                      onChange={(next) => setDraft((d) => updateBlock(d, device, block.id, () => next))}
                    />
                  </BlockRow>
                ))}
              </ol>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-text">
                Tipo di blocco
                <select
                  className={selectClass}
                  value={addType}
                  onChange={(e) => setAddType(e.target.value as BlockType)}
                >
                  {REGISTRY_TYPES.map((t) => (
                    <option key={t} value={t} disabled={!canAdd(blocks, t)}>
                      {BLOCKS[t].label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                disabled={!canAdd(blocks, addType)}
                onClick={() => {
                  setDraft((d) => addBlock(d, device, addType));
                  setAnnounce(`${BLOCKS[addType].label} aggiunto in fondo.`);
                }}
              >
                Aggiungi blocco
              </Button>
              <span className="text-xs text-muted">
                {blocks.length} di al massimo {LAYOUT_MAX_BLOCKS} blocchi.
              </span>
            </div>
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          {done && (
            <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
              {done}
            </p>
          )}
          {invalid && (
            <p role="alert" className="text-sm text-danger">
              Alcuni blocchi hanno opzioni non valide (
              {LAYOUT_DEVICES.filter((d) => problems[d])
                .map((d) => DEVICE_LABELS[d])
                .join(', ')}
              ): correggile prima di salvare.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !dirty || invalid} onClick={() => void save()}>
              {busy ? 'Salvataggio…' : 'Salva'}
            </Button>
            <Button
              disabled={busy}
              title={`Torna ai blocchi predefiniti per ${DEVICE_LABELS[device]}`}
              onClick={() => {
                setDraft((d) => resetDevice(d, device, template));
                setDone(null);
                setAnnounce(`Blocchi predefiniti per ${DEVICE_LABELS[device]}.`);
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
      <PreviewDock
        subtitle={`${DEVICE_LABELS[device]}, con le modifiche non ancora salvate.`}
        fullscreen={previewState ? preview(previewState, true) : null}
      >
        {previewState ? preview(previewState, false) : <Spinner label="Preparazione dell’anteprima…" />}
      </PreviewDock>
    </div>
  );
}

/** Graphics of the client of the session for the blocks of the previews (logo and QR). */
export function blockBrandOf(b: BrandingResponse): BlockBrand {
  return {
    name: b.branding.displayName ?? b.tenantName,
    logoMain: b.branding.logoMain ? publicAssetPath(b.branding.logoMain) : null,
    logoMark: b.branding.logoMark ? publicAssetPath(b.branding.logoMark) : null,
  };
}

/** Page «Pagina pubblica» (admin): the blocks of the public match page of the client, by device. */
export function LayoutPage() {
  const errorMessage = useApiError();
  const loadLayout = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/layout', LayoutResponseSchema, { signal }),
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
  const layout = useAsync(loadLayout);
  const assets = useAsync(loadAssets);
  const branding = useAsync(loadBranding);

  useEffect(() => {
    document.title = 'Pagina pubblica · Area riservata';
  }, []);

  const look = useMemo(() => (branding.data ? blockBrandOf(branding.data) : null), [branding.data]);

  for (const part of [layout, branding]) {
    if (part.error !== null) return <ErrorBox onRetry={part.reload}>{errorMessage(part.error)}</ErrorBox>;
  }
  if (assets.error !== null && !assets.data)
    return <ErrorBox onRetry={assets.reload}>{errorMessage(assets.error)}</ErrorBox>;
  if (!layout.data || !assets.data || !look) return <Spinner label="Caricamento della pagina pubblica…" />;
  return (
    <LayoutEditor
      tenantName={layout.data.tenantName}
      saved={layout.data.layout}
      assets={assets.data}
      look={look}
      template={branding.data?.branding.template ?? 'standard'}
      onAssetsChanged={assets.reload}
    />
  );
}
