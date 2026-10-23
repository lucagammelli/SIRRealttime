import type { CourtOptions } from '@arenalive/shared';
import { CourtOptionsSchema } from '@arenalive/shared';
import type { MatchState, Side } from '@arenalive/volley-stats';
import { useId, useMemo, useState } from 'react';
import type { ZoneArrow, ZoneSkill } from '../charts/zones.ts';
import { COURT, EVALUATION_NAMES, ZONES, zoneCenter, zonePlayers, zoneRect, zoneView } from '../charts/zones.ts';
import { useOurSide, useTemplate } from '../lib/branding.ts';
import { formatPct, playerName, teamName, teamShort } from '../lib/format.ts';
import { useDeviceContext, useTouch } from '../lib/useLayout.ts';
import { Card, Segmented } from './ui.tsx';

const MAX_ARROWS = 14;
const EVAL_ORDER = ['#', '+', '!', '-', '/', '='] as const;
const EVAL_CLASS: Record<string, { stroke: string; fill: string; bg: string }> = {
  '#': { stroke: 'stroke-eval-perfect', fill: 'fill-eval-perfect', bg: 'bg-eval-perfect' },
  '+': { stroke: 'stroke-eval-positive', fill: 'fill-eval-positive', bg: 'bg-eval-positive' },
  '!': { stroke: 'stroke-eval-ok', fill: 'fill-eval-ok', bg: 'bg-eval-ok' },
  '-': { stroke: 'stroke-eval-negative', fill: 'fill-eval-negative', bg: 'bg-eval-negative' },
  '/': { stroke: 'stroke-eval-poor', fill: 'fill-eval-poor', bg: 'bg-eval-poor' },
  '=': { stroke: 'stroke-eval-error', fill: 'fill-eval-error', bg: 'bg-eval-error' },
  '~': { stroke: 'stroke-eval-none', fill: 'fill-eval-none', bg: 'bg-eval-none' },
};
const SIDE_FILL: Record<Side, string> = { home: 'fill-home', away: 'fill-away' };
const SIDE_STROKE: Record<Side, string> = { home: 'stroke-home', away: 'stroke-away' };
/** Arrows of the template «SIR VOLLEY» (`courtArrows: 'team'`): 1.5 px whatever the size of the map, 85% opaque. */
const TEAM_ARROW_PX = 1.5;
const TEAM_ARROW_OPACITY = 0.85;

/** Options of a map outside a block of the page: nothing chosen. */
const DEFAULT_COURT_OPTIONS = CourtOptionsSchema.parse({});

const evalClass = (symbol: string) =>
  EVAL_CLASS[symbol] ?? { stroke: 'stroke-eval-none', fill: 'fill-eval-none', bg: 'bg-eval-none' };

/**
 * Court in SVG: start → arrival of attacks and serves, with filters for team, player and evaluation. Arrows as the
 * template says: coloured by evaluation and as thick as their share (standard), or thin in the colour of the attacking
 * team with a small head («SIR VOLLEY»). On the phone the player and evaluation filters are in an expandable menu.
 */
