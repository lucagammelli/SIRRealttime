import type { TenantLayout } from '@arenalive/shared';
import type { ReactNode } from 'react';
import type { BlockBrand } from '../blocks/env.ts';
import type { Device } from '../lib/layout.ts';
import type { LiveSnapshot } from '../lib/liveConnection.ts';
import { ConnectionBadge } from './ConnectionBadge.tsx';
import { MatchView } from './MatchView.tsx';
import { NextMatch } from './NextMatch.tsx';
import { StatusScreen } from './StatusScreen.tsx';
import { Spinner } from './ui.tsx';

/**
 * What a live socket shows: the match, or the right message for every state of the connection.
 * `device` (public page) lays the match out for the screen, `brand` puts the logo of the client in the scoreboard and
 * `controls` go next to the connection badge (big screen: no page header). `layout` and `look`: the blocks and the
 * graphics of the client (public page).
 */
export function LiveMatch({
  snapshot,
  device,
  brand = false,
  controls,
  rotationPaused = false,
  layout = null,
  look = null,
}: {
  snapshot: LiveSnapshot;
  device?: Device;
  brand?: boolean;
  controls?: ReactNode;
  rotationPaused?: boolean;
  layout?: TenantLayout | null;
  look?: BlockBrand | null;
}) {
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
  const badge = <ConnectionBadge status={status} finished={finished} upcoming={data?.kind === 'scheduled'} />;
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
  if (data.kind === 'scheduled') {
    return (
      <div className={device === 'tv' ? 'h-full min-h-0' : ''}>
        <NextMatch fixture={data.fixture} status={badge} {...(device ? { device } : {})} />
      </div>
    );
  }
  if (data.kind === 'noMatch') {
    return (
      <StatusScreen title="Nessuna partita in corso" action={badge}>
        La pagina mostrerà la partita appena inizia, senza bisogno di ricaricarla.
      </StatusScreen>
    );
  }
  const tv = device === 'tv';
  return (
    <div className={tv ? 'flex h-full min-h-0 flex-col' : ''}>
      {error && (
        <p role="alert" className="mb-3 rounded-card border border-warn bg-surface px-4 py-2 text-sm text-warn">
          Aggiornamento non disponibile: {error}
        </p>
      )}
      {data.simulated && <SimulationLabel />}
      <div className={tv ? 'min-h-0 flex-1' : ''}>
        <MatchView
          state={data.state}
          status={
            controls ? (
              <div className="flex items-center gap-2">
                {badge}
                {controls}
              </div>
            ) : (
              badge
            )
          }
          {...(device ? { device } : {})}
          brand={brand}
          rotationPaused={rotationPaused}
          layout={layout}
          look={look}
          {...(data.logos ? { logos: data.logos } : {})}
        />
      </div>
    </div>
  );
}

/** Text of the label of a simulated match on the public page. */
export const SIMULATION_LABEL = 'Simulazione';

/**
 * Label of a match played by the simulation of the server: small, in a corner, above everything (pauses, avvisi and
 * full-screen slides included), on TV, tablet and phone.
 */
function SimulationLabel() {
  return (
    <p
      data-testid="simulation-label"
      className="pointer-events-none fixed bottom-2 left-2 z-[60] rounded-button border border-warn bg-surface px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warn shadow-card"
    >
      {SIMULATION_LABEL}
    </p>
  );
}
