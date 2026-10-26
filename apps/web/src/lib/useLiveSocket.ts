import { useEffect, useState } from 'react';
import { createBrandingRefresh } from './branding.ts';
import type { LiveConnectionOptions, LiveSnapshot } from './liveConnection.ts';
import { LiveConnection } from './liveConnection.ts';

export type UseLiveSocketOptions = Omit<LiveConnectionOptions, 'url' | 'onChange' | 'onConfig'>;

const INITIAL: LiveSnapshot = { status: 'connecting', data: null, error: null, attempts: 0 };

/** `ws://` or `wss://` URL of a server path, on the same origin as the page. */
export function socketUrl(path: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}

/**
 * Keeps a `LiveConnection` open while the component is mounted (`url` null: nothing to open).
 * The options are read when the connection starts: pass stable functions.
 * The graphics of the client are read again, without touching the match on screen, when the server sends `config`
 * and, at most once a minute, after a reconnection or when the page comes back in the foreground.
 */
export function useLiveSocket(url: string | null, options: UseLiveSocketOptions = {}): LiveSnapshot {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(INITIAL);
  const {
    createSocket,
    probe,
    baseDelayMs,
    maxDelayMs,
    restartSpreadMs,
    random,
    gzip,
    resyncRetryMs,
    hello,
    display,
    retryInvalidMs,
  } = options;

  useEffect(() => {
    if (url === null) return;
    setSnapshot(INITIAL);
    const branding = createBrandingRefresh();
    const connection = new LiveConnection({
      url,
      onChange: setSnapshot,
      onConfig: (reason) => (reason === 'changed' ? branding.changed() : branding.resume()),
      ...(createSocket ? { createSocket } : {}),
      ...(probe ? { probe } : {}),
      ...(baseDelayMs === undefined ? {} : { baseDelayMs }),
      ...(maxDelayMs === undefined ? {} : { maxDelayMs }),
      ...(restartSpreadMs === undefined ? {} : { restartSpreadMs }),
      ...(random ? { random } : {}),
      ...(gzip === undefined ? {} : { gzip }),
      ...(resyncRetryMs === undefined ? {} : { resyncRetryMs }),
      ...(hello ? { hello } : {}),
      ...(display ? { display } : {}),
      ...(retryInvalidMs === undefined ? {} : { retryInvalidMs }),
    });
    connection.start();
    const online = (): void => connection.retryNow();
    const visible = (): void => {
      if (document.visibilityState === 'visible') branding.resume();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      connection.stop();
      branding.stop();
    };
  }, [
    url,
    createSocket,
    probe,
    baseDelayMs,
    maxDelayMs,
    restartSpreadMs,
    random,
    gzip,
    resyncRetryMs,
    hello,
    display,
    retryInvalidMs,
  ]);

  return snapshot;
}
