import type {
  LayoutDevice,
  Overlay,
  OverlayKind,
  OverlayPlaceholder,
  OverlayPosition,
  OverlaySize,
  TenantOverlays,
} from '@sir/shared';
import {
  BrandingResponseSchema,
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
  OverlaysResponseSchema,
  overlayPlacement,
  OverlayTextSchema,
} from '@sir/shared';
import type { MatchState, Side } from '@sir/volley-stats';
import { COMEBACK_MIN_POINTS, LONG_RALLY_MIN_ATTACKS, RUN_MIN_POINTS } from '@sir/volley-stats';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { BlockBrand } from '../../blocks/env.ts';
import { loadSampleMatch } from '../../blocks/sampleMatch.ts';
import { OVERLAY_REGION_CLASSES, OverlayBanner } from '../../components/Overlay.tsx';
import { PreviewDock } from '../../components/PreviewDock.tsx';
import { Button, Card, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { initBranding } from '../../lib/branding.ts';
import { overlayText, sampleEvent } from '../../lib/overlay.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { socketUrl, useLiveSocket } from '../../lib/useLiveSocket.ts';
import { useApiError } from './auth.tsx';
import { inputClass } from './forms.tsx';
import { TabList } from './IntermissionsPage.tsx';
import { blockBrandOf, DEVICE_LABELS, DevicePreview, selectClass } from './LayoutPage.tsx';

const OVERLAY_LABELS: Record<OverlayKind, { label: string; hint: string }> = {
  matchEnd: { label: 'Fine partita', hint: 'Alla fine dell’ultimo set, prima della pausa di fine partita.' },
  matchPoint: { label: 'Match point', hint: 'Come il set point, per la squadra che ha già vinto 2 set.' },
  setEnd: { label: 'Fine set', hint: 'Alla fine di ogni set (non l’ultimo), prima della pausa di fine set.' },
  setPoint: {
    label: 'Set point',
    hint: 'Quando una squadra arriva a un punto dal set, anche ai vantaggi e al tie-break; non si ripete finché resta in vantaggio.',
  },
  ace: { label: 'Ace', hint: 'Punto diretto in battuta.' },
  block: { label: 'Muro punto', hint: 'Punto diretto a muro.' },
  lead: {
    label: 'Sorpasso',
    hint: `La squadra che era dietro passa avanti: dal 15-15 (9-9 al tie-break) o dopo una rimonta di ${COMEBACK_MIN_POINTS} punti.`,
  },
  tie: {
    label: 'Pareggio',
    hint: `Dal 15-15 (9-9 al tie-break) o dopo una rimonta di ${COMEBACK_MIN_POINTS} punti.`,
  },
  run: { label: 'Break', hint: `Dal ${RUN_MIN_POINTS}° punto di fila della stessa squadra, a ogni punto in più.` },
  timeout: { label: 'Time-out', hint: 'Alla chiamata del time-out (la pausa del time-out lo mostra già).' },
  longRally: { label: 'Scambio lungo', hint: `Scambio con almeno ${LONG_RALLY_MIN_ATTACKS} attacchi.` },
  substitution: { label: 'Cambio', hint: 'Sostituzione: {giocatore} e {numero} sono di chi entra.' },
};

const PLACEHOLDER_LABELS: Record<OverlayPlaceholder, string> = {
  giocatore: 'nome del giocatore',
  numero: 'numero di maglia',
  squadra: 'squadra dell’evento',
  punteggio: 'punteggio del set',
  set: 'numero del set',
  serie: 'punti di fila (break)',
  attacchi: 'attacchi dello scambio',
};

const POSITION_LABELS: Record<OverlayPosition, string> = { top: 'In alto', center: 'Al centro', bottom: 'In basso' };
const SIZE_LABELS: Record<OverlaySize, string> = { small: 'Piccolo', medium: 'Medio', large: 'Grande' };
/** Value of the «Come le impostazioni generali» option of the own position / size of an overlay. */
const GENERAL = '';

const isPosition = (v: string): v is OverlayPosition => (OVERLAY_POSITIONS as readonly string[]).includes(v);
const isSize = (v: string): v is OverlaySize => (OVERLAY_SIZES as readonly string[]).includes(v);

/** The overlay with its own position (or, for GENERAL / unknown values, without it: the general one applies). */
function withPosition(overlay: Overlay, value: string): Overlay {
  const { position: _old, ...rest } = overlay;
  return isPosition(value) ? { ...rest, position: value } : rest;
}
function withSize(overlay: Overlay, value: string): Overlay {
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
function textProblem(text: string): string | null {
  const parsed = OverlayTextSchema.safeParse(text);
  if (parsed.success) return null;
  const issue = parsed.error.issues[0];
  if (text.trim() === '') return 'Il testo non può essere vuoto.';
  if (text.trim().length > OVERLAY_TEXT_MAX) return `Al massimo ${OVERLAY_TEXT_MAX} caratteri.`;
  return issue ? `Testo non valido: ${issue.message}.` : 'Testo non valido.';
}

/** A test of an overlay in the preview: what to show and until when. */
interface Trial {
  key: number;
  text: string;
  team: Side | null;
  seconds: number;
  position: OverlayPosition;
  size: OverlaySize;
}

/** Settings of the overlay of one event: on/off, text, duration, priority, position, size, devices, test, default. */
function OverlayRow({
  kind,
  overlay,
  state,
  onChange,
  onTry,
  onReset,
}: {
  kind: OverlayKind;
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
  return (
    <li
      data-overlay-kind={kind}
      className={`space-y-2 rounded-card border bg-surface-2 p-3 ${problem ? 'border-danger' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold text-text">
          <input
            type="checkbox"
            role="switch"
            checked={overlay.enabled}
            onChange={(e) => onChange({ ...overlay, enabled: e.target.checked })}
          />
          {label}
        </label>
        <Button disabled={problem !== null || !state} onClick={onTry} aria-label={`Prova ${label}`}>
          Prova
        </Button>
        <Button variant="ghost" onClick={onReset} aria-label={`Ripristina predefinito ${label}`}>
          Ripristina predefinito
        </Button>
      </div>
      <p className="text-xs text-muted">{hint}</p>
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
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-text">
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
        <label className="flex items-center gap-2 text-sm text-text">
          Posizione
          <select
            className={selectClass}
            aria-label={`Posizione: ${label}`}
            value={overlay.position ?? GENERAL}
            onChange={(e) => onChange(withPosition(overlay, e.target.value))}
          >
            <option value={GENERAL}>Come le impostazioni generali</option>
            {OVERLAY_POSITIONS.map((p) => (
              <option key={p} value={p}>
                {POSITION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          Dimensione
          <select
            className={selectClass}
            aria-label={`Dimensione: ${label}`}
            value={overlay.size ?? GENERAL}
            onChange={(e) => onChange(withSize(overlay, e.target.value))}
          >
            <option value={GENERAL}>Come le impostazioni generali</option>
            {OVERLAY_SIZES.map((z) => (
              <option key={z} value={z}>
                {SIZE_LABELS[z]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">Dispositivi: {label}</legend>
          {LAYOUT_DEVICES.map((device) => (
            <label key={device} className="flex items-center gap-1.5 text-sm text-text">
              <input
                type="checkbox"
                checked={overlay.devices[device]}
                onChange={(e) => onChange({ ...overlay, devices: { ...overlay.devices, [device]: e.target.checked } })}
              />
              {DEVICE_LABELS[device]}
            </label>
          ))}
        </fieldset>
      </div>
    </li>
  );
}

/** Editor of the overlays of the events, with the preview of a test. */
function OverlaysEditor({ tenantName, saved, look }: { tenantName: string; saved: TenantOverlays; look: BlockBrand }) {
  const errorMessage = useApiError();
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [device, setDevice] = useState<LayoutDevice>('tv');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [trial, setTrial] = useState<Trial | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const invalid = OVERLAY_KINDS.some((k) => textProblem(draft[k].text) !== null);

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
  const state = liveState ?? sample;

  // A test stays in the preview for the seconds of its overlay.
  useEffect(() => {
    if (!trial) return;
    const id = setTimeout(() => setTrial(null), trial.seconds * 1000);
    return () => clearTimeout(id);
  }, [trial]);

  const change = (kind: OverlayKind, overlay: Overlay): void => {
    setDraft((d) => ({ ...d, [kind]: overlay }));
    setDone(null);
  };

  const tryOverlay = (kind: OverlayKind): void => {
    if (!state) return;
    const overlay = draft[kind];
    const event = sampleEvent(kind, state);
    const text = overlayText(event, state, overlay);
    const { position, size } = overlayPlacement(draft, overlay);
    setTrial((t) => ({ key: (t?.key ?? 0) + 1, text, team: event.team, seconds: overlay.seconds, position, size }));
    setAnnounce(`Prova di «${OVERLAY_LABELS[kind].label}» nell’anteprima: ${text}`);
  };

  const save = async (): Promise<void> => {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const res = await apiRequest('/api/admin/overlays', OverlaysResponseSchema, { method: 'PUT', body: draft });
      setBase(res.overlays);
      setDraft(res.overlays);
      setDone('Avvisi salvati: valgono da subito per tutti gli spettatori.');
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
      layout={null}
      state={shown}
      look={look}
      fit={fit}
      source={liveState ? 'Dati della partita live.' : 'Partita d’esempio: nessuna partita live in questo momento.'}
    >
      <div className={OVERLAY_REGION_CLASSES[trial?.position ?? draft.position]} data-testid="prova-avviso">
        {trial && (
          <OverlayBanner key={trial.key} text={trial.text} team={trial.team} device={device} size={trial.size} />
        )}
      </div>
    </DevicePreview>
  );

  return (
    <div className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <Card
        title="Avvisi"
        subtitle={`Cliente: ${tenantName}. Messaggi brevi sopra la pagina pubblica quando succede qualcosa in partita.`}
      >
        <div className="space-y-4">
          <div className="rounded-card border border-border bg-surface p-3 text-xs text-muted">
            <p className="font-medium text-text">Segnaposto ammessi nel testo</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {OVERLAY_PLACEHOLDERS.map((p) => (
                <li key={p}>
                  <code className="text-text">{`{${p}}`}</code> {PLACEHOLDER_LABELS[p]}
                </li>
              ))}
            </ul>
            <p className="mt-1">
              Solo testo semplice: niente HTML né altri segnaposto. Un segnaposto senza valore (es. nessun giocatore)
              resta vuoto. Con più avvisi insieme si mostra prima quello con la priorità più alta.
            </p>
          </div>
          <fieldset className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-3">
            <legend className="px-1 text-sm font-medium text-text">Posizione e dimensione di tutti gli avvisi</legend>
            <label className="flex items-center gap-2 text-sm text-text">
              Posizione
              <select
                className={selectClass}
                value={draft.position}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isPosition(value)) setDraft((d) => ({ ...d, position: value }));
                  setDone(null);
                }}
              >
                {OVERLAY_POSITIONS.map((p) => (
                  <option key={p} value={p}>
                    {POSITION_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-text">
              Dimensione
              <select
                className={selectClass}
                value={draft.size}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isSize(value)) setDraft((d) => ({ ...d, size: value }));
                  setDone(null);
                }}
              >
                {OVERLAY_SIZES.map((z) => (
                  <option key={z} value={z}>
                    {SIZE_LABELS[z]}
                  </option>
                ))}
              </select>
            </label>
            <p className="basis-full text-xs text-muted">
              Valgono per tutti gli avvisi; ogni avviso può avere la sua. Al centro l’avviso non blocca i tocchi sulla
              pagina; in alto sta sotto il tabellone, in basso sopra il banner delle pause.
            </p>
          </fieldset>
          <p aria-live="polite" className="sr-only">
            {announce}
          </p>
          <ul aria-label="Eventi" className="space-y-2">
            {OVERLAY_KINDS.map((kind) => (
              <OverlayRow
                key={kind}
                kind={kind}
                overlay={draft[kind]}
                state={state}
                onChange={(o) => change(kind, o)}
                onTry={() => tryOverlay(kind)}
                onReset={() => {
                  change(kind, defaultOverlay(kind));
                  setAnnounce(`Impostazioni predefinite per ${OVERLAY_LABELS[kind].label}.`);
                }}
              />
            ))}
          </ul>
          {error && <ErrorBox>{error}</ErrorBox>}
          {done && (
            <p role="status" className="rounded-card bg-success-soft px-3 py-2 text-sm text-text">
              {done}
            </p>
          )}
          {invalid && (
            <p role="alert" className="text-sm text-danger">
              Alcuni testi non sono validi (vuoti, troppo lunghi o con segnaposto sconosciuti): correggili prima di
              salvare.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !dirty || invalid} onClick={() => void save()}>
              {busy ? 'Salvataggio…' : 'Salva'}
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
        subtitle="«Prova» mostra qui l’avviso, con le modifiche non ancora salvate."
        fullscreen={state ? preview(state, true) : null}
      >
        <div className="space-y-3">
          <TabList
            label="Dispositivo dell’anteprima"
            tabs={LAYOUT_DEVICES.map((d) => ({ value: d, label: DEVICE_LABELS[d] }))}
            value={device}
            onChange={setDevice}
            idPrefix="anteprima-avvisi"
            panelId="pannello-anteprima-avvisi"
          />
          <div id="pannello-anteprima-avvisi" role="tabpanel" aria-labelledby={`anteprima-avvisi-${device}`}>
            {state ? preview(state, false) : <Spinner label="Preparazione dell’anteprima…" />}
          </div>
        </div>
      </PreviewDock>
    </div>
  );
}

/** Page «Avvisi» (admin): the overlays of the events of the match on the public page of the client. */
export function OverlaysPage() {
  const errorMessage = useApiError();
  const loadOverlays = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/overlays', OverlaysResponseSchema, { signal }),
    [],
  );
  const loadBranding = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/branding', BrandingResponseSchema, { signal }),
    [],
  );
  const overlays = useAsync(loadOverlays);
  const branding = useAsync(loadBranding);

  useEffect(() => {
    document.title = 'Avvisi · Area riservata';
  }, []);

  const look = useMemo(() => (branding.data ? blockBrandOf(branding.data) : null), [branding.data]);

  for (const part of [overlays, branding]) {
    if (part.error !== null) return <ErrorBox onRetry={part.reload}>{errorMessage(part.error)}</ErrorBox>;
  }
  if (!overlays.data || !look) return <Spinner label="Caricamento degli avvisi…" />;
  return <OverlaysEditor tenantName={overlays.data.tenantName} saved={overlays.data.overlays} look={look} />;
}
