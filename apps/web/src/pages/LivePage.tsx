import { SHARE_TOKEN_PATTERN } from '@sir/shared';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { LiveMatch } from '../components/LiveMatch.tsx';
import { StatusScreen } from '../components/StatusScreen.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import type { ProbeResult } from '../lib/liveConnection.ts';
import { socketUrl, useLiveSocket } from '../lib/useLiveSocket.ts';
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

/** Public page `/live/:token`: only the match, no link to the reserved area. */
export function LivePage() {
  const { token = '' } = useParams();
  const [search] = useSearchParams();
  const valid = SHARE_TOKEN_PATTERN.test(token);
  const tvParam = search.get('tv') === '1';
  const [fullscreen, setFullscreen] = useState(false);
  const tv = tvParam || fullscreen;
  const probe = useCallback(() => probeShareToken(token), [token]);
  const snapshot = useLiveSocket(valid ? socketUrl(`/ws/public/${encodeURIComponent(token)}`) : null, { probe });

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const data = snapshot.data;
  useEffect(() => {
    if (data?.kind === 'state') {
      const s = data.state;
      document.title = `${teamName(s.teams, 'home')} ${s.setsWon.home}-${s.setsWon.away} ${teamName(s.teams, 'away')} · SIRRealtime`;
    } else document.title = 'SIRRealtime · Diretta';
  }, [data]);

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

  return (
    <div className={tv ? 'flex h-dvh flex-col overflow-hidden p-3 lg:p-5' : 'min-h-dvh'}>
      <header
        className={`flex items-center justify-between gap-3 ${tv ? 'pb-3' : 'mx-auto max-w-7xl px-3 pt-3 sm:px-5'}`}
      >
        <p className="font-display text-lg font-bold uppercase tracking-widest text-muted">
          SIR<span className="text-home">Realtime</span>
        </p>
        <div className="flex items-center gap-2">
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
            {/* Phones: icon only. */}
            <span className="hidden sm:inline">{fullscreen ? 'Esci da schermo intero' : 'Schermo intero'}</span>
          </button>
          <ThemeToggle />
        </div>
      </header>
      <main className={tv ? 'min-h-0 flex-1' : 'mx-auto max-w-7xl px-3 py-3 sm:px-5'}>
        <LiveMatch snapshot={snapshot} tv={tv} />
      </main>
    </div>
  );
}
