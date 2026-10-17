import type {
  AssetListResponse,
  BrandingResponse,
  IntermissionKind,
  LayoutDevice,
  OverlayKind,
  TenantBranding,
  TenantIntermissions,
  TenantLayout,
  TenantOverlays,
} from '@sir/shared';
import {
  AssetListResponseSchema,
  BrandingResponseSchema,
  IntermissionsResponseSchema,
  LAYOUT_DEVICES,
  LayoutResponseSchema,
  OVERLAY_KINDS,
  OverlaysResponseSchema,
  publicAssetPath,
} from '@sir/shared';
import type { MatchState } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { loadSampleMatch } from '../../../blocks/sampleMatch.ts';
import { Button, buttonClass, ErrorBox, Spinner } from '../../../components/ui.tsx';
import { apiRequest } from '../../../lib/api.ts';
import { initBranding } from '../../../lib/branding.ts';
import { useAsync } from '../../../lib/useAsync.ts';
import { useViewportWidth } from '../../../lib/useLayout.ts';
import { socketUrl, useLiveSocket } from '../../../lib/useLiveSocket.ts';
import { useApiError, useAuth } from '../auth.tsx';
import { pauseProblems } from '../intermissionEditor.ts';
import { layoutProblems } from '../layoutEditor.ts';
import { blockBrandOf } from './blockEditors.tsx';
import type { ColorsTab } from './ColorsSection.tsx';
import { ColorsSection } from './ColorsSection.tsx';
import type { StudioChange, StudioDocs, StudioScene, StudioSection, StudioTarget } from './model.ts';
import {
  autoScene,
  brandingChanges,
  DEVICE_LABELS,
  intermissionChanges,
  isFirstAccess,
  isStudioSection,
  layoutChanges,
  overlayChanges,
  pauseKindOf,
  sameValue,
  sampleWithOurTeam,
  SECTION_LABELS,
  STUDIO_SECTIONS,
  studioPath,
} from './model.ts';
import type { OverlaysTab } from './OverlaysSection.tsx';
import { OverlaysSection, overlaySettingId, textProblem } from './OverlaysSection.tsx';
import { blockSettingId, PageSection } from './PageSection.tsx';
import type { SetTab } from './PausesSection.tsx';
import { PausesSection, pauseTargetOf, slideSettingId } from './PausesSection.tsx';
import type { OverlayTrial, StudioHighlight } from './StudioPreview.tsx';
import { StudioPreview } from './StudioPreview.tsx';
import { settingDomId, StudioUiContext } from './StudioUi.tsx';
import { StudioWizard } from './StudioWizard.tsx';

/** Below this width the Studio is in steps: sections, then settings, then «Vedi anteprima». */
export const STUDIO_PHONE_MAX = 768;

type Step = 'sezioni' | 'impostazioni' | 'anteprima';

/** Saved document and draft of one section. */
interface Pair<T> {
  base: T;
  draft: T;
}
const pairOf = <T,>(value: T): Pair<T> => ({ base: value, draft: value });

/** Key of localStorage: the guided setup of this client was closed once (it does not open by itself again). */
export const wizardSeenKey = (tenantId: string): string => `sir-studio-guidata:${tenantId}`;
function wizardSeen(tenantId: string): boolean {
  try {
    return window.localStorage.getItem(wizardSeenKey(tenantId)) === '1';
  } catch {
    return false;
  }
}
function rememberWizard(tenantId: string): void {
  try {
    window.localStorage.setItem(wizardSeenKey(tenantId), '1');
  } catch {
    // Private mode: it will open again next time, nothing else.
  }
}

