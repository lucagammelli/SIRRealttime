import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { ConnectionBadge } from './ConnectionBadge.tsx';
import { MatchView } from './MatchView.tsx';
import { StatusScreen } from './StatusScreen.tsx';
import { Spinner } from './ui.tsx';

/** What a live socket shows: the match, or the right message for every state of the connection. */
export function LiveMatch({ snapshot, tv = false }: { snapshot: LiveSnapshot; tv?: boolean }) {
  const { status, data, error } = snapshot;
  if (status === 'invalid') {
    return (
      <StatusScreen title="Link non valido o scaduto" tone="error">
        Il link non esiste più, è stato revocato oppure è scaduto. Chiedi un nuovo link a chi te lo ha inviato.
      </StatusScreen>
    );
  }
  if (status === 'unauthorized') {
    return (
      <StatusScreen title="Sessione terminata" tone="error">
        Accedi di nuovo per seguire la partita.
      </StatusScreen>
    );
  }
  const finished = data?.kind === 'state' && data.state.status === 'finished';
  const badge = <ConnectionBadge status={status} finished={finished} />;
  if (data === null) {
    if (status === 'reconnecting' && snapshot.serverFull) {
      return (
        <StatusScreen title="Troppi spettatori collegati" tone="warn" action={badge}>
          Il server è al completo in questo momento: nuovo tentativo tra poco. La pagina si aggiorna da sola.
        </StatusScreen>
      );
    }
    if (status === 'reconnecting') {
      return (
        <StatusScreen title="Server non raggiungibile" tone="warn" action={badge}>
          Errore di rete: nuovo tentativo in corso (tentativo {snapshot.attempts}). La pagina si aggiorna da sola.
        </StatusScreen>
      );
    }
    return (
      <StatusScreen title="Connessione alla partita">
        <div className="flex justify-center">
          <Spinner label="Connessione in corso…" />
        </div>
      </StatusScreen>
    );
  }
  if (data.kind === 'noMatch') {
    return (
      <StatusScreen title="Nessuna partita in corso" action={badge}>
        La pagina mostrerà la partita appena inizia, senza bisogno di ricaricarla.
      </StatusScreen>
    );
  }
  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-card border border-warn bg-surface px-4 py-2 text-sm text-warn">
          Aggiornamento non disponibile: {error}
        </p>
      )}
      <MatchView state={data.state} status={badge} tv={tv} />
    </>
  );
}
