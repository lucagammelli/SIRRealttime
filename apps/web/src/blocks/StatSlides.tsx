import type { BlockOptions } from '@sir/shared';
import type {
  MatchState,
  Period,
  PeriodSummary,
  PlayerPeriodLine,
  PlayerRef,
  Ratio,
  RoleDuel,
  Scorer,
  Side,
  TeamDuelKey,
} from '@sir/volley-stats';
import { periodSummary, roleDuels, scorers, teamDuel } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { barShares, leader } from '../charts/compare.ts';
import { BreakableName, Card, Empty } from '../components/ui.tsx';
import { formatCount, formatPct, playerName, teamName, teamShort } from '../lib/format.ts';
import { duelRoles, periodLabel } from '../lib/intermission.ts';
import { useReducedMotion } from '../lib/theme.ts';
import { useImageRotation } from './BrandBlocks.tsx';

/**
 * Statistics of a period in television style, for the slides of the pauses and the blocks of the page: partial and
 * scorers, aces, blocks, attack, player against player of a role, team against team. Every number comes from
 * @sir/volley-stats (`periodSummary`, `scorers`, `roleDuels`, `teamDuel`): here they are only laid out. Home team on
 * the left, away team on the right, in the colours of the two sides (they follow «nostra squadra» of the template:
 * lib/teamColors.ts); values with tabular figures; the two sides come in from their edge and the mirrored bars grow
 * from the centre in 500 ms, nothing moves with reduced motion. Only React text: names come from the scout file.
 *
 * Sizes: `full` a full screen pause (readable at 4-5 m), `card` a block of the page, `compact` one line of a banner.
 */
export type StatSize = 'full' | 'compact' | 'card';

type Role = RoleDuel['role'];

const SIDES: readonly Side[] = ['home', 'away'];
const INK: Record<Side, string> = { home: 'text-home-ink', away: 'text-away-ink' };
const BG: Record<Side, string> = { home: 'bg-home text-on-home', away: 'bg-away text-on-away' };
const BAR: Record<Side, string> = { home: 'bg-home', away: 'bg-away' };

/** Role names, singular and plural (title of the duel). */
export const ROLE_LABELS: Record<Role, { one: string; many: string }> = {
  opposite: { one: 'Opposto', many: 'opposti' },
  outside: { one: 'Schiacciatore', many: 'schiacciatori' },
  middle: { one: 'Centrale', many: 'centrali' },
  setter: { one: 'Palleggiatore', many: 'palleggiatori' },
  libero: { one: 'Libero', many: 'liberi' },
};

/** Short names of the rows of the team comparison, for the banner line. */
export const SHORT_ROW: Record<TeamDuelKey, string> = {
  points: 'Punti',
  aces: 'Ace',
  serveErrors: 'Err. battuta',
  serveEff: 'Eff. battuta',
  recPositive: 'Ric. positiva',
  recPerfect: 'Ric. perfetta',
  kills: 'Punti attacco',
  killPct: 'Attacco',
  attackEff: 'Eff. attacco',
  blocks: 'Muri',
  digs: 'Difese',
  errors: 'Errori',
  sideOut: 'Cambio palla',
  breakPoint: 'Break point',
};

/**
 * Text sizes of the full screen pause (phone first, big from `lg`: TV and tablet landscape; the TV text scales with
 * the screen) and of a block of the page.
 */
