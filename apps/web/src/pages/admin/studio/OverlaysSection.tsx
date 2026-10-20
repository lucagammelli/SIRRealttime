import type { Overlay, OverlayKind, OverlayPosition, OverlaySize, TenantOverlays } from '@arenalive/shared';
import {
  defaultOverlay,
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
  OverlayTextSchema,
} from '@arenalive/shared';
import type { MatchState } from '@arenalive/volley-stats';
import { useId, useState } from 'react';
import { Button } from '../../../components/ui.tsx';
import { overlayText, sampleEvent } from '../../../lib/overlay.ts';
import { inputClass } from '../forms.tsx';
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

/** Id of the setting of an overlay (target of a click on the overlay in the preview). */
export const overlaySettingId = (kind: OverlayKind): string => `overlay-${kind}`;

/** Settings of the overlay being edited: text, duration, devices, own position and size; priority under «Avanzate». */
function OverlayDetail({
  kind,
  config,
  overlay,
  state,
  onChange,
  onTry,
  onReset,
}: {
  kind: OverlayKind;
  config: TenantOverlays;
  overlay: Overlay;
  state: MatchState | null;
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
