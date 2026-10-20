import type {
  AssetListResponse,
  BlockType,
  LayoutBlock,
  LayoutDevice,
  Sponsor,
  TemplateId,
  TenantLayout,
} from '@arenalive/shared';
import { LAYOUT_DEVICES, LAYOUT_MAX_BLOCKS } from '@arenalive/shared';
import type { DragEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BLOCKS, REGISTRY_TYPES } from '../../../blocks/registry.tsx';
import { Button } from '../../../components/ui.tsx';
import { addBlock, canAdd, moveBlock, removeBlock, resetDevice, updateBlock } from '../layoutEditor.ts';
import { BlockOptionsEditor, selectClass, widthLabel } from './blockEditors.tsx';
import { blockHasSettings, blockWhere, DEVICE_LABELS } from './model.ts';
import { Advanced, RemoveButton, Setting, SettingsCard, TabList, Toggle } from './StudioUi.tsx';

/** Id of the setting of a block of a device (target of a click on the block in the preview). */
export const blockSettingId = (device: LayoutDevice, id: string): string => `block-${device}-${id}`;

/**
 * One block of the list: drag handle, name, visibility, up/down and «Rimuovi» (with a confirmation when the block has
 * options of its own); width and options under «Opzioni».
 */
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
      className={`rounded-card border bg-surface-2 ${dropTarget ? 'border-focus' : invalid ? 'border-danger' : 'border-border'} ${
        block.visible ? '' : 'opacity-70'
      }`}
    >
      <Setting
        id={blockSettingId(device, block.id)}
        where={blockWhere(device, block)}
        scene="play"
        targets={[`block:${block.id}`]}
        className="mx-0 px-2"
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
            <span className="block text-sm font-semibold leading-tight text-text [overflow-wrap:anywhere]">
              {index + 1}. {name}
            </span>
          </span>
          {/* Commands on their own row under the name: the name keeps the whole width of a narrow column. */}
          <div className="flex basis-full items-center gap-2">
            <Toggle
              checked={block.visible}
              label={`Visibile: ${name}`}
              title={block.visible ? 'Visibile' : 'Nascosto'}
              onChange={(visible) => onChange({ ...block, visible })}
            />
            <Button
              variant="ghost"
              aria-label={`Sposta su ${name}`}
              data-move={`${block.id}-up`}
              disabled={index === 0}
              onClick={() => onMove(index - 1, 'up')}
              className="px-2"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              aria-label={`Sposta giù ${name}`}
              data-move={`${block.id}-down`}
              disabled={index === count - 1}
              onClick={() => onMove(index + 1, 'down')}
              className="px-2"
            >
              ↓
            </Button>
            <RemoveButton name={name} confirm={blockHasSettings(block)} onRemove={onRemove} />
          </div>
        </div>
        <details className="group text-sm text-text" open={invalid || undefined}>
          <summary className="cursor-pointer text-xs text-muted hover:text-text">
            Opzioni{device !== 'phone' ? ` · ${widthLabel(block.width)}` : ''}
          </summary>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted">{definition.description}</p>
            <div className="flex flex-wrap items-center gap-4">
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
          </div>
        </details>
        {invalid && <p className="text-xs text-danger">Controlla le opzioni di questo blocco (testo vuoto?).</p>}
      </Setting>
    </li>
  );
}

/**
 * Section «Pagina live» (the old page «Pagina pubblica»): the blocks of the public page for the device of the
 * preview, in order (dragging or with ↑ ↓, the focus stays on the button), visibility, width, options, new blocks and
 * the default page of the template.
 */
export function PageSection({
  draft,
  onChange,
  device,
  onDevice,
  problems,
  assets,
  sponsors,
  template,
}: {
  draft: TenantLayout;
  onChange: (change: (layout: TenantLayout) => TenantLayout) => void;
  device: LayoutDevice;
  onDevice: (device: LayoutDevice) => void;
  problems: Partial<Record<LayoutDevice, Set<string>>>;
  assets: AssetListResponse;
  /** Sponsors of the client (the sponsor blocks choose among them). */
  sponsors: readonly Sponsor[];
  /** Graphic template of the client: its default page for «Ripristina predefinito». */
  template: TemplateId;
}) {
  const [announce, setAnnounce] = useState('');
  const [addType, setAddType] = useState<BlockType>('message');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [focusMove, setFocusMove] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const blocks = draft[device];

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

  const move = (from: number, to: number, focus?: string): void => {
    const target = Math.max(0, Math.min(blocks.length - 1, to));
    const block = blocks[from];
    if (!block || from === target) return;
    onChange((d) => moveBlock(d, device, from, target));
    setAnnounce(`${BLOCKS[block.type].label} in posizione ${target + 1} di ${blocks.length}.`);
    if (focus) setFocusMove(focus);
  };

  const panelId = 'pannello-dispositivo';
  return (
    <div className="space-y-3">
      <TabList
        label="Dispositivo"
        tabs={LAYOUT_DEVICES.map((d) => ({ value: d, label: DEVICE_LABELS[d] }))}
        value={device}
        onChange={onDevice}
        idPrefix="scheda"
        panelId={panelId}
        problem={(d) => problems[d] !== undefined}
      />
      <div id={panelId} role="tabpanel" aria-labelledby={`scheda-${device}`} className="space-y-3">
        <SettingsCard title={`Blocchi (${DEVICE_LABELS[device]})`}>
          <p className="text-xs text-muted">
            {device === 'phone'
              ? 'Sul telefono ogni blocco occupa tutta la larghezza.'
              : device === 'tv'
                ? 'Sulla TV il tabellone resta sempre in alto; gli altri blocchi si alternano a gruppi se non stanno in una schermata.'
                : 'Sul tablet ogni blocco è largo quanto scelto; in verticale sono uno sotto l’altro.'}{' '}
            Trascina ⠿ o usa ↑ ↓ per cambiare l’ordine.
          </p>
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
                  onChange={(next) => onChange((d) => updateBlock(d, device, block.id, () => next))}
                  onMove={(to, direction) => move(index, to, `${block.id}-${direction}`)}
                  onRemove={() => {
                    onChange((d) => removeBlock(d, device, block.id));
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
                    sponsors={sponsors}
                    onChange={(next) => onChange((d) => updateBlock(d, device, block.id, () => next))}
                  />
                </BlockRow>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <label className="flex items-center gap-2 text-sm text-text">
              Tipo di blocco
              <select className={selectClass} value={addType} onChange={(e) => setAddType(e.target.value as BlockType)}>
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
                onChange((d) => addBlock(d, device, addType));
                setAnnounce(`${BLOCKS[addType].label} aggiunto in fondo.`);
              }}
            >
              Aggiungi blocco
            </Button>
            <span className="text-xs text-muted">
              {blocks.length} di al massimo {LAYOUT_MAX_BLOCKS} blocchi.
            </span>
          </div>
        </SettingsCard>
        <Advanced>
          <div className="space-y-1 pt-1">
            <Button
              title={`Torna ai blocchi predefiniti per ${DEVICE_LABELS[device]}`}
              onClick={() => {
                onChange((d) => resetDevice(d, device, template));
                setAnnounce(`Blocchi predefiniti per ${DEVICE_LABELS[device]}.`);
              }}
            >
              Ripristina predefinito
            </Button>
            <p className="text-xs text-muted">
              Solo per {DEVICE_LABELS[device]}: i blocchi della pagina predefinita del modello grafico.
            </p>
          </div>
        </Advanced>
      </div>
    </div>
  );
}
