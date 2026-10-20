import type { HelloMessage, VisitDevice } from '@arenalive/shared';
import { QR_QUERY_PARAM } from '@arenalive/shared';
import { isStandalone } from './pwa.ts';

/**
 * Statistics of the visits of the public page (docs/server.md «Statistiche delle visite», docs/portale.md «Statistiche»): the page tells the server, once per WebSocket,
 * how it was opened. No cookie and nothing stored: the id of the visit is random, lives only in the memory of the
 * page (a reload is a new visit) and is sent again only to join a reconnection to its visit.
 */

/** Random id of a visit: 16 random bytes in hex (32 characters). */
export function newVisitId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pure: how the page was opened, from its query string: from the QR code (`?q=1`) or any other way. */
export function visitSource(search: string): HelloMessage['source'] {
  return new URLSearchParams(search).get(QR_QUERY_PARAM) === '1' ? 'qr' : 'link';
}

/** Pure: the `hello` message (JSON text) of a visit. */
export function helloText(visit: string, device: VisitDevice, search: string, app: boolean): string {
  const message: HelloMessage = { type: 'hello', visit, device, source: visitSource(search), app };
  return JSON.stringify(message);
}

/**
 * The function that gives the `hello` at every open of the socket: device and installed-as-app are read at that moment
 * (the layout may have changed), the address query when the page was opened.
 */
export function makeHello(visit: string, device: () => VisitDevice, search: string): () => string {
  return () => helloText(visit, device(), search, isStandalone());
}