export function CourtMap({
  state,
  className = '',
  options = DEFAULT_COURT_OPTIONS,
}: {
  state: MatchState;
  className?: string;
  /** Colours and thickness chosen in the «Studio grafico»; the defaults draw the map as it always was. */
  options?: CourtOptions;
}) {
  const templateTeamArrows = useTemplate().courtArrows === 'team';
  const compact = useDeviceContext() === 'phone';
  const touch = useTouch();
  const [side, setSide] = useState<Side>('home');
  const [skill, setSkill] = useState<ZoneSkill>('attack');
  const [player, setPlayer] = useState<number | null>(null);
  const [evaluation, setEvaluation] = useState<string>('all');
  const uid = `court${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const players = zonePlayers(state, side, skill);
  const activePlayer = player !== null && players.includes(player) ? player : null;
  const view = useMemo(
    () => zoneView(state, { side, skill, player: activePlayer, evaluation: evaluation === 'all' ? null : evaluation }),
    [state, side, skill, activePlayer, evaluation],
  );
  const shown = view.arrows.slice(0, MAX_ARROWS);
  const maxShare = Math.max(0.0001, ...shown.map((a) => a.share));
  const maxTarget = Math.max(1, ...Object.values(view.byTarget));
  const roster = new Map(state.players[side].map((p) => [p.number, p]));
  const names = EVALUATION_NAMES[skill];
  const opponent: Side = side === 'home' ? 'away' : 'home';
  // The shown team is on the left half; «ours» is the team of the client (home when none is known).
  const ours: Side = useOurSide() ?? 'home';
  const leftIsOurs = side === ours;
  const left = leftIsOurs
    ? { field: options.fieldOurs, lines: options.linesOurs }
    : { field: options.fieldOpponent, lines: options.linesOpponent };
  const right = leftIsOurs
    ? { field: options.fieldOpponent, lines: options.linesOpponent }
    : { field: options.fieldOurs, lines: options.linesOurs };
  const netColor = options.linesOurs ?? options.linesOpponent;
  const arrowColor = leftIsOurs ? options.arrowsOurs : options.arrowsOpponent;
  // One colour chosen for these arrows: thin-arrow style (one colour), also with the standard template.
  const teamArrows = templateTeamArrows || arrowColor !== undefined;
  const lw = options.lineWidth;
  const halfPath = (x: number, edge: number): string =>
    `M${x} ${COURT.y0} L${edge} ${COURT.y0} L${edge} ${COURT.y1} L${x} ${COURT.y1}`;
  const lineProps = (color: string | undefined) =>
    color === undefined ? { className: 'stroke-court-line' } : { stroke: color };
  const skillLabel = skill === 'attack' ? 'attacchi' : 'battute';
  const extraFilters = (
    <>
      <label className="inline-flex items-center gap-1.5 text-xs text-muted">
        Giocatore
        <select
          value={activePlayer ?? ''}
          onChange={(e) => setPlayer(e.target.value === '' ? null : Number(e.target.value))}
          className="rounded-card border border-border bg-surface-2 px-2 py-1 text-xs text-text"
        >
          <option value="">Tutta la squadra</option>
          {players.map((n) => (
            <option key={n} value={n}>
              {n} · {playerName(roster.get(n), n)}
            </option>
          ))}
        </select>
      </label>
      <Segmented
        label="Valutazione"
        size="xs"
        value={evaluation}
        onChange={setEvaluation}
        options={[
          { value: 'all', label: 'Tutte' },
          ...EVAL_ORDER.map((s) => ({ value: s, label: `${s} ${names[s] ?? ''}` })),
        ]}
      />
    </>
  );

  return (
    <Card
      title="Mappe di campo"
      className={className}
      subtitle={`${view.total} ${skillLabel} con zone · ${teamName(state.teams, side)} → ${teamName(state.teams, opponent)}`}
    >
      {touch && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Segmented
              label="Squadra"
              size="xs"
              value={side}
              onChange={(v) => {
                setSide(v);
                setPlayer(null);
              }}
              options={[
                { value: 'home', label: teamShort(state.teams, 'home') },
                { value: 'away', label: teamShort(state.teams, 'away') },
              ]}
            />
            <Segmented
              label="Fondamentale"
              size="xs"
              value={skill}
              onChange={setSkill}
              options={[
                { value: 'attack', label: 'Attacco' },
                { value: 'serve', label: 'Battuta' },
              ]}
            />
          </div>
          {compact ? (
            <details className="mb-3 rounded-card border border-border bg-surface-2 px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text">
                Altri filtri
              </summary>
              <div className="flex flex-col items-start gap-2 pb-2">{extraFilters}</div>
            </details>
          ) : (
            <div className="mb-3 flex flex-wrap items-center gap-2">{extraFilters}</div>
          )}
        </>
      )}

      <svg
        viewBox="0 0 200 110"
        className="h-auto w-full"
        role="img"
        aria-label={`Mappa ${skillLabel} di ${teamName(state.teams, side)}: ${view.total} azioni, traiettorie più frequenti ${shown
          .slice(0, 3)
          .map((a) => `da zona ${a.from} a zona ${a.to} (${a.count})`)
          .join(', ')}`}
      >
        <defs>
          {Object.keys(EVAL_CLASS).map((symbol) => (
            <marker
              key={symbol}
              id={`${uid}-head-${symbolId(symbol)}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" className={evalClass(symbol).fill} />
            </marker>
          ))}
          {/* Small head of the thin team arrows, in user units (it does not grow with the line). */}
          <marker
            id={`${uid}-head-team`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="3"
            markerHeight="3"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path
              d="M0 0 L10 5 L0 10 z"
              {...(arrowColor === undefined ? { className: SIDE_FILL[side] } : { fill: arrowColor })}
            />
          </marker>
        </defs>
        <rect x="0" y="0" width="200" height="110" rx="4" className="fill-court-free" />
        <rect
          x={COURT.x0}
          y={COURT.y0}
          width={COURT.net - COURT.x0}
          height={COURT.y1 - COURT.y0}
          {...(left.field === undefined ? { className: 'fill-court' } : { fill: left.field })}
        />
        <rect
          x={COURT.net}
          y={COURT.y0}
          width={COURT.x1 - COURT.net}
          height={COURT.y1 - COURT.y0}
          {...(right.field === undefined ? { className: 'fill-court' } : { fill: right.field })}
        />
        {ZONES.map((z) => {
          const r = zoneRect(z, 'opponent');
          const n = view.byTarget[z] ?? 0;
          if (!r) return null;
          return (
            <rect
              key={`t${z}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              className={SIDE_FILL[side]}
              fillOpacity={n > 0 ? 0.12 + 0.5 * (n / maxTarget) : 0}
            />
          );
        })}
        {(['own', 'opponent'] as const).flatMap((half) =>
          ZONES.map((z) => {
            const r = zoneRect(z, half);
            if (!r) return null;
            return (
              <g key={`${half}${z}`}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill="none"
                  className="stroke-court-line"
                  strokeOpacity="0.35"
                  strokeWidth="0.4"
                  strokeDasharray="1.5 1.5"
                />
                <text
                  x={r.x + 2.5}
                  y={r.y + 5.5}
                  className="fill-court-text"
                  fontSize="4.2"
                  fontWeight="600"
                  opacity="0.7"
                >
                  {z}
                </text>
              </g>
            );
          }),
        )}
        {/* Lines: perimeter, attack lines (3 m), net; each half in the colour of its team. */}
        <path d={halfPath(COURT.net, COURT.x0)} fill="none" {...lineProps(left.lines)} strokeWidth={lw} />
        <path d={halfPath(COURT.net, COURT.x1)} fill="none" {...lineProps(right.lines)} strokeWidth={lw} />
        <line
          x1={COURT.net - 30}
          y1={COURT.y0}
          x2={COURT.net - 30}
          y2={COURT.y1}
          {...lineProps(left.lines)}
          strokeWidth={0.7 * lw}
        />
        <line
          x1={COURT.net + 30}
          y1={COURT.y0}
          x2={COURT.net + 30}
          y2={COURT.y1}
          {...lineProps(right.lines)}
          strokeWidth={0.7 * lw}
        />
        <line
          x1={COURT.net}
          y1={COURT.y0 - 4}
          x2={COURT.net}
          y2={COURT.y1 + 4}
          {...lineProps(netColor)}
          strokeWidth={1.8 * lw}
        />
        <text x={COURT.x0} y="7" className="fill-court-line" fontSize="4.5" fontWeight="700">
          {teamShort(state.teams, side)}
        </text>
        <text x={COURT.x1} y="7" textAnchor="end" className="fill-court-line" fontSize="4.5" fontWeight="700">
          {teamShort(state.teams, opponent)}
        </text>

        {shown.map((a) => (
          <Arrow
            key={`${a.from}-${a.to}`}
            arrow={a}
            width={(0.8 + 3.2 * (a.share / maxShare)) * options.arrowWidth}
            markerId={teamArrows ? `${uid}-head-team` : `${uid}-head-${symbolId(a.dominant)}`}
            names={names}
            team={teamArrows ? side : null}
            color={arrowColor}
            thin={TEAM_ARROW_PX * options.arrowWidth}
          />
        ))}
        {ZONES.map((z) => {
          const n = view.byTarget[z] ?? 0;
          const c = zoneCenter(z, 'opponent');
          if (!c || n === 0) return null;
          return (
            <g key={`n${z}`}>
              <text
                x={c.x}
                y={c.y + 11}
                textAnchor="middle"
                className="fill-court-text"
                fontSize="4.6"
                fontWeight="700"
              >
                {n} · {formatPct(n / view.total)}
              </text>
            </g>
          );
        })}
        {view.total === 0 && (
          <text x="100" y="58" textAnchor="middle" className="fill-court-text" fontSize="6" fontWeight="600">
            Nessuna azione con zone per questo filtro
          </text>
        )}
      </svg>

      {teamArrows ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <span
            aria-hidden="true"
            className={`inline-block h-0.5 w-4 rounded-full ${arrowColor === undefined ? (side === 'home' ? 'bg-home' : 'bg-away') : ''}`}
            {...(arrowColor === undefined ? {} : { style: { backgroundColor: arrowColor } })}
          />
          Traiettorie di {teamName(state.teams, side)}: il numero e la percentuale sono le {skillLabel} arrivate in
          zona.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Colori delle valutazioni">
          {EVAL_ORDER.map((s) => (
            <li key={s} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={`inline-block h-1 w-4 rounded-full ${evalClass(s).bg}`} />
              {s} {names[s]}
            </li>
          ))}
        </ul>
      )}
      {view.arrows.length > MAX_ARROWS && (
        <p className="mt-1 text-xs text-muted">
          Mostrate le {MAX_ARROWS} traiettorie più frequenti su {view.arrows.length}.
        </p>
      )}
    </Card>
  );
}

const symbolId = (s: string): string => ({ '#': 'p', '+': 'g', '!': 'o', '-': 'n', '/': 's', '=': 'e' })[s] ?? 'x';

function Arrow({
  arrow,
  width,
  markerId,
  names,
  team,
  color,
  thin,
}: {
  arrow: ZoneArrow;
  width: number;
  markerId: string;
  names: Record<string, string>;
  /** Thin arrow in the colour of this team (template); null: colour of the evaluation, width as given. */
  team: Side | null;
  /** Colour chosen for these arrows (any evaluation); undefined: the one of the team or of the evaluation. */
  color: string | undefined;
  /** Width (px) of a thin team arrow. */
  thin: number;
}) {
  const start = zoneCenter(arrow.from, 'own');
  const end = zoneCenter(arrow.to, 'opponent');
  if (!start || !end) return null;
  // Slight curve so that arrows between the same rows do not overlap.
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2 - 6 - (Math.abs(end.y - start.y) < 1 ? 4 : 0);
  const detail = Object.entries(arrow.byEvaluation)
    .sort(([, x], [, y]) => y - x)
    .map(([s, n]) => `${s} ${names[s] ?? s}: ${n}`)
    .join(', ');
  return (
    <path
      d={`M${start.x} ${start.y} Q${mx} ${my} ${end.x} ${end.y}`}
      fill="none"
      {...(color !== undefined
        ? { stroke: color }
        : { className: team ? SIDE_STROKE[team] : evalClass(arrow.dominant).stroke })}
      strokeWidth={team ? thin : width}
      vectorEffect={team ? 'non-scaling-stroke' : undefined}
      strokeLinecap="round"
      strokeOpacity={team ? TEAM_ARROW_OPACITY : 0.9}
      markerEnd={`url(#${markerId})`}
    >
      <title>{`Da zona ${arrow.from} a zona ${arrow.to}: ${arrow.count} (${formatPct(arrow.share)}). ${detail}`}</title>
    </path>
  );
}
