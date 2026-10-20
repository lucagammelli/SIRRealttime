import { QR_QUERY_PARAM, SHARE_TOKEN_PATTERN } from '@arenalive/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { FullscreenHint, InstallButton } from '../components/AppInstall.tsx';
import { Intermission } from '../components/Intermission.tsx';
import { LiveMatch } from '../components/LiveMatch.tsx';
import { Overlay } from '../components/Overlay.tsx';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { SystemLogosBar } from '../components/SystemLogosBar.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import type { ProbeResult } from '../lib/liveConnection.ts';
import { registerServiceWorker, useFullscreenOnFirstTouch, useInstallApp } from '../lib/pwa.ts';
import { useIdle, useTvRootClass, useWakeLock } from '../lib/tvScreen.ts';
import { tvModeOf } from '../lib/layout.ts';
import { useDevice } from '../lib/useLayout.ts';
import { socketUrl, useLiveSocket } from '../lib/useLiveSocket.ts';
import { usePointSequence } from '../lib/pointSequence.ts';
import { makeHello, newVisitId } from '../lib/visit.ts';
import {
  useBrandName,
  useTemplate,
  useTenantIntermissions,
  useTenantLook,
  useTenantOverlays,
} from '../lib/branding.ts';
import { teamName } from '../lib/format.ts';

/** Wait when a 503/429 has no readable Retry-After. */
const DEFAULT_RETRY_AFTER_MS = 20_000;
/** Longest wait accepted from a Retry-After. */
const MAX_RETRY_AFTER_MS = 5 * 60_000;

/** Retry-After in seconds (the only form the server sends) as milliseconds, capped. */
export function retryAfterMs(header: string | null): number {
  const seconds = header === null ? Number.NaN : Number(header.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
}

/**
 * HTTP check of a public link when the socket cannot open (the browser hides the status of the upgrade): 404 the
 * link is invalid; 503 (server full) or 429 (too many requests) wait the Retry-After.
 */
export async function probeShareToken(token: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(`/api/public/${encodeURIComponent(token)}/state`, {
      cache: 'no-store',
      credentials: 'omit',
    });
    if (res.status === 404) return 'invalid';
    if (res.status === 503 || res.status === 429) return { retryAfterMs: retryAfterMs(res.headers.get('retry-after')) };
    return 'ok';
  } catch {
    return 'ok';
  }
}

/**
 * Public page `/live/:token`: only the match, no link to the reserved area. Laid out for the device (`deviceFor`):
 * smartphone (< 768 px, held sideways laid out as a tablet), tablet and desktop, big screen (≥ 1600 × 800 px and 16:10, `?tv=1`, or full screen from tablet up; never
 * with `?tv=0`): no scrolling, text scaled with the screen, pointer hidden after 3 s, screen kept on, rotation of the
 * groups that the viewer can stop. The blocks are the ones chosen by the client for the device (page «Pagina pubblica»
 * of the reserved area), the defaults until its graphics are loaded. In the pauses of the match (time-out, end of set,
 * end of match) the pause chosen by the client (page «Pause») goes over the page or at its bottom: none while
 * its graphics are loading, the default pauses when they cannot be loaded. The events of the match that arrive live
 * (ace, set point, ...) show an overlay for a few seconds as chosen by the client (page «Avvisi»), never over a full
 * screen pause. During the set the «ogni N punti» pause opens with the live updates only.
 */
