import type { MatchState, Side } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { formatMinutes, SIDE_LABEL, teamName } from '../lib/format.ts';
import { matchMinutes, matchWinner, setPartials, statusLabel } from '../lib/scoreboard.ts';

const SIDES: Side[] = ['home', 'away'];
const TEXT: Record<Side, string> = { home: 'text-home', away: 'text-away' };
const BG: Record<Side, string> = { home: 'bg-home', away: 'bg-away' };
const SOFT: Record<Side, string> = { home: 'bg-home-soft', away: 'bg-away-soft' };
/** Phones: the two teams side by side (names truncated with an ellipsis) and the score below; from sm one row. */
const GRID_WIDE = 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]';
const SM_GRID_WIDE = 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]';
const ON: Record<Side, string> = { home: 'text-on-home', away: 'text-on-away' };

function ServeDot({ side, active }: { side: Side; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-3 shrink-0 rounded-full sm:size-4 ${active ? `${BG[side]} sir-pulse` : 'bg-transparent'}`}
    />
  );
}

/** Big score of the match: first thing on the page, readable from far away. */
export function Scoreboard({ state, status, tv = false }: { state: MatchState; status?: ReactNode; tv?: boolean }) {
  const { live } = state;
  const serving = state.status === 'finished' ? null : live.servingTeam;
  const winner = matchWinner(state);
  const partials = setPartials(state);
  const minutes = matchMinutes(state);
  const score: Record<Side, number> = { home: live.homeScore, away: live.awayScore };
  const names: Record<Side, string> = { home: teamName(state.teams, 'home'), away: teamName(state.teams, 'away') };
  const big = tv ? 'text-[min(22vh,11rem)]' : 'text-6xl sm:text-8xl';
  const setsSize = tv ? 'text-6xl' : 'text-3xl sm:text-5xl';
  const nameSize = tv ? 'text-4xl' : 'text-lg sm:text-2xl';

  return (
    <section
      aria-label="Tabellone"
      className="relative overflow-hidden rounded-panel border border-border bg-surface shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 sm:px-6">
        <p className="text-sm font-medium text-muted">
          <span className="text-text">{statusLabel(state)}</span>
          {minutes !== null && <span> · {formatMinutes(minutes)}</span>}
        </p>
        {status}
      </div>

      <div
        className={`grid items-center gap-x-3 gap-y-2 px-3 py-4 sm:gap-6 sm:px-6 sm:py-6 ${tv ? GRID_WIDE : `grid-cols-2 ${SM_GRID_WIDE}`}`}
      >
        {SIDES.map((side) => {
          return (
            <div
              key={side}
              className={`flex flex-col items-center ${side === 'home' ? 'order-1' : tv ? 'order-3' : 'order-2 sm:order-3'}`}
            >
              <div className={`flex w-full items-center gap-2 ${side === 'home' ? 'justify-start' : 'justify-end'}`}>
                {side === 'home' && <ServeDot side={side} active={serving === side} />}
                <h2
                  className={`min-w-0 truncate font-display font-bold uppercase leading-tight ${nameSize} ${TEXT[side]}`}
                  title={names[side]}
                >
                  {names[side]}
                </h2>
                {side === 'away' && <ServeDot side={side} active={serving === side} />}
              </div>
              <div
                className={`mt-2 flex w-full items-center gap-3 ${side === 'home' ? 'justify-start' : 'justify-end'}`}
              >
                <span
                  className={`rounded-card px-3 font-display font-bold tabular ${setsSize} ${SOFT[side]} ${TEXT[side]}`}
                  aria-label={`Set vinti ${SIDE_LABEL[side]}`}
                >
                  {state.setsWon[side]}
                </span>
                <span className="text-xs uppercase tracking-wide text-muted">set</span>
                {winner === side && (
                  <span className={`rounded-card px-2 py-0.5 text-xs font-semibold ${BG[side]} ${ON[side]}`}>
                    Vince
                  </span>
                )}
              </div>
            </div>
          );
        })}
        <div
          className={`${tv ? 'order-2' : 'order-3 col-span-2 sm:order-2 sm:col-span-1'} flex items-center justify-center gap-1 font-display font-bold leading-none tabular sm:gap-3`}
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="sr-only">
            Punteggio del {live.set}° set: {names.home} {score.home}, {names.away} {score.away}
          </span>
          <span
            aria-hidden="true"
            key={`h${live.set}-${score.home}`}
            className={`sir-pop inline-block ${big} ${TEXT.home}`}
          >
            {score.home}
          </span>
          <span aria-hidden="true" className={`${tv ? 'text-7xl' : 'text-4xl sm:text-6xl'} text-muted`}>
            :
          </span>
          <span
            aria-hidden="true"
            key={`a${live.set}-${score.away}`}
            className={`sir-pop inline-block ${big} ${TEXT.away}`}
          >
            {score.away}
          </span>
        </div>
      </div>

      {partials.length > 0 && (
        <ol aria-label="Parziali dei set" className="flex flex-wrap justify-center gap-2 px-3 pb-3 sm:px-6">
          {partials.map((p) => (
            <li
              key={p.number}
              className={`flex items-center gap-2 rounded-card border px-2.5 py-1 text-sm tabular ${
                p.current ? 'border-focus bg-surface-2' : 'border-border'
              }`}
            >
              <span className="text-xs font-semibold uppercase text-muted">{p.number}° set</span>
              <span className={p.winner === 'home' ? 'font-bold text-home' : 'text-text'}>{p.home}</span>
              <span className="text-muted">-</span>
              <span className={p.winner === 'away' ? 'font-bold text-away' : 'text-text'}>{p.away}</span>
              {p.current && <span className="text-xs font-medium text-live">in corso</span>}
            </li>
          ))}
        </ol>
      )}

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border text-sm sm:grid-cols-4">
        <Fact label="Ultimo punto">
          {live.lastPoint ? (
            <span
              key={`${live.lastPoint.set}-${live.lastPoint.homeScore}-${live.lastPoint.awayScore}`}
              className="sir-flash inline-flex items-center gap-1.5"
            >
              <span className={`inline-block size-2 rounded-full ${BG[live.lastPoint.team]}`} aria-hidden="true" />
              <span className={TEXT[live.lastPoint.team]}>{SIDE_LABEL[live.lastPoint.team]}</span>
              <span className="text-text">{live.lastPoint.label}</span>
            </span>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Serie in corso">
          {live.run && live.run.length > 1 ? (
            <span className={TEXT[live.run.team]}>
              {live.run.length} punti {live.run.team === 'home' ? 'casa' : 'ospiti'}
            </span>
          ) : (
            '–'
          )}
        </Fact>
        <Fact label="Timeout nel set">
          <PerSide home={live.timeouts.home} away={live.timeouts.away} />
        </Fact>
        <Fact label="Cambi nel set">
          <PerSide home={live.substitutions.home} away={live.substitutions.away} />
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-2.5">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-text">{children}</dd>
    </div>
  );
}

function PerSide({ home, away }: { home: number; away: number }) {
  return (
    <span className="tabular">
      <span className="text-home">{home}</span>
      <span className="text-muted"> · </span>
      <span className="text-away">{away}</span>
    </span>
  );
}
