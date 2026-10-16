import type { BlockOptions } from '@sir/shared';
import type { Side } from '@sir/volley-stats';
import { topPlayers } from '@sir/volley-stats';
import { Partials } from '../components/Scoreboard.tsx';
import { Card, Empty } from '../components/ui.tsx';
import { playerName, teamName, teamShort } from '../lib/format.ts';
import { setPartials } from '../lib/scoreboard.ts';
import type { BlockEnv } from './env.ts';

const FILL = 'h-full min-h-0';
const TEXT: Record<Side, string> = { home: 'text-home-ink', away: 'text-away-ink' };
const BG: Record<Side, string> = { home: 'bg-home', away: 'bg-away' };

/** Last point of the match, big: team, score after it and how it was won. */
export function LastPointBlock({ env }: { env: BlockEnv }) {
  const point = env.state.live.lastPoint;
  return (
    <Card title="Ultimo punto" className={FILL}>
      {point ? (
        <div
          key={`${point.set}-${point.homeScore}-${point.awayScore}`}
          className="sir-flash flex flex-wrap items-center gap-x-4 gap-y-1"
          aria-live="polite"
        >
          <span className={`inline-block size-3 rounded-full ${BG[point.team]}`} aria-hidden="true" />
          <span className={`font-display text-2xl font-bold uppercase ${TEXT[point.team]}`}>
            {teamName(env.state.teams, point.team)}
          </span>
          <span className="tabular font-display text-3xl font-bold text-text">
            {point.homeScore}-{point.awayScore}
          </span>
          <span className="text-base text-muted">
            {point.set}° set · {point.label}
          </span>
        </div>
      ) : (
        <Empty>Nessun punto ancora.</Empty>
      )}
    </Card>
  );
}

/** Partial scores of every set, the one in progress marked. */
export function SetScoresBlock({ env }: { env: BlockEnv }) {
  const partials = setPartials(env.state);
  return (
    <Card title="Parziali dei set" className={FILL}>
      {partials.length > 0 ? <Partials partials={partials} /> : <Empty>Nessun set ancora.</Empty>}
    </Card>
  );
}

/** Players with the most points (ranking of @sir/volley-stats), with attack, block and serve points. */
export function TopPlayersBlock({ options, env }: { options: BlockOptions<'topPlayers'>; env: BlockEnv }) {
  const { state } = env;
  const rows = topPlayers(state, { limit: options.count, team: options.team });
  const subtitle = options.team === 'both' ? 'Punti nella partita' : `Punti di ${teamName(state.teams, options.team)}`;
  return (
    <Card title="Migliori giocatori" subtitle={subtitle} className={FILL}>
      {rows.length === 0 ? (
        <Empty>Nessun punto ancora.</Empty>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Migliori giocatori per punti</caption>
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th scope="col" className="py-1 pr-2">
                Giocatore
              </th>
              <th scope="col" className="px-1 py-1 text-right" title="Attacchi vincenti">
                Att
              </th>
              <th scope="col" className="px-1 py-1 text-right" title="Muri vincenti">
                Muro
              </th>
              <th scope="col" className="px-1 py-1 text-right" title="Ace">
                Ace
              </th>
              <th scope="col" className="py-1 pl-1 text-right">
                Punti
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grid">
            {rows.map((p) => (
              <tr key={`${p.team}-${p.number}`}>
                <th scope="row" className="py-1.5 pr-2 text-left font-medium text-text">
                  <span className={`tabular mr-2 font-bold ${TEXT[p.team]}`}>{p.number}</span>
                  {playerName(p.player ?? undefined, p.number)}
                  {options.team === 'both' && (
                    <span className={`ml-2 text-xs font-semibold ${TEXT[p.team]}`}>
                      {teamShort(state.teams, p.team)}
                    </span>
                  )}
                </th>
                <td className="tabular px-1 py-1.5 text-right text-muted">{p.attackKills}</td>
                <td className="tabular px-1 py-1.5 text-right text-muted">{p.blockKills}</td>
                <td className="tabular px-1 py-1.5 text-right text-muted">{p.aces}</td>
                <td className="tabular py-1.5 pl-1 text-right font-display text-lg font-bold text-text">{p.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
