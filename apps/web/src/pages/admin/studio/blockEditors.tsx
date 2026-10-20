import type {
  AssetListResponse,
  BrandingResponse,
  LayoutBlock,
  LayoutDevice,
  Sponsor,
  TenantLayout,
} from '@sir/shared';
import {
  MESSAGE_MAX_LENGTH,
  publicAssetPath,
  QR_CAPTION_MAX_LENGTH,
  SPONSOR_BLOCK_MAX_SPONSORS,
  SPONSOR_MAX_SECONDS,
  SPONSOR_MIN_SECONDS,
  TOP_PLAYERS_MAX,
} from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { BlockBrand } from '../../../blocks/env.ts';
import { BLOCKS } from '../../../blocks/registry.tsx';
import { SAMPLE_SCHEDULE } from '../../../blocks/sampleSchedule.ts';
import { MatchView } from '../../../components/MatchView.tsx';
import { publicSponsorsOf } from '../../../lib/sponsors.ts';
import { LayoutScaleContext, useElementSize } from '../../../lib/useLayout.ts';
import { CalendarOptionsFields } from '../CalendarOptionsFields.tsx';
import { inputClass } from '../forms.tsx';
import { StatOptionsFields, withStatOptions } from '../StatOptionsFields.tsx';
import { imageCountText } from '../imageUpload.ts';
import { DEVICE_LABELS } from './model.ts';

/**
 * Pieces shared by the sections of the «Studio grafico»: the page of a device drawn in a frame (real components of the
 * public page), the options of a block or of a slide of the same type, the upload of an image.
 */

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
export const widthLabel = (w: number): string => `${WIDTH_NAMES[w] ?? 'Colonne'} (${w}/12)`;

export const SPONSOR_SECONDS = [3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 45, 60].filter(
  (s) => s >= SPONSOR_MIN_SECONDS && s <= SPONSOR_MAX_SECONDS,
);
/** Example short link encoded by the QR of the preview. */
const PREVIEW_CODE = 'K7M2QX9P';

export const selectClass = `${inputClass} w-auto`;

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
  top = false,
  children,
}: {
  device: LayoutDevice;
  layout: TenantLayout | null;
  state: MatchState;
  look: BlockBrand | null;
  source: string;
  /** Full screen view: the frame is as big as fits the parent (which must have a size), keeping the proportions. */
  fit?: boolean;
  /** `fit`: the frame at the top of the room (no empty space above it) instead of in the middle. */
  top?: boolean;
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
      <div
        ref={area}
        className={fit ? `flex min-h-0 flex-1 justify-center ${top ? 'items-start' : 'items-center'}` : 'contents'}
      >
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
            data-studio-page=""
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
  sponsors,
}: {
  block: LayoutBlock;
  onChange: (block: LayoutBlock) => void;
  /** Images of the client: the single images chosen before the sponsors. */
  assets: AssetListResponse;
  /** Sponsors of the client, in the order of their list. */
  sponsors: readonly Sponsor[];
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
      const { options } = block;
      const chosen = new Set(options.sponsors);
      const setOptions = (change: Partial<typeof options>): void =>
        onChange({ ...block, options: { ...options, ...change } });
      const toggle = (id: string, on: boolean): void =>
        setOptions({ sponsors: on ? [...options.sponsors, id] : options.sponsors.filter((s) => s !== id) });
      const byId = new Map(assets.assets.map((a) => [a.id, a]));
      return (
        <div className="space-y-2 text-sm text-text">
          <fieldset className="space-y-1">
            <legend className="text-sm text-text">
              Sponsor a rotazione ({chosen.size} di al massimo {SPONSOR_BLOCK_MAX_SPONSORS})
            </legend>
            {sponsors.length === 0 ? (
              <p className="text-xs text-muted">Nessuno sponsor: aggiungili nella pagina «Sponsor».</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {sponsors.map((sp) => {
                  const first = sp.imageIds[0];
                  return (
                    <li key={sp.id}>
                      <label className="flex items-center gap-2 rounded-card border border-border bg-surface px-2 py-1">
                        <input
                          type="checkbox"
                          checked={chosen.has(sp.id)}
                          disabled={!chosen.has(sp.id) && chosen.size >= SPONSOR_BLOCK_MAX_SPONSORS}
                          onChange={(e) => toggle(sp.id, e.target.checked)}
                        />
                        {first ? (
                          <img src={publicAssetPath(first)} alt="" className="size-8 object-contain" />
                        ) : (
                          <span aria-hidden="true" className="size-8 rounded bg-surface-2" />
                        )}
                        <span className="text-xs">
                          {sp.name} · {imageCountText(sp.imageIds.length)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </fieldset>
          {options.images.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-sm text-text">Immagini singole</legend>
              <p className="text-xs text-muted">Scelte prima degli sponsor: ruotano dopo le immagini degli sponsor.</p>
              <ul className="flex flex-wrap gap-2">
                {options.images.map((id, i) => {
                  const asset = byId.get(id);
                  return (
                    <li
                      key={id}
                      className="flex items-center gap-2 rounded-card border border-border bg-surface px-2 py-1"
                    >
                      <img src={asset?.url ?? publicAssetPath(id)} alt="" className="size-8 object-contain" />
                      <span className="text-xs">Immagine {i + 1}</span>
                      <button
                        type="button"
                        className="text-xs text-muted underline hover:text-text"
                        aria-label={`Togli l’immagine singola ${i + 1} da ${label}`}
                        onClick={() => setOptions({ images: options.images.filter((x) => x !== id) })}
                      >
                        Togli
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Secondi per immagine
              <select
                className={selectClass}
                value={options.seconds}
                onChange={(e) => setOptions({ seconds: Number(e.target.value) })}
              >
                {SPONSOR_SECONDS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <Link to="/admin/sponsor" className="text-sm font-medium text-text underline">
              Gestisci sponsor
            </Link>
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

/** Graphics of the client of the session for the blocks of the previews (logo, QR and sponsors). */
export function blockBrandOf(b: BrandingResponse, sponsors: readonly Sponsor[] = []): BlockBrand {
  return {
    name: b.branding.displayName ?? b.tenantName,
    logoMain: b.branding.logoMain ? publicAssetPath(b.branding.logoMain) : null,
    logoMark: b.branding.logoMark ? publicAssetPath(b.branding.logoMark) : null,
    sponsors: publicSponsorsOf(sponsors),
  };
}
