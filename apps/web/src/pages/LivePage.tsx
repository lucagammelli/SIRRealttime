import { SHARE_TOKEN_PATTERN } from '@sir/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { Intermission } from '../components/Intermission.tsx';
import { LiveMatch } from '../components/LiveMatch.tsx';
import { Overlay } from '../components/Overlay.tsx';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import type { ProbeResult } from '../lib/liveConnection.ts';
import { useIdle, useTvRootClass, useWakeLock } from '../lib/tvScreen.ts';
import { tvModeOf } from '../lib/layout.ts';
import { useDevice } from '../lib/useLayout.ts';
import { socketUrl, useLiveSocket } from '../lib/useLiveSocket.ts';
import { useBrandName, useTenantIntermissions, useTenantLook, useTenantOverlays } from '../lib/branding.ts';
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
 * smartphone (< 700 px), tablet, big screen (≥ 1600 × 800 px and 16:10, `?tv=1`, or full screen from tablet up; never
 * with `?tv=0`): no scrolling, text scaled with the screen, pointer hidden after 3 s, screen kept on, rotation of the
 * groups that the viewer can stop. The blocks are the ones chosen by the client for the device (page «Pagina pubblica»
 * of the reserved area), the defaults until its graphics are loaded. In the pauses of the match (time-out, end of set,
 * end of match) the pause chosen by the client (page «Pause e sponsor») goes over the page or at its bottom: none while
 * its graphics are loading, the default pauses when they cannot be loaded. The events of the match that arrive live
 * (ace, set point, ...) show an overlay for a few seconds as chosen by the client (page «Avvisi»), never over a full
 * screen pause.
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
  const probe = useCallback(() => probeShareToken(token), [token]);
  const snapshot = useLiveSocket(valid ? socketUrl(`/ws/public/${encodeURIComponent(token)}`) : null, { probe });

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
  const [pauseFullscreen, setPauseFullscreen] = useState(false);
  const blockBrand = useMemo(
    () => (look ? { name: look.name, logoMain: look.images.logoMain, logoMark: look.images.logoMark } : null),
    [look],
  );
  useEffect(() => {
    if (data?.kind === 'state') {
      const s = data.state;
      document.title = `${teamName(s.teams, 'home')} ${s.setsWon.home}-${s.setsWon.away} ${teamName(s.teams, 'away')} · ${brand}`;
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
          className="inline-flex h-9 items-center gap-2 rounded-card border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-surface-2 sm:px-3"
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
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
        title={fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
        className="inline-flex h-9 items-center gap-2 rounded-card border border-border bg-surface px-2.5 text-sm font-medium text-text hover:bg-surface-2 sm:px-3"
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
      className={`border-t-4 border-accent ${tv ? 'flex h-dvh flex-col overflow-hidden p-3 lg:p-5' : 'min-h-dvh'} ${
        idle ? 'cursor-none' : ''
      }`}
      data-device={device}
    >
      {!inScoreboard && (
        <header
          className={`flex items-center justify-between gap-3 ${tv ? 'pb-3' : 'mx-auto max-w-7xl px-3 pt-3 sm:px-5'}`}
        >
          <BrandMark />
          {controls}
        </header>
      )}
      <main className={tv ? 'min-h-0 flex-1' : 'mx-auto max-w-7xl px-3 py-3 sm:px-5'}>
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