const TYPE = {
  full: {
    team: 'text-xl lg:text-4xl lg:[@media(max-height:820px)]:text-2xl',
    score: 'text-5xl lg:text-7xl',
    huge: 'text-6xl lg:text-8xl',
    value: 'text-2xl lg:text-4xl',
    bar: 'h-2.5 lg:h-4',
    rowLabel: 'w-24 text-xs lg:w-64 lg:text-xl',
    chip: 'h-9 w-11 text-xl lg:h-12 lg:w-14 lg:text-3xl',
    name: 'text-lg lg:text-3xl',
    detail: 'text-xs lg:text-xl',
    note: 'text-base lg:text-2xl',
    duelChip: 'h-16 w-20 text-5xl lg:h-28 lg:w-32 lg:text-8xl',
    duelName: 'text-2xl lg:text-5xl',
    duelTeam: 'text-sm lg:text-2xl',
    duelRole: 'text-xs lg:text-xl',
  },
  card: {
    team: 'text-base',
    score: 'text-4xl',
    huge: 'text-5xl',
    value: 'text-lg',
    bar: 'h-2.5',
    rowLabel: 'w-28 text-xs',
    chip: 'h-7 w-9 text-base',
    name: 'text-base',
    detail: 'text-xs',
    note: 'text-sm',
    duelChip: 'h-12 w-14 text-3xl',
    duelName: 'text-xl',
    duelTeam: 'text-sm',
    duelRole: 'text-xs',
  },
} as const;
/** Full screen with many rows (all the rows of the comparison, many scorers): smaller rows, still one screen. */
const DENSE_FULL = {
  ...TYPE.full,
  value: 'text-xl lg:text-2xl',
  bar: 'h-2 lg:h-3',
  rowLabel: 'w-24 text-xs lg:w-56 lg:text-base',
  chip: 'h-8 w-10 text-lg lg:h-10 lg:w-12 lg:text-2xl',
  name: 'text-base lg:text-2xl',
};
/** More rows than this in a full screen slide: the dense sizes. */
const DENSE_ROWS = 6;
const typeOf = (size: StatSize, dense = false) => (size === 'full' ? (dense ? DENSE_FULL : TYPE.full) : TYPE.card);

/** Rows of the comparison in a banner line: the first ones chosen. */
const COMPACT_ROWS = 5;
/** Seconds of every role of a block «a rotazione». */
const ROLE_ROTATION_SECONDS = 8;

/** Surname for the big screen («Semeniuk»), the short name when the file has no surname. */
export function surname(player: PlayerRef | null, number: number): string {
  return player?.lastName?.trim() || playerName(player ?? undefined, number);
}

/** Classes of the entrance of a side (none with reduced motion). */
function useEnter(): Record<Side, string> & { grow: string } {
  const reduced = useReducedMotion();
  return reduced
    ? { home: '', away: '', grow: '' }
    : { home: 'sir-enter-left', away: 'sir-enter-right', grow: 'sir-grow' };
}

/** Band with the title of the slide: what it is and the period. */
function TitleBand({ title, period, size }: { title: string; period: Period; size: StatSize }) {
  if (size === 'card') return null;
  return (
    <p className="flex justify-center">
      <span className="rounded-card bg-primary px-5 py-1.5 font-display text-lg font-bold uppercase tracking-wide text-on-primary lg:text-3xl lg:[@media(max-height:820px)]:text-xl">
        {title}
        <span className="opacity-80"> · {periodLabel(period)}</span>
      </span>
    </p>
  );
}

/** Partial of the period: score of the set or sets won, the two team names on their side. */
function ScoreLine({ state, summary, size }: { state: MatchState; summary: PeriodSummary; size: StatSize }) {
  const t = typeOf(size);
  const label =
    summary.score.kind === 'set'
      ? `Parziale ${summary.score.home} a ${summary.score.away}`
      : `Set vinti ${summary.score.home} a ${summary.score.away}`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 font-display font-bold uppercase">
      <TeamTitle state={state} side="home" className={`text-right ${t.team}`} />
      <span aria-label={label} className={`tabular-nums whitespace-nowrap text-text ${t.score}`}>
        {summary.score.home}-{summary.score.away}
      </span>
      <TeamTitle state={state} side="away" className={t.team} />
    </div>
  );
}

/**
 * Name of a team in a statistic: at most two lines, wrapping between its words and parts («PERUGIA_AMICHEVOLI»),
 * then an ellipsis; the whole name in `title`.
 */
function TeamTitle({
  state,
  side,
  className = '',
  plain = false,
}: {
  state: MatchState;
  side: Side;
  className?: string;
  /** In the colour of the text instead of the colour of the team. */
  plain?: boolean;
}) {
  const name = teamName(state.teams, side);
  return (
    <span
      title={name}
      className={`line-clamp-2 min-w-0 max-w-full break-words leading-tight ${plain ? 'text-text' : INK[side]} ${className}`}
    >
      <BreakableName text={name} />
    </span>
  );
}