/** Key of localStorage: the preview was made wider («Allarga anteprima»), remembered on this browser. */
export const PREVIEW_WIDE_KEY = 'sir-studio-anteprima-larga';
function previewWideSaved(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_WIDE_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberPreviewWide(wide: boolean): void {
  try {
    if (wide) window.localStorage.setItem(PREVIEW_WIDE_KEY, '1');
    else window.localStorage.removeItem(PREVIEW_WIDE_KEY);
  } catch {
    // Private mode: not remembered.
  }
}

const SAVED_TEXT: Record<StudioSection, string> = {
  colori: 'Grafica salvata: la pagina pubblica la usa da subito.',
  pagina: 'Pagina pubblica salvata: la vedono da subito tutti gli spettatori.',
  pause: 'Pause salvate: valgono da subito per tutti gli spettatori.',
  avvisi: 'Avvisi salvati: valgono da subito per tutti gli spettatori.',
};

/** Block types whose colours are the team colours: a click on them in «Colori e loghi» opens the colours. */
const TEAM_COLOR_TYPES = new Set(['scoreboard', 'comparison', 'momentum', 'teamDuel']);

type Guard = { kind: 'section'; to: StudioSection } | { kind: 'leave'; href: string };

function Studio({
  tenantId,
  tenantName,
  saved,
  assets,
  onAssetsChanged,
  hasSection,
}: {
  tenantId: string;
  tenantName: string;
  saved: StudioDocs;
  assets: AssetListResponse;
  onAssetsChanged: () => void;
  /** The address names a section (the phone opens it at once instead of the list of sections). */
  hasSection: boolean;
}) {
  const params = useParams();
  const navigate = useNavigate();
  const errorMessage = useApiError();
  const section: StudioSection = isStudioSection(params.section) ? params.section : 'colori';
  const phone = useViewportWidth() < STUDIO_PHONE_MAX;

  const [branding, setBranding] = useState<Pair<TenantBranding>>(() => pairOf(saved.branding));
  const [layout, setLayout] = useState<Pair<TenantLayout>>(() => pairOf(saved.layout));
  const [intermissions, setIntermissions] = useState<Pair<TenantIntermissions>>(() => pairOf(saved.intermissions));
  const [overlays, setOverlays] = useState<Pair<TenantOverlays>>(() => pairOf(saved.overlays));

  const [device, setDevice] = useState<LayoutDevice>('tv');
  const [colorsTab, setColorsTab] = useState<ColorsTab>('colori');
  const [pauseKind, setPauseKind] = useState<IntermissionKind>('setBreak');
  const [setTab, setSetTab] = useState<SetTab>('all');
  const [overlayKind, setOverlayKind] = useState<OverlayKind>('ace');
  const [overlaysTab, setOverlaysTab] = useState<OverlaysTab>('eventi');
  const [scene, setScene] = useState<StudioScene>(() => autoScene(section, 'setBreak'));
  const [shownSection, setShownSection] = useState(section);
  const [step, setStep] = useState<Step>(hasSection ? 'impostazioni' : 'sezioni');
  const [highlight, setHighlight] = useState<StudioHighlight | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [trial, setTrial] = useState<OverlayTrial | null>(null);
  const [saving, setSaving] = useState<StudioSection | 'guidata' | null>(null);
  const [errors, setErrors] = useState<Partial<Record<StudioSection | 'guidata', string>>>({});
  const [done, setDone] = useState<string | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [guard, setGuard] = useState<Guard | null>(null);
  const [wizard, setWizard] = useState(() => isFirstAccess(saved) && !wizardSeen(tenantId));
  const [announce, setAnnounce] = useState('');
  const [wide, setWide] = useState(previewWideSaved);
  const toggleWide = useCallback(() => {
    setWide((w) => {
      rememberPreviewWide(!w);
      return !w;
    });
  }, []);
  const changesId = useId();

  // A new section (menu, address, a click in the preview): the preview takes its scene by itself.
  if (shownSection !== section) {
    setShownSection(section);
    setScene(autoScene(section, pauseKind));
    setShowChanges(false);
  }

  const docs: StudioDocs = useMemo(
    () => ({
      branding: branding.draft,
      layout: layout.draft,
      intermissions: intermissions.draft,
      overlays: overlays.draft,
    }),
    [branding.draft, layout.draft, intermissions.draft, overlays.draft],
  );
  const changes: Record<StudioSection, StudioChange[]> = useMemo(
    () => ({
      colori: brandingChanges(branding.base, branding.draft),
      pagina: layoutChanges(layout.base, layout.draft),
      pause: intermissionChanges(intermissions.base, intermissions.draft),
      avvisi: overlayChanges(overlays.base, overlays.draft),
    }),
    [branding, layout, intermissions, overlays],
  );
  const dirty: Record<StudioSection, boolean> = {
    colori: !sameValue(branding.base, branding.draft),
    pagina: !sameValue(layout.base, layout.draft),
    pause: !sameValue(intermissions.base, intermissions.draft),
    avvisi: !sameValue(overlays.base, overlays.draft),
  };
  const anyDirty = Object.values(dirty).some(Boolean);
  const layoutIssues = useMemo(() => layoutProblems(layout.draft), [layout.draft]);
  const invalid: Record<StudioSection, string | null> = {
    colori: null,
    pagina:
      Object.keys(layoutIssues).length > 0
        ? `Alcuni blocchi hanno opzioni non valide (${LAYOUT_DEVICES.filter((d) => layoutIssues[d])
            .map((d) => DEVICE_LABELS[d])
            .join(', ')}): correggile prima di salvare.`
        : null,
    pause:
      pauseProblems(intermissions.draft).size > 0
        ? 'Alcune pause hanno impostazioni non valide (una pausa attiva senza diapositive o un testo vuoto): correggile prima di salvare.'
        : null,
    avvisi: OVERLAY_KINDS.some((k) => textProblem(overlays.draft[k].text) !== null)
      ? 'Alcuni testi non sono validi (vuoti, troppo lunghi o con segnaposto sconosciuti): correggili prima di salvare.'
      : null,
  };

  // Example match (or the live one) of the preview, with the team of the client as the home team.
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
  const name = branding.draft.displayName ?? tenantName;
  const previewMatch = useMemo(
    () => liveState ?? (sample ? sampleWithOurTeam(sample, branding.draft.ourTeam, name) : null),
    [liveState, sample, branding.draft.ourTeam, name],
  );
  const look = useMemo(
    () => blockBrandOf({ tenantName, branding: branding.draft } satisfies BrandingResponse),
    [tenantName, branding.draft],
  );
  const sponsorLogo = branding.draft.sponsorLogo ? publicAssetPath(branding.draft.sponsorLogo) : null;

  useEffect(() => {
    document.title = 'Studio grafico · Area riservata';
  }, []);

  // The browser asks before leaving the page with changes not saved.
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [anyDirty]);

  // A link out of the Studio (side menu, …) with changes not saved: first a question.
  useEffect(() => {
    if (!anyDirty) return;
    const onClick = (e: MouseEvent): void => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith('/admin/studio')) return;
      e.preventDefault();
      e.stopPropagation();
      setGuard({ kind: 'leave', href: `${url.pathname}${url.search}` });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [anyDirty]);

  // A setting opened from the preview: its tab is shown, then it is scrolled into view, focused and marked a moment.
  useEffect(() => {
    if (!flash) return;
    const el = document.getElementById(settingDomId(flash));
    if (!el) return;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
    const id = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(id);
  }, [flash, section, step, colorsTab, pauseKind, setTab, overlayKind, overlaysTab, device]);

  // A «Prova» stays for the seconds of its overlay.
  useEffect(() => {
    if (!trial) return;
    const id = setTimeout(() => setTrial(null), overlays.draft[trial.kind].seconds * 1000);
    return () => clearTimeout(id);
  }, [trial, overlays.draft]);

  const goSection = (to: StudioSection, force = false): void => {
    if (to === section) {
      setStep('impostazioni');
      return;
    }
    if (!force && dirty[section]) {
      setGuard({ kind: 'section', to });
      return;
    }
    setStep('impostazioni');
    void navigate(studioPath(to));
  };

  const saveSection = async (s: StudioSection): Promise<boolean> => {
    setErrors((e) => ({ ...e, [s]: undefined }));
    setSaving(s);
    try {
      if (s === 'colori') {
        const res = await apiRequest('/api/admin/branding', BrandingResponseSchema, {
          method: 'PUT',
          body: branding.draft,
        });
        setBranding(pairOf(res.branding));
      } else if (s === 'pagina') {
        const res = await apiRequest('/api/admin/layout', LayoutResponseSchema, { method: 'PUT', body: layout.draft });
        setLayout(pairOf(res.layout));
      } else if (s === 'pause') {
        const res = await apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, {
          method: 'PUT',
          body: intermissions.draft,
        });
        setIntermissions(pairOf(res.intermissions));
      } else {
        const res = await apiRequest('/api/admin/overlays', OverlaysResponseSchema, {
          method: 'PUT',
          body: overlays.draft,
        });
        setOverlays(pairOf(res.overlays));
      }
      setDone(SAVED_TEXT[s]);
      setShowChanges(false);
      // The portal (and the reserved area of the same client) reads its graphics again.
      void initBranding({ fresh: true });
      return true;
    } catch (err) {
      setErrors((e) => ({ ...e, [s]: errorMessage(err) }));
      return false;
    } finally {
      setSaving(null);
    }
  };

  const undo = (s: StudioSection): void => {
    if (s === 'colori') setBranding((p) => pairOf(p.base));
    else if (s === 'pagina') setLayout((p) => pairOf(p.base));
    else if (s === 'pause') setIntermissions((p) => pairOf(p.base));
    else setOverlays((p) => pairOf(p.base));
    setShowChanges(false);
    setAnnounce(`Modifiche di «${SECTION_LABELS[s]}» annullate.`);
  };

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(null), 4000);
    return () => clearTimeout(id);
  }, [done]);

  const closeWizard = useCallback(() => {
    rememberWizard(tenantId);
    setWizard(false);
  }, [tenantId]);

  const finishWizard = async (): Promise<void> => {
    setSaving('guidata');
    let ok = true;
    for (const s of ['colori', 'pagina', 'pause'] as const)
      if (dirty[s] && !invalid[s]) ok = (await saveSection(s)) && ok;
    setSaving(null);
    if (ok) closeWizard();
    else setErrors((e) => ({ ...e, guidata: 'Non tutto è stato salvato: controlla le sezioni segnate.' }));
  };

  const showScene = useCallback(
    (s: StudioScene): void => {
      setScene(s);
      if (phone) setStep('anteprima');
    },
    [phone],
  );

  /** Opens the setting of an element clicked in the preview (its section, its tab), then marks it. */
  const pick = (target: StudioTarget): void => {
    let to: StudioSection;
    let id: string;
    const kind = pauseKindOf(scene) ?? pauseKind;
    if (target === 'overlay') {
      to = 'avvisi';
      setOverlaysTab('eventi');
      const k = trial?.kind ?? overlayKind;
      setOverlayKind(k);
      id = overlaySettingId(k);
    } else if (target === 'pause' || target.startsWith('slide:')) {
      to = 'pause';
      setPauseKind(kind);
      id = target === 'pause' ? 'pause-enabled' : slideSettingId(pauseTargetOf(kind, setTab), target.slice(6));
    } else if (target.startsWith('block:')) {
      const block = layout.draft[device].find((b) => b.id === target.slice(6));
      if (section === 'colori' && block && TEAM_COLOR_TYPES.has(block.type)) {
        to = 'colori';
        setColorsTab('colori');
        id = 'color-home';
      } else {
        to = 'pagina';
        id = blockSettingId(device, target.slice(6));
      }
    } else {
      to = 'colori';
      setColorsTab('colori');
      id = 'color-background';
    }
    setFlash(id);
    if (to === section) setStep('impostazioni');
    else goSection(to);
  };

  const ui = useMemo(
    () => ({
      hover: (targets: readonly StudioTarget[] | null, s: StudioScene | null) =>
        setHighlight(targets && targets.length > 0 ? { targets, scene: s } : null),
      showScene,
      flash,
    }),
    [flash, showScene],
  );

  const pauseTarget = pauseTargetOf(pauseKind, setTab);
  const preview = (toolbar: boolean, forcedScene?: StudioScene) => (
    <StudioPreview
      device={toolbar ? device : 'tv'}
      onDevice={setDevice}
      scene={forcedScene ?? scene}
      onScene={setScene}
      state={previewMatch}
      live={liveState !== null}
      docs={docs}
      look={look}
      sponsorLogo={sponsorLogo}
      pauseTarget={pauseTarget}
      overlayKind={overlayKind}
      trial={trial}
      highlight={toolbar ? highlight : null}
      onPick={toolbar ? pick : () => undefined}
      toolbar={toolbar}
      {...(toolbar && !phone ? { wide, onWide: toggleWide } : {})}
    />
  );

  let panel: ReactNode;
  if (section === 'colori')
    panel = (
      <ColorsSection
        tenantName={tenantName}
        draft={branding.draft}
        base={branding.base}
        onChange={(c) => setBranding((p) => ({ ...p, draft: c(p.draft) }))}
        assets={assets}
        onAssetsChanged={onAssetsChanged}
        tab={colorsTab}
        onTab={setColorsTab}
      />
    );
  else if (section === 'pagina')
    panel = (
      <PageSection
        draft={layout.draft}
        onChange={(c) => setLayout((p) => ({ ...p, draft: c(p.draft) }))}
        device={device}
        onDevice={(d) => {
          setDevice(d);
          setScene('play');
        }}
        problems={layoutIssues}
        assets={assets}
        onAssetsChanged={onAssetsChanged}
        template={branding.base.template}
      />
    );
  else if (section === 'pause')
    panel = (
      <PausesSection
        draft={intermissions.draft}
        onChange={(c) => setIntermissions((p) => ({ ...p, draft: c(p.draft) }))}
        kind={pauseKind}
        onKind={(k) => {
          setPauseKind(k);
          setScene(k);
        }}
        setTab={setTab}
        onSetTab={(t) => {
          setSetTab(t);
          setScene('setBreak');
        }}
        assets={assets}
        onAssetsChanged={onAssetsChanged}
      />
    );
  else
    panel = (
      <OverlaysSection
        draft={overlays.draft}
        onChange={(c) => setOverlays((p) => ({ ...p, draft: c(p.draft) }))}
        kind={overlayKind}
        onKind={(k) => {
          setOverlayKind(k);
          setScene('overlay');
        }}
        tab={overlaysTab}
        onTab={setOverlaysTab}
        state={previewMatch}
        onTry={(k) => {
          setOverlayKind(k);
          setScene('overlay');
          setTrial((t) => ({ key: (t?.key ?? 0) + 1, kind: k }));
          if (phone) setStep('anteprima');
          setAnnounce(`Prova dell’avviso nell’anteprima.`);
        }}
      />
    );

  const current = STUDIO_SECTIONS.find((s) => s.id === section) ?? {
    id: section,
    label: SECTION_LABELS[section],
    description: '',
  };
  const count = Math.max(dirty[section] ? 1 : 0, changes[section].length);
  const wizardButton = (
    <Button onClick={() => setWizard(true)} className="shrink-0">
      Configurazione guidata
    </Button>
  );
  // «Allarga anteprima»: the sections become a thin column of short names, the settings narrower.
  const narrow = wide && !phone;
  const sections = (
    <nav aria-label="Sezioni dello Studio" className="flex flex-col gap-1">
      {STUDIO_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-current={s.id === section ? 'page' : undefined}
          onClick={() => goSection(s.id)}
          title={narrow ? s.label : undefined}
          className={`flex flex-col rounded-card border text-left ${narrow ? 'items-center px-1 py-2' : 'px-3 py-2'} ${
            s.id === section
              ? 'border-border bg-surface-2 shadow-[inset_3px_0_0_var(--sir-primary)]'
              : 'border-transparent hover:bg-hover'
          } max-md:min-h-14`}
        >
          <span
            className={`flex items-center gap-1.5 font-semibold text-text ${narrow ? 'flex-col gap-0 text-xs' : 'text-sm'}`}
          >
            {narrow ? (
              <>
                <span className="sr-only">{s.label}</span>
                <span aria-hidden="true">{s.short}</span>
              </>
            ) : (
              s.label
            )}
            {dirty[s.id] && (
              <span className="text-xs text-warn" title="Modifiche non salvate">
                ● <span className="sr-only">modifiche non salvate</span>
              </span>
            )}
          </span>
          {!narrow && <span className="text-xs text-muted">{s.description}</span>}
        </button>
      ))}
    </nav>
  );

  const header = (
    <header className="flex flex-wrap items-center gap-3 pb-3">
      {phone && step !== 'sezioni' && (
        <Button
          variant="ghost"
          onClick={() => setStep(step === 'anteprima' ? 'impostazioni' : 'sezioni')}
          aria-label={step === 'anteprima' ? 'Indietro alle impostazioni' : 'Indietro alle sezioni'}
        >
          ← Indietro
        </Button>
      )}
      <h1 className="text-xl font-semibold text-text">
        Studio grafico
        {phone && step !== 'sezioni' && <span className="block text-sm font-normal text-muted">{current.label}</span>}
      </h1>
      {anyDirty && (
        <span role="status" className="text-xs text-warn">
          ● Modifiche non salvate
        </span>
      )}
      <span className="flex-1" />
      {(!phone || step === 'sezioni') && wizardButton}
    </header>
  );

  const busy = saving !== null;
  const saveBar = dirty[section] && (
    <div
      role="region"
      aria-label="Modifiche non salvate"
      className="fixed inset-x-2 bottom-2 z-40 mx-auto max-w-2xl rounded-panel border border-border bg-surface p-3 shadow-card md:bottom-4"
    >
      {showChanges && (
        <div id={changesId} className="sir-thin-scroll mb-2 max-h-[40dvh] overflow-y-auto">
          <h2 className="mb-1 text-sm font-semibold text-text">Modifiche da salvare in «{current.label}»</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {changes[section].map((c, i) => (
              <li key={`${c.label}-${i}`}>
                <b className="font-medium text-text">{c.label}</b>: {c.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {invalid[section] && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {invalid[section]}
        </p>
      )}
      {errors[section] && <ErrorBox>{errors[section]}</ErrorBox>}
      <div className="flex flex-wrap items-center gap-2">
        <b className="mr-auto text-sm font-semibold text-warn">
          {count === 1 ? '1 modifica non salvata' : `${count} modifiche non salvate`}
        </b>
        <Button
          variant="ghost"
          aria-expanded={showChanges}
          aria-controls={changesId}
          onClick={() => setShowChanges((o) => !o)}
        >
          Vedi modifiche
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => undo(section)}>
          Annulla modifiche
        </Button>
        <Button
          variant="primary"
          disabled={busy || invalid[section] !== null}
          onClick={() => void saveSection(section)}
        >
          {saving === section ? 'Salvataggio…' : 'Salva'}
        </Button>
      </div>
    </div>
  );

  const panelBox = (
    <div className="space-y-3 pb-28">
      <div>
        <h2 className="text-base font-semibold text-text">{current.label}</h2>
        <p className="text-xs text-muted">{current.description}.</p>
      </div>
      {panel}
    </div>
  );

  return (
    <StudioUiContext.Provider value={ui}>
      <div
        data-testid="studio"
        data-step={phone ? step : undefined}
        className={
          phone ? 'flex flex-col' : 'flex h-[calc(100dvh-2.5rem)] min-h-[32rem] flex-col lg:h-[calc(100dvh-3.5rem)]'
        }
      >
        {header}
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
        {phone ? (
          <div className="min-h-0 flex-1">
            {step === 'sezioni' && sections}
            {step === 'impostazioni' && panelBox}
            {step === 'anteprima' && (
              <div className="h-[calc(100dvh-9rem)] rounded-panel border border-border bg-bg">{preview(true)}</div>
            )}
            {step === 'impostazioni' && (
              <Button
                variant="primary"
                onClick={() => setStep('anteprima')}
                className={`fixed right-3 z-30 shadow-card ${dirty[section] ? 'bottom-36' : 'bottom-4'}`}
              >
                Vedi anteprima
              </Button>
            )}
          </div>
        ) : (
          <div
            data-testid="studio-colonne"
            data-wide={narrow}
            className={`grid min-h-0 flex-1 overflow-hidden rounded-panel border border-border ${
              narrow
                ? 'grid-cols-[3.75rem_minmax(16rem,19rem)_minmax(0,1fr)] xl:grid-cols-[3.75rem_minmax(17rem,21rem)_minmax(0,1fr)]'
                : 'grid-cols-[9.5rem_minmax(17rem,22rem)_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(20rem,25rem)_minmax(0,1fr)]'
            }`}
          >
            <div
              className={`sir-thin-scroll relative min-h-0 overflow-y-auto border-r border-border bg-surface ${narrow ? 'p-1' : 'p-2'}`}
            >
              {sections}
            </div>
            <div
              className="sir-thin-scroll relative min-h-0 overflow-y-auto border-r border-border p-3"
              data-testid="studio-impostazioni"
            >
              {panelBox}
            </div>
            <div className="min-h-0 min-w-0 bg-bg">{preview(true)}</div>
          </div>
        )}
      </div>
      {saveBar}
      {done && (
        <p
          role="status"
          className="fixed right-4 top-4 z-50 rounded-card border border-border bg-success-soft px-4 py-2 text-sm text-text shadow-card"
        >
          {done}
        </p>
      )}
      {guard && (
        <GuardDialog
          guard={guard}
          section={section}
          count={count}
          dirtyLabels={STUDIO_SECTIONS.filter((s) => dirty[s.id]).map((s) => s.label)}
          canSave={invalid[section] === null}
          busy={busy}
          onSave={async () => {
            if (guard.kind !== 'section') return;
            if (await saveSection(section)) {
              setGuard(null);
              goSection(guard.to, true);
            }
          }}
          onContinue={() => {
            setGuard(null);
            if (guard.kind === 'section') goSection(guard.to, true);
            else void navigate(guard.href);
          }}
          onStay={() => {
            setGuard(null);
            setFlash(null);
          }}
        />
      )}
      {wizard && (
        <StudioWizard
          tenantName={tenantName}
          branding={branding.draft}
          layout={layout.draft}
          intermissions={intermissions.draft}
          onBranding={(c) => setBranding((p) => ({ ...p, draft: c(p.draft) }))}
          onLayout={(c) => setLayout((p) => ({ ...p, draft: c(p.draft) }))}
          onIntermissions={(c) => setIntermissions((p) => ({ ...p, draft: c(p.draft) }))}
          assets={assets}
          onAssetsChanged={onAssetsChanged}
          preview={(s) => preview(false, s)}
          busy={saving !== null}
          error={errors.guidata ?? null}
          onClose={closeWizard}
          onFinish={() => void finishWizard()}
        />
      )}
    </StudioUiContext.Provider>
  );
}

/** Question before leaving a section (or the Studio) with changes not saved. */
function GuardDialog({
  guard,
  section,
  count,
  dirtyLabels,
  canSave,
  busy,
  onSave,
  onContinue,
  onStay,
}: {
  guard: Guard;
  section: StudioSection;
  count: number;
  dirtyLabels: string[];
  canSave: boolean;
  busy: boolean;
  onSave: () => Promise<void>;
  onContinue: () => void;
  onStay: () => void;
}) {
  const titleId = useId();
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onStay();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStay]);
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-bg/80 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md space-y-3 rounded-panel border border-border bg-surface p-5 shadow-card"
      >
        <h2 id={titleId} className="text-lg font-semibold text-text">
          Modifiche non salvate
        </h2>
        {guard.kind === 'section' ? (
          <p className="text-sm text-text">
            In «{SECTION_LABELS[section]}» ci sono{' '}
            {count === 1 ? '1 modifica non salvata' : `${count} modifiche non salvate`}. Le salvi prima di passare a «
            {SECTION_LABELS[guard.to]}»? Se continui senza salvare restano in sospeso, segnate con ●.
          </p>
        ) : (
          <p className="text-sm text-text">
            Ci sono modifiche non salvate in: {dirtyLabels.join(', ')}. Uscendo dallo Studio vanno perse.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={stay} type="button" className={buttonClass('ghost')} onClick={onStay}>
            Resta qui
          </button>
          <Button onClick={onContinue}>
            {guard.kind === 'section' ? 'Continua senza salvare' : 'Esci senza salvare'}
          </Button>
          {guard.kind === 'section' && (
            <Button variant="primary" disabled={!canSave || busy} onClick={() => void onSave()}>
              Salva e continua
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Page «Studio grafico» (`/admin/studio/:sezione`): in place of the pages «Grafica», «Pagina pubblica», «Pause» and
 * «Avvisi». Three columns: the sections (Colori e loghi, Pagina live, Pause, Avvisi), a few settings at a time in tabs
 * (the less used under «Avanzate»), the big preview always in view with device and scene. Every section is saved on
 * its own (its route PUT /api/admin/branding, /layout, /intermissions, /overlays), with the bar of the changes not
 * saved. On the phone the page is in steps. The guided setup opens by itself at the first visit of a client with
 * nothing saved.
 */
export function StudioPage() {
  const errorMessage = useApiError();
  const { user } = useAuth();
  const params = useParams();
  const loadBranding = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/branding', BrandingResponseSchema, { signal }),
    [],
  );
  const loadLayout = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/layout', LayoutResponseSchema, { signal }),
    [],
  );
  const loadPauses = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/intermissions', IntermissionsResponseSchema, { signal }),
    [],
  );
  const loadOverlays = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/overlays', OverlaysResponseSchema, { signal }),
    [],
  );
  const loadAssets = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const branding = useAsync(loadBranding);
  const layout = useAsync(loadLayout);
  const pauses = useAsync(loadPauses);
  const overlays = useAsync(loadOverlays);
  const assets = useAsync(loadAssets);

  for (const part of [branding, layout, pauses, overlays]) {
    if (part.error !== null) return <ErrorBox onRetry={part.reload}>{errorMessage(part.error)}</ErrorBox>;
  }
  if (assets.error !== null && !assets.data)
    return <ErrorBox onRetry={assets.reload}>{errorMessage(assets.error)}</ErrorBox>;
  if (!branding.data || !layout.data || !pauses.data || !overlays.data || !assets.data)
    return <Spinner label="Caricamento dello Studio grafico…" />;
  return (
    <Studio
      tenantId={user.tenant?.id ?? 'nessun-cliente'}
      tenantName={branding.data.tenantName}
      saved={{
        branding: branding.data.branding,
        layout: layout.data.layout,
        intermissions: pauses.data.intermissions,
        overlays: overlays.data.overlays,
      }}
      assets={assets.data}
      onAssetsChanged={assets.reload}
      hasSection={isStudioSection(params.section)}
    />
  );
}
