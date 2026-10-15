import type { ConnectionStatus } from '../lib/liveConnection.ts';

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connessione…',
  live: 'In diretta',
  reconnecting: 'Riconnessione…',
  invalid: 'Link non valido',
  unauthorized: 'Sessione terminata',
};

/**
 * Always visible state of the live connection. With `finished` (match over) and the connection up it says
 * «Risultato finale» in a neutral style: «In diretta» only while the match is being played.
 */
export function ConnectionBadge({ status, finished = false }: { status: ConnectionStatus; finished?: boolean }) {
  const tone = status !== 'live' ? 'warn' : finished ? 'neutral' : 'live';
  // «In diretta» filled with the live colour: the most visible badge of the page.
  const box = {
    live: 'border-live bg-live text-on-live shadow-card',
    warn: 'border-warn text-warn',
    neutral: 'border-border text-muted',
  }[tone];
  const dot = { live: 'bg-on-live sir-pulse', warn: 'bg-warn', neutral: 'bg-axis' }[tone];
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${box}`}
    >
      <span aria-hidden="true" className={`inline-block size-2 rounded-full ${dot}`} />
      {tone === 'neutral' ? 'Risultato finale' : LABEL[status]}
    </span>
  );
}