export function LivePage() {
  const { token = '' } = useParams();
  const [search] = useSearchParams();
  const valid = SHARE_TOKEN_PATTERN.test(token);
  const [fullscreen, setFullscreen] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);
  const device = useDevice(tvModeOf(search.get('tv')), fullscreen);
  const tv = device === 'tv';
  useTvRootClass(tv);
  useWakeLock(tv);
  const idle = useIdle(tv);
  // App: minimal service worker (only for the installation), «Installa come app», full screen at the first touch.
  const app = useInstallApp();
  const fullscreenHint = useFullscreenOnFirstTouch(valid && !fullscreen);
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  const probe = useCallback(() => probeShareToken(token), [token]);
  // Statistics of the visits: the page says how it was opened (QR or link, device, app); the id lives in memory only.
  const [visitId] = useState(newVisitId);
  const deviceNow = useRef(device);
  useEffect(() => {
    deviceNow.current = device;
  }, [device]);
  const sourceSearch = search.get(QR_QUERY_PARAM) === '1' ? `?${QR_QUERY_PARAM}=1` : '';
  const hello = useMemo(() => makeHello(visitId, () => deviceNow.current, sourceSearch), [visitId, sourceSearch]);
  const received = useLiveSocket(valid ? socketUrl(`/ws/public/${encodeURIComponent(token)}`) : null, {
    probe,
    hello,
  });
  // Several new points in one update are shown one at a time (scoreboard, momentum, last point, overlays and pauses
  // all read the same state): only presentation, it always ends on the state of the server.
  const receivedData = received.data;
  const receivedMatch = receivedData?.kind === 'state' ? receivedData : null;
  const shownState = usePointSequence(
    receivedMatch?.state ?? null,
    receivedMatch?.live === true,
    receivedMatch?.matchId ?? '',
  );
  const snapshot = useMemo(
    () =>
      receivedData?.kind === 'state' && shownState !== null && shownState !== receivedData.state
        ? { ...received, data: { ...receivedData, state: shownState } }
        : received,
    [received, receivedData, shownState],
  );

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const data = snapshot.data;
  const brand = useBrandName();
  const look = useTenantLook();
  const intermissions = useTenantIntermissions();
  const overlays = useTenantOverlays();
  const template = useTemplate();
  const [pauseFullscreen, setPauseFullscreen] = useState(false);
  const blockBrand = useMemo(
    () =>
      look
        ? {
            name: look.name,
            logoMain: look.images.logoMain,
            logoMark: look.images.logoMark,
            sponsors: look.sponsors,
          }
        : null,
    [look],
  );
  useEffect(() => {
    if (data?.kind === 'state') {
      const s = data.state;
      document.title = `${teamName(s.teams, 'home')} ${s.setsWon.home}-${s.setsWon.away} ${teamName(s.teams, 'away')} · ${brand}`;
    } else if (data?.kind === 'scheduled') {
      const f = data.fixture;
      document.title = `${f.home.name} – ${f.away.name} · Prossima partita · ${brand}`;
    } else document.title = `${brand} · Diretta`;
  }, [data, brand]);

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (document.documentElement.requestFullscreen)
      void document.documentElement.requestFullscreen().catch(() => setFullscreen((f) => !f));
    else setFullscreen((f) => !f);
  };

  if (!valid) {
    return (
      <main className="mx-auto max-w-7xl p-4">
        <StatusScreen title="Link non valido o scaduto" tone="error">
          Controlla di aver copiato il link per intero.
        </StatusScreen>
      </main>
    );
  }

  const controls = (
    <div
      className={`flex items-center gap-2 transition-opacity focus-within:opacity-100 motion-reduce:transition-none ${idle ? 'opacity-0' : ''}`}
    >
      {tv && (
        // WCAG 2.2.2: the viewer can stop the automatic change of screen (hidden with the pointer, never removed).
        <button
          type="button"
          onClick={() => setRotationPaused((p) => !p)}
          aria-pressed={rotationPaused}
          // Toggle: the name stays the same, aria-pressed says whether it is stopped; the tooltip says what a click does.
          aria-label="Ferma rotazione"
          title={rotationPaused ? 'Riprendi rotazione' : 'Ferma rotazione'}
          className="inline-flex h-9 items-center gap-2 rounded-button border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:min-w-11 sm:px-3"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            {rotationPaused ? <path d="M8 5l11 7-11 7z" /> : <path d="M9 5v14M15 5v14" />}
          </svg>
        </button>
      )}
      {!tv && <InstallButton app={app} />}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
        title={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
        className="inline-flex h-9 items-center gap-2 rounded-button border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-surface-2 pointer-coarse:h-11 pointer-coarse:min-w-11 sm:px-3"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          {fullscreen ? (
            <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          ) : (
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          )}
        </svg>
        {/* Phones and big screen: icon only. */}
        <span className={tv ? 'sr-only' : 'hidden sm:inline'}>
          {fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
        </span>
      </button>
      <ThemeToggle />
    </div>
  );
  // Big screen with a match: no page header, the logo and the buttons go in the scoreboard (one row less).
  const inScoreboard = tv && data?.kind === 'state';

  return (
    <div
      className={`${template.id === 'standard' ? 'border-t-4 border-accent' : ''} ${
        tv ? 'flex h-dvh flex-col overflow-hidden p-3 lg:p-5' : 'flex min-h-dvh flex-col'
      } ${idle ? 'cursor-none' : ''}`}
      data-device={device}
    >
      {/* Logos of the platform (superadmin), above everything, also on the big screen; nothing without them. */}
      <SystemLogosBar className={tv ? 'shrink-0 pb-3' : 'sir-page mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5'} />
      {!inScoreboard && (
        <header
          className={`sir-navbar flex items-center justify-between gap-3 ${tv ? 'pb-3' : 'sir-page mx-auto w-full max-w-7xl px-3 pt-3 sm:px-5'}`}
        >
          <BrandMark />
          {controls}
        </header>
      )}
      <main className={tv ? 'min-h-0 flex-1' : 'sir-page mx-auto w-full max-w-7xl flex-1 px-3 py-3 sm:px-5'}>
        <LiveMatch
          snapshot={snapshot}
          device={device}
          brand={inScoreboard}
          rotationPaused={rotationPaused}
          layout={look?.layout ?? null}
          look={blockBrand}
          {...(inScoreboard ? { controls } : {})}
        />
      </main>
      <FullscreenHint visible={fullscreenHint} />
      {data?.kind === 'state' && (
        <Overlay
          key={`avvisi-${data.matchId}`}
          state={data.state}
          live={data.live === true}
          config={overlays}
          device={device}
          blocked={pauseFullscreen}
        />
      )}
      {data?.kind === 'state' && (
        <Intermission
          key={data.matchId}
          onFullscreenChange={setPauseFullscreen}
          state={data.state}
          live={data.live === true}
          config={intermissions}
          device={device}
          paused={rotationPaused}
          onTogglePaused={() => setRotationPaused((p) => !p)}
          look={blockBrand}
          sponsorLogo={look?.images.sponsorLogo ?? null}
        />
      )}
    </div>
  );
}
