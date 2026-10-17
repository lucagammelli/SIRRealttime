/* global self */
/*
 * Service worker minimo di SIRRealtime: serve solo perché il browser consideri la pagina installabile («Installa come
 * app»). Non mette nulla in cache e non intercetta le richieste: dati live, WebSocket e API passano sempre dalla rete.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
// Gestore presente (alcuni browser lo richiedono per l'installazione) ma senza `respondWith`: rete di default.
self.addEventListener('fetch', () => undefined);