/** The two team names over the mirrored rows: home on the left, away on the right, never one over the other. */
function TeamHeader({ state, size }: { state: MatchState; size: StatSize }) {
  return (
    <div className={`grid grid-cols-2 gap-x-4 font-display font-bold uppercase ${typeOf(size).team}`}>
      <TeamTitle state={state} side="home" />
      <TeamTitle state={state} side="away" className="text-right" />
    </div>
  );
}

const valueText = (kind: 'count' | 'ratio', v: number | null): string =>
  kind === 'ratio' ? formatPct(v) : formatCount(v);

/**
 * One mirrored row: value and bar of the home team growing to the left, the name of the row in the middle, bar and
 * value of the away team growing to the right; the better value in bold and in the colour of its team.
 */
export function MirrorRow({
  label,
  kind,
  home,
  away,
  better = 'high',
  size,
  dense = false,
}: {
  label: string;
  kind: 'count' | 'ratio';
  home: number | null;
  away: number | null;
  better?: 'high' | 'low';
  size: StatSize;
  dense?: boolean;
}) {
  const enter = useEnter();
  const shares = barShares({ kind, home, away });
  const best = leader({ better, home, away });
  const { value, bar, rowLabel } = typeOf(size, dense);
  // One grid: bar | value | label | value | bar. The values have their own columns, at least 6 characters wide
  // («100,0%») with tabular figures: a value never covers its bar or the label, whatever the width of the card.
  return (
    <div
      data-mirror-row=""
      className="grid grid-cols-[minmax(1.5rem,1fr)_auto_auto_auto_minmax(1.5rem,1fr)] items-center gap-x-2 sm:gap-x-3"
    >
      <span className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${bar}`}>
        <span
          className={`sir-bar absolute inset-y-0 right-0 origin-right rounded-full ${enter.grow} ${BAR.home}`}
          style={{ width: `${shares.home * 100}%` }}
        />
      </span>
      <span
        data-value="home"
        className={`tabular-nums min-w-[6ch] whitespace-nowrap text-right font-display font-bold ${value} ${best === 'home' ? INK.home : 'text-text'}`}
      >
        {valueText(kind, home)}
      </span>
      <span className={`text-center font-medium uppercase leading-tight tracking-wide text-muted ${rowLabel}`}>
        {label}
      </span>
      <span
        data-value="away"
        className={`tabular-nums min-w-[6ch] whitespace-nowrap text-left font-display font-bold ${value} ${best === 'away' ? INK.away : 'text-text'}`}
      >
        {valueText(kind, away)}
      </span>
      <span className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${bar}`}>
        <span
          className={`sir-bar absolute inset-y-0 left-0 origin-left rounded-full ${enter.grow} ${BAR.away}`}
          style={{ width: `${shares.away * 100}%` }}
        />
      </span>
    </div>
  );
}

