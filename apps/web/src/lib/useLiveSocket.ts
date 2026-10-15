import { useEffect, useState } from 'react';
import type { LiveConnectionOptions, LiveSnapshot } from './liveConnection.ts';
import { LiveConnection } from './liveConnection.ts';

export type UseLiveSocketOptions = Omit<LiveConnectionOptions, 'url' | 'onChange'>;

const INITIAL: LiveSnapshot = { status: 'connecting', data: null, error: null, attempts: 0 };

/** `ws://` or `wss://` URL of a server path, on the same origin as the page. */
export function socketUrl(path: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${path}`;
}

/**
 * Keeps a `LiveConnection` open while the component is mounted (`url` null: nothing to open).
 * The options are read when the connection starts: pass stable functions.
 */
export function useLiveSocket(url: string | null, options: UseLiveSocketOptions = {}): LiveSnapshot {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(INITIAL);
  const { createSocket, probe, baseDelayMs, maxDelayMs, restartSpreadMs, random, gzip, resyncRetryMs } = options;

  useEffect(() => {
    if (url === null) return;
    setSnapshot(INITIAL);
    const connection = new LiveConnection({
      url,
      onChange: setSnapshot,
      ...(createSocket ? { createSocket } : {}),
      ...(probe ? { probe } : {}),
      ...(baseDelayMs === undefined ? {} : { baseDelayMs }),
      ...(maxDelayMs === undefined ? {} : { maxDelayMs }),
      ...(restartSpreadMs === undefined ? {} : { restartSpreadMs }),
      ...(random ? { random } : {}),
      ...(gzip === undefined ? {} : { gzip }),
      ...(resyncRetryMs === undefined ? {} : { resyncRetryMs }),
    });
    connection.start();
    const online = (): void => connection.retryNow();
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('online', online);
      connection.stop();
    };
  }, [url, createSocket, probe, baseDelayMs, maxDelayMs, restartSpreadMs, random, gzip, resyncRetryMs]);

  return snapshot;
}
