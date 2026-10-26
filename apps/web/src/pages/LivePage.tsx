import { QR_QUERY_PARAM, SHARE_TOKEN_PATTERN } from '@arenalive/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { FullscreenHint, InstallButton } from '../components/AppInstall.tsx';
import { LiveScreen } from '../components/LiveScreen.tsx';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { TvCanvas } from '../components/TvCanvas.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import type { ProbeResult } from '../lib/liveConnection.ts';
import { registerServiceWorker, useFullscreenOnFirstTouch, useInstallApp } from '../lib/pwa.ts';
import { useIdle, useTvRootClass, useWakeLock } from '../lib/tvScreen.ts';
import { tvModeOf } from '../lib/layout.ts';
import { useDevice } from '../lib/useLayout.ts';
import { socketUrl, useLiveSocket } from '../lib/useLiveSocket.ts';
import { makeHello, newVisitId } from '../lib/visit.ts';

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
 * screen pause. During the set the «ogni N punti» pause opens with the live updates only. Some minutes after the end
 * of the match «Dopo la partita» (when on, with its photo) takes the place of the end-of-match pause and of the
 * overlays: the photo full screen with the countdown to the next match of the club.
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
  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else if (document.documentElement.requestFullscreen)
      void document.documentElement.requestFullscreen().catch(() => setFullscreen((f) => !f));
    else setFullscreen((f) => !f);
  };

  if (!valid) {
    const invalid = (
      <main className="mx-auto max-w-7xl p-4">
        <StatusScreen title="Link non valido o scaduto" tone="error">
          Controlla di aver copiato il link per intero.
        </StatusScreen>
      </main>
    );
    return tv ? <TvCanvas>{invalid}</TvCanvas> : invalid;
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
  const page = (
    <LiveScreen
      received={received}
      device={device}
      idle={idle}
      controls={controls}
      rotationPaused={rotationPaused}
      onTogglePaused={() => setRotationPaused((p) => !p)}
      extra={<FullscreenHint visible={fullscreenHint} />}
    />
  );
  // Big screen: always drawn on the fixed canvas and scaled to the real screen (same pages on every TV).
  return tv ? <TvCanvas>{page}</TvCanvas> : page;
}