/** A list of one team: maglia in the colour of the team, surname, value. */
function PlayerList({
  side,
  rows,
  size,
  empty,
}: {
  side: Side;
  rows: readonly { number: number; player: PlayerRef | null; value: string; detail?: string }[];
  size: StatSize;
  empty: string;
}) {
  const enter = useEnter();
  const t = typeOf(size, rows.length > DENSE_ROWS);
  if (rows.length === 0) return <p className={`text-center text-muted ${t.note}`}>{empty}</p>;
  // Two lists side by side from 28 rem of the container (`TeamLists`), one under the other below: the away list is
  // mirrored only when side by side. Name on one line with an ellipsis (whole name in `title`), the detail under it.
  return (
    <ol className={`space-y-1.5 ${enter[side]}`}>
      {rows.map((r) => {
        const name = surname(r.player, r.number);
        return (
          <li
            key={r.number}
            className={`flex items-center gap-3 ${side === 'away' ? '@md:flex-row-reverse @md:text-right' : ''}`}
          >
            <span
              className={`tabular-nums inline-flex shrink-0 items-center justify-center rounded-card font-display font-bold ${BG[side]} ${t.chip}`}
            >
              {r.number}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span title={name} className={`truncate font-display font-semibold uppercase text-text ${t.name}`}>
                {name}
              </span>
              {r.detail && <span className={`truncate text-muted ${t.detail}`}>{r.detail}</span>}
            </span>
            <span className={`tabular-nums shrink-0 whitespace-nowrap font-display font-bold text-text ${t.value}`}>
              {r.value}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The lists of the two teams: side by side when the container is at least 28 rem wide, otherwise one under the other. */
function TeamLists({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 @md:grid-cols-2 @4xl:gap-x-24">{children}</div>
    </div>
  );
}

/** Frame of a slide or of a block: full screen centred, a card with its title, or a line of the banner. */
function Frame({ size, title, children }: { size: StatSize; title: string; children: ReactNode }) {
  if (size === 'card')
    return (
      <Card title={title} className="h-full min-h-0">
        <div className="space-y-3">{children}</div>
      </Card>
    );
  // At least as tall as the slide (centred), taller when its rows need it (the slide scrolls); less space between the
  // parts on low screens.
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center gap-6 [@media(max-height:820px)]:gap-3">
      {children}
    </div>
  );
}

const noData = (period: Period): string =>
  period.kind === 'match' ? 'Nessun dato della partita.' : `Il ${period.set}° set non è ancora iniziato.`;

const teamLine = (state: MatchState, side: Side, text: string): ReactNode => (
  <>
    <span className={`font-bold ${INK[side]}`}>{teamShort(state.teams, side)}</span> {text}
  </>
);

// ── Partial and scorers ─────────────────────────────────────────────────────────────────────────────────────────

/** Partial of the period and the scorers of each team (the first `limit`, points of attack, block and ace). */
export function SetScorersView({
  state,
  period,
  options,
  size,
}: {
  state: MatchState;
  period: Period;
  options: Pick<BlockOptions<'setScorers'>, 'limit'>;
  size: StatSize;
}) {
  const summary = periodSummary(state, period);
  const title = 'Parziale e marcatori';
  if (!summary)
    return size === 'compact' ? null : (
      <Frame size={size} title={title}>
        <Empty>{noData(period)}</Empty>
      </Frame>
    );
  const lists = {
    home: scorers(state, period, 'home', options.limit),
    away: scorers(state, period, 'away', options.limit),
  };
  if (size === 'compact') {
    const names = (side: Side): string =>
      lists[side]
        .slice(0, 3)
        .map((p) => `${surname(p.player, p.number)} ${p.points}`)
        .join(', ') || 'nessun punto';
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">Marcatori · {periodLabel(period)}: </span>
        <span className="tabular-nums font-display text-lg font-bold">
          {teamShort(state.teams, 'home')} {summary.score.home}-{summary.score.away} {teamShort(state.teams, 'away')}
        </span>
        <span> · {teamLine(state, 'home', names('home'))}</span>
        <span> · {teamLine(state, 'away', names('away'))}</span>
      </p>
    );
  }
  return (
    <Frame size={size} title={`${title} · ${periodLabel(period)}`}>
      <TitleBand title={title} period={period} size={size} />
      <ScoreLine state={state} summary={summary} size={size} />
      <TeamLists>
        {SIDES.map((side) => (
          <PlayerList
            key={side}
            side={side}
            size={size}
            empty="Nessun punto"
            rows={lists[side].map((p) => ({
              number: p.number,
              player: p.player,
              value: String(p.points),
              detail: `${p.attackPoints} att · ${p.blocks} muri · ${p.aces} ace`,
            }))}
          />
        ))}
      </TeamLists>
    </Frame>
  );
}

// ── Aces and blocks ─────────────────────────────────────────────────────────────────────────────────────────────

const COUNT_TEXT = {
  aces: { title: 'Ace', none: 'Nessun ace', one: 'ace', many: 'ace' },
  blocks: { title: 'Muri vincenti', none: 'Nessun muro vincente', one: 'muro', many: 'muri' },
} as const;

/** Aces or point blocks of each team in the period and who scored them. */
export function CountView({
  state,
  period,
  kind,
  size,
}: {
  state: MatchState;
  period: Period;
  kind: 'aces' | 'blocks';
  size: StatSize;
}) {
  const enter = useEnter();
  const text = COUNT_TEXT[kind];
  const summary = periodSummary(state, period);
  if (!summary)
    return size === 'compact' ? null : (
      <Frame size={size} title={text.title}>
        <Empty>{noData(period)}</Empty>
      </Frame>
    );
  const count = (side: Side): number => (kind === 'aces' ? summary.teams[side].aces : summary.teams[side].blockPoints);
  const list = (side: Side): Scorer[] =>
    kind === 'aces' ? summary.teams[side].aceScorers : summary.teams[side].blockScorers;
  const total = count('home') + count('away');
  const none = `${text.none} ${period.kind === 'match' ? 'nella partita' : `nel ${period.set}° set`}.`;
  if (size === 'compact') {
    const part = (side: Side): string => {
      const names = list(side)
        .map((s) => `${surname(s.player, s.number)} ${s.count}`)
        .join(', ');
      return `${count(side)}${names ? ` (${names})` : ''}`;
    };
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">
          {text.title} · {periodLabel(period)}:{' '}
        </span>
        {total === 0 ? (
          <span className="text-muted">{none}</span>
        ) : (
          <>
            <span className="tabular-nums">{teamLine(state, 'home', part('home'))}</span>
            <span className="tabular-nums"> · {teamLine(state, 'away', part('away'))}</span>
          </>
        )}
      </p>
    );
  }
  const t = typeOf(size);
  return (
    <Frame size={size} title={`${text.title} · ${periodLabel(period)}`}>
      <TitleBand title={text.title} period={period} size={size} />
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 font-display font-bold uppercase">
        {SIDES.map((side) => (
          <div
            key={side}
            className={`flex min-w-0 flex-col ${side === 'home' ? 'order-1 items-end text-right' : 'order-3 items-start'} ${enter[side]}`}
          >
            <span className={`tabular-nums leading-none ${t.huge} ${INK[side]}`}>{count(side)}</span>
            <TeamTitle state={state} side={side} plain className={t.team} />
          </div>
        ))}
        <span className={`order-2 text-muted ${t.team}`}>{text.many}</span>
      </div>
      {total === 0 ? (
        <p className={`text-center text-muted ${t.note}`}>{none}</p>
      ) : (
        <TeamLists>
          {SIDES.map((side) => (
            <PlayerList
              key={side}
              side={side}
              size={size}
              empty={text.none}
              rows={list(side).map((s) => ({ number: s.number, player: s.player, value: String(s.count) }))}
            />
          ))}
        </TeamLists>
      )}
    </Frame>
  );
}

// ── Attack ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Best attackers of a team in the period: the players with attacks, by attack points (then percentage). Only the
 * order of the lines of `periodSummary` changes here, every number comes from @sir/volley-stats.
 */
function bestAttackers(lines: readonly PlayerPeriodLine[], limit: number): PlayerPeriodLine[] {
  const pct = (r: Ratio): number => r ?? -1;
  return lines
    .filter((l) => l.attack.total > 0)
    .sort((a, b) => b.attack.kills - a.attack.kills || pct(b.attack.killPct) - pct(a.attack.killPct))
    .slice(0, limit);
}

/** Attack of each team (percentage of points and efficiency) and its best attackers. */
export function AttackView({
  state,
  period,
  options,
  size,
}: {
  state: MatchState;
  period: Period;
  options: Pick<BlockOptions<'attack'>, 'limit'>;
  size: StatSize;
}) {
  const summary = periodSummary(state, period);
  const title = 'Attacco';
  if (!summary)
    return size === 'compact' ? null : (
      <Frame size={size} title={title}>
        <Empty>{noData(period)}</Empty>
      </Frame>
    );
  const { home, away } = summary.teams;
  const best = { home: bestAttackers(home.players, options.limit), away: bestAttackers(away.players, options.limit) };
  if (size === 'compact') {
    const part = (side: Side): string => {
      const t = summary.teams[side];
      const top = best[side][0];
      return `${formatPct(t.attackKillPct)} (eff. ${formatPct(t.attackEfficiency)})${top ? `, ${surname(top.player, top.number)} ${top.attack.kills}/${top.attack.total}` : ''}`;
    };
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">Attacco · {periodLabel(period)}: </span>
        <span className="tabular-nums">{teamLine(state, 'home', part('home'))}</span>
        <span className="tabular-nums"> · {teamLine(state, 'away', part('away'))}</span>
      </p>
    );
  }
  return (
    <Frame size={size} title={`${title} · ${periodLabel(period)}`}>
      <TitleBand title={title} period={period} size={size} />
      <TeamHeader state={state} size={size} />
      <div className="space-y-3">
        <MirrorRow
          label="Punti in attacco"
          kind="count"
          home={home.attackPoints}
          away={away.attackPoints}
          size={size}
        />
        <MirrorRow label="% punti" kind="ratio" home={home.attackKillPct} away={away.attackKillPct} size={size} />
        <MirrorRow
          label="Efficienza"
          kind="ratio"
          home={home.attackEfficiency}
          away={away.attackEfficiency}
          size={size}
        />
      </div>
      <TeamLists>
        {SIDES.map((side) => (
          <PlayerList
            key={side}
            side={side}
            size={size}
            empty="Nessun attacco"
            rows={best[side].map((p) => ({
              number: p.number,
              player: p.player,
              value: formatPct(p.attack.killPct),
              detail: `${p.attack.kills}/${p.attack.total}`,
            }))}
          />
        ))}
      </TeamLists>
    </Frame>
  );
}

// ── Player against player ───────────────────────────────────────────────────────────────────────────────────────

/** Rows of a duel: points, aces, blocks and attack; for the libero reception and digs (a libero does not score). */
function duelRows(
  role: Role,
  d: RoleDuel,
): { label: string; kind: 'count' | 'ratio'; home: number | null; away: number | null }[] {
  if (role === 'libero')
    return [
      {
        label: 'Ricezione positiva',
        kind: 'ratio',
        home: d.home.reception.positivePct,
        away: d.away.reception.positivePct,
      },
      {
        label: 'Ricezione perfetta',
        kind: 'ratio',
        home: d.home.reception.perfectPct,
        away: d.away.reception.perfectPct,
      },
      { label: 'Ricezioni', kind: 'count', home: d.home.reception.total, away: d.away.reception.total },
      { label: 'Difese', kind: 'count', home: d.home.digs, away: d.away.digs },
    ];
  return [
    { label: 'Punti', kind: 'count', home: d.home.points, away: d.away.points },
    { label: 'Ace', kind: 'count', home: d.home.aces, away: d.away.aces },
    { label: 'Muri', kind: 'count', home: d.home.blocks, away: d.away.blocks },
    { label: 'Attacco %', kind: 'ratio', home: d.home.attack.killPct, away: d.away.attack.killPct },
  ];
}

/** One of the two players of a duel: big number, surname, team, role. */
function DuelPlayer({
  state,
  line,
  side,
  role,
  size,
}: {
  state: MatchState;
  line: PlayerPeriodLine;
  side: Side;
  role: Role;
  size: StatSize;
}) {
  const enter = useEnter();
  const t = typeOf(size);
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 ${side === 'home' ? 'items-start' : 'items-end text-right'} ${enter[side]}`}
    >
      <span
        className={`tabular-nums inline-flex items-center justify-center rounded-panel font-display font-bold ${BG[side]} ${t.duelChip}`}
      >
        {line.number}
      </span>
      <span
        title={surname(line.player, line.number)}
        className={`max-w-full truncate font-display font-bold uppercase text-text ${t.duelName}`}
      >
        {surname(line.player, line.number)}
      </span>
      <TeamTitle state={state} side={side} className={`font-display font-semibold uppercase ${t.duelTeam}`} />
      <span className={`uppercase tracking-wide text-muted ${t.duelRole}`}>{ROLE_LABELS[role].one}</span>
    </div>
  );
}

/** The duel of `role` in the period: the first player of each team in that role (`roleDuels`), face to face. */
export function DuelView({
  state,
  period,
  role,
  size,
}: {
  state: MatchState;
  period: Period;
  role: Role;
  size: StatSize;
}) {
  const duel = roleDuels(state, period).find((d) => d.role === role && d.rank === 1);
  const title = `Sfida tra ${ROLE_LABELS[role].many}`;
  if (!duel)
    return size === 'compact' ? null : (
      <Frame size={size} title={title}>
        <Empty>Nessuna sfida tra {ROLE_LABELS[role].many} in questo periodo.</Empty>
      </Frame>
    );
  const rows = duelRows(role, duel);
  if (size === 'compact') {
    const part = (side: Side): string => {
      const line = duel[side];
      const values = rows.map((r) => `${valueText(r.kind, r[side])} ${r.label.toLowerCase()}`).join(', ');
      return `${line.number} ${surname(line.player, line.number)} ${values}`;
    };
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">
          {title} · {periodLabel(period)}:{' '}
        </span>
        <span className="tabular-nums">{teamLine(state, 'home', part('home'))}</span>
        <span className="tabular-nums"> · {teamLine(state, 'away', part('away'))}</span>
      </p>
    );
  }
  return (
    <Frame size={size} title={`${title} · ${periodLabel(period)}`}>
      <TitleBand title={title} period={period} size={size} />
      <div className="grid grid-cols-2 items-end gap-x-6">
        <DuelPlayer state={state} line={duel.home} side="home" role={role} size={size} />
        <DuelPlayer state={state} line={duel.away} side="away" role={role} size={size} />
      </div>
      <div className="space-y-3">
        {rows.map((r) => (
          <MirrorRow key={r.label} label={r.label} kind={r.kind} home={r.home} away={r.away} size={size} />
        ))}
      </div>
    </Frame>
  );
}

/** Duel of a block or a slide: one role, or every role with a duel in turn (stopped with the rotation). */
export function RoleDuelView({
  state,
  period,
  role,
  size,
  paused,
}: {
  state: MatchState;
  period: Period;
  role: BlockOptions<'roleDuel'>['role'];
  size: StatSize;
  paused: boolean;
}) {
  const reduced = useReducedMotion();
  const roles = duelRoles(state, period);
  const index = useImageRotation(role === 'rotate' ? roles.length : 0, ROLE_ROTATION_SECONDS, paused || reduced);
  const shown: Role | undefined = role === 'rotate' ? roles[index] : role;
  if (!shown)
    return size === 'compact' ? null : (
      <Frame size={size} title="Sfide per ruolo">
        <Empty>Nessuna sfida per ruolo in questo periodo.</Empty>
      </Frame>
    );
  return <DuelView key={shown} state={state} period={period} role={shown} size={size} />;
}

// ── Team against team ───────────────────────────────────────────────────────────────────────────────────────────

/** Team against team in the period: the rows of `teamDuel` chosen (all when none is chosen). */
export function TeamDuelView({
  state,
  period,
  options,
  size,
}: {
  state: MatchState;
  period: Period;
  options: Pick<BlockOptions<'teamDuel'>, 'rows'>;
  size: StatSize;
}) {
  const chosen = new Set<string>(options.rows);
  const rows = teamDuel(state, period).filter((r) => chosen.size === 0 || chosen.has(r.key));
  const title = 'Squadre a confronto';
  if (rows.every((r) => r.home === null && r.away === null))
    return size === 'compact' ? null : (
      <Frame size={size} title={title}>
        <Empty>{noData(period)}</Empty>
      </Frame>
    );
  if (size === 'compact') {
    const parts = rows
      .slice(0, COMPACT_ROWS)
      .map((r) => `${SHORT_ROW[r.key]} ${valueText(r.kind, r.home)}-${valueText(r.kind, r.away)}`);
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">Squadre · {periodLabel(period)}: </span>
        <span className="tabular-nums">{parts.join(' · ')}</span>
      </p>
    );
  }
  const big = size === 'full';
  const dense = rows.length > DENSE_ROWS;
  return (
    <Frame size={size} title={`${title} · ${periodLabel(period)}`}>
      <TitleBand title={title} period={period} size={size} />
      <TeamHeader state={state} size={size} />
      <div className={big && !dense ? 'space-y-2 lg:space-y-3' : 'space-y-1.5'}>
        {rows.map((r) => (
          <MirrorRow
            key={r.key}
            label={big ? r.label : SHORT_ROW[r.key]}
            kind={r.kind}
            home={r.home}
            away={r.away}
            better={r.better}
            size={size}
            dense={dense}
          />
        ))}
      </div>
    </Frame>
  );
}
