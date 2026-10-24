import type { CourtOptions } from '@arenalive/shared';
import { COURT_TRICOLOR_DEFAULT, CourtOptionsSchema } from '@arenalive/shared';
import type { MatchState, Side } from '@arenalive/volley-stats';
import { useId, useMemo, useState } from 'react';
import type { CourtHalf, ZoneArrow, ZoneSkill } from '../charts/zones.ts';
import {
  COURT,
  EVALUATION_NAMES,
  ZONES,
  courtLayout,
  zoneCenter,
  zonePlayers,
  zoneRect,
  zoneView,
} from '../charts/zones.ts';
import { useOurSide, useTemplate } from '../lib/branding.ts';
import { courtSteps, useCourtStep } from '../lib/courtCycle.ts';
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

/** Line ink on the colours chosen in the Studio. */
const INK_DARK = '#1f2937';
const INK_LIGHT = '#f9fafb';

/** Dark or light ink, whichever reads better on a `#rrggbb` background. */
function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? INK_DARK : INK_LIGHT;
}

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
  fit = false,
}: {
  state: MatchState;
  className?: string;
  /** Big screen: the field shrinks to the height left in the card (never a scrollbar), keeping its proportions. */
  fit?: boolean;
  /** Colours and thickness chosen in the «Studio grafico»; the defaults draw the map as it always was. */
  options?: CourtOptions;
}) {
  const templateTeamArrows = useTemplate().courtArrows === 'team';
  const compact = useDeviceContext() === 'phone';
  const touch = useTouch();
  // «ours» is the team of the client (home when none is known).
  const ourSide = useOurSide();
  const ours: Side = ourSide ?? 'home';
  // Without touch (TV) the view chosen in the Studio, in turn when asked; with touch the filters start from it.
  const steps = useMemo(() => courtSteps(options.side, options.skill, ourSide), [options.side, options.skill, ourSide]);
  const step = useCourtStep(steps, options.cycleSeconds, !touch);
  const [manualSide, setSide] = useState<Side | null>(null);
  const [manualSkill, setSkill] = useState<ZoneSkill | null>(null);
  const first = steps[0] ?? step;
  const side: Side = touch ? (manualSide ?? first.side) : step.side;
  const skill: ZoneSkill = touch ? (manualSkill ?? first.skill) : step.skill;
  const inTurn = !touch && steps.length > 1;
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
  // As the scoreboard (home on the left) or the shown team on the left; each half in the colours of its team.
  const halves = courtLayout(side, options.orientation);
  const leftIsOurs = halves.left === ours;
  const left = leftIsOurs
    ? { field: options.fieldOurs, lines: options.linesOurs }
    : { field: options.fieldOpponent, lines: options.linesOpponent };
  const right = leftIsOurs
    ? { field: options.fieldOpponent, lines: options.linesOpponent }
    : { field: options.fieldOurs, lines: options.linesOurs };
  // Single colour or tricolour: the lines and the numbers left to the theme get a colour that reads on the field
  // (the theme ones can be light on a white band).
  const fieldOf = (own: string | undefined): string | undefined =>
    options.fieldMode === 'single' ? options.fieldColor : options.fieldMode === undefined ? own : undefined;
  const bands = options.fieldMode === 'tricolor' ? (options.tricolor ?? COURT_TRICOLOR_DEFAULT) : null;
  const ink =
    options.fieldMode === 'tricolor'
      ? INK_DARK
      : options.fieldMode === 'single' && options.fieldColor !== undefined
        ? inkOn(options.fieldColor)
        : undefined;
  if (ink !== undefined) {
    left.lines ??= ink;
    right.lines ??= ink;
  }
  const netColor = options.linesOurs ?? options.linesOpponent ?? ink;
  const arrowColor = side === ours ? options.arrowsOurs : options.arrowsOpponent;
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
      bodyClassName={fit ? 'flex flex-col' : ''}
      subtitle={`${view.total} ${skillLabel} con zone · ${teamName(state.teams, side)} → ${teamName(state.teams, opponent)}${inTurn ? ' · a turno' : ''}`}
    >
      {touch && (
        <>
          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
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
            <details className="mb-3 shrink-0 rounded-card border border-border bg-surface-2 px-3 py-1">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-text">
                Altri filtri
              </summary>
              <div className="flex flex-col items-start gap-2 pb-2">{extraFilters}</div>
            </details>
          ) : (
            <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">{extraFilters}</div>
          )}
        </>
      )}

      <svg
        data-court-side={side}
        data-court-skill={skill}
        viewBox="0 0 200 110"
        className={fit ? 'min-h-0 w-full flex-1' : 'h-auto w-full'}
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
        {bands ? (
          bands.map((fill, i) => (
            <rect
              key={`band${i}`}
              data-court-band={i}
              x={COURT.x0 + i * 2 * COURT.cell}
              y={COURT.y0}
              width={2 * COURT.cell}
              height={COURT.y1 - COURT.y0}
              fill={fill}
            />
          ))
        ) : (
          <>
            <rect
              x={COURT.x0}
              y={COURT.y0}
              width={COURT.net - COURT.x0}
              height={COURT.y1 - COURT.y0}
              {...(fieldOf(left.field) === undefined ? { className: 'fill-court' } : { fill: fieldOf(left.field) })}
            />
            <rect
              x={COURT.net}
              y={COURT.y0}
              width={COURT.x1 - COURT.net}
              height={COURT.y1 - COURT.y0}
              {...(fieldOf(right.field) === undefined ? { className: 'fill-court' } : { fill: fieldOf(right.field) })}
            />
          </>
        )}
        {ZONES.map((z) => {
          const r = zoneRect(z, halves.to);
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
                  {...(ink === undefined ? { className: 'stroke-court-line' } : { stroke: ink })}
                  strokeOpacity="0.35"
                  strokeWidth="0.4"
                  strokeDasharray="1.5 1.5"
                />
                <text
                  x={r.x + 2.5}
                  y={r.y + 5.5}
                  {...(ink === undefined ? { className: 'fill-court-text' } : { fill: ink })}
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
        <text
          x={COURT.x0}
          y="7"
          className="fill-court-line"
          fontSize="4.5"
          fontWeight="700"
          data-court-left={halves.left}
        >
          {teamShort(state.teams, halves.left)}
        </text>
        <text
          x={COURT.x1}
          y="7"
          textAnchor="end"
          className="fill-court-line"
          fontSize="4.5"
          fontWeight="700"
          data-court-right={halves.right}
        >
          {teamShort(state.teams, halves.right)}
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
            from={halves.from}
            to={halves.to}
          />
        ))}
        {ZONES.map((z) => {
          const n = view.byTarget[z] ?? 0;
          const c = zoneCenter(z, halves.to);
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
          // On a band of the background colour above net and cells, so that it reads on any field.
          <g data-court-empty="">
            <rect x="30" y="48" width="140" height="14" rx="3" className="fill-surface" fillOpacity="0.92" />
            <text x="100" y="57" textAnchor="middle" className="fill-text" fontSize="6" fontWeight="600">
              Nessuna azione con zone per questo filtro
            </text>
          </g>
        )}
      </svg>

      {teamArrows ? (
        <p className="mt-2 flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <span
            aria-hidden="true"
            className={`inline-block h-0.5 w-4 rounded-full ${arrowColor === undefined ? (side === 'home' ? 'bg-home' : 'bg-away') : ''}`}
            {...(arrowColor === undefined ? {} : { style: { backgroundColor: arrowColor } })}
          />
          Traiettorie di {teamName(state.teams, side)}: il numero e la percentuale sono le {skillLabel} arrivate in
          zona.
        </p>
      ) : (
        <ul
          className="mt-2 flex shrink-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted"
          aria-label="Colori delle valutazioni"
        >
          {EVAL_ORDER.map((s) => (
            <li key={s} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className={`inline-block h-1 w-4 rounded-full ${evalClass(s).bg}`} />
              {s} {names[s]}
            </li>
          ))}
        </ul>
      )}
      {view.arrows.length > MAX_ARROWS && (
        <p className="mt-1 shrink-0 text-xs text-muted">
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
  from,
  to,
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
  /** Half of the starting zone and half of the arrival zone. */
  from: CourtHalf;
  to: CourtHalf;
}) {
  const start = zoneCenter(arrow.from, from);
  const end = zoneCenter(arrow.to, to);
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
