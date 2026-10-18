import type { TeamLogoPair } from '@sir/shared';
import type { MatchState, Side } from '@sir/volley-stats';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTemplate } from '../lib/branding.ts';
import { formatMinutes, SIDE_LABEL, teamName, teamShort } from '../lib/format.ts';
import type { Device } from '../lib/layout.ts';
import type { SetPartial } from '../lib/scoreboard.ts';
import { useStickyOffset } from '../lib/useLayout.ts';
import { matchHeadline, matchMinutes, matchWinner, setPartials, statusLabel } from '../lib/scoreboard.ts';
import { BrandMark } from './BrandMark.tsx';
import { BreakableName } from './ui.tsx';

const SIDES: Side[] = ['home', 'away'];
/** Team names longer than this (characters) are written smaller in the scoreboard of the template. */
const LONG_NAME = 20;
/** Team colour for big text (score, names on the tablet: 3:1 is enough) and as small text (`-ink`, 4.5:1). */
const TEXT: Record<Side, string> = { home: 'text-home', away: 'text-away' };
const INK: Record<Side, string> = { home: 'text-home-ink', away: 'text-away-ink' };
const BG: Record<Side, string> = { home: 'bg-home', away: 'bg-away' };
const SOFT: Record<Side, string> = { home: 'bg-home-soft', away: 'bg-away-soft' };
const ON: Record<Side, string> = { home: 'text-on-home', away: 'text-on-away' };

/** Sizes of the big scoreboard: tablet and big screen (on the TV every rem scales with the screen). */
const SIZES = {
  tablet: {
    score: 'text-8xl',
    colon: 'text-6xl',
    sets: 'text-5xl',
    name: 'text-2xl',
    facts: 'text-sm',
    logo: 'size-10',
  },
  tv: {
    score: 'text-[min(20vh,10rem)]',
    colon: 'text-7xl',
    sets: 'text-6xl',
    name: 'text-4xl',
    facts: 'text-base',
    logo: 'size-16',
  },
} as const;

function ServeDot({ side, active, small = false }: { side: Side; active: boolean; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${small ? 'size-2' : 'size-4'} ${active ? `${BG[side]} sir-pulse` : 'bg-transparent'}`}
    />
  );
}

/**
 * Logo of a team next to its name (chosen by the server: «Loghi delle squadre»); nothing at all when missing or not
 * loading, so the name stays aligned without an empty space.
 */
export function TeamLogo({ url, className }: { url: string | null | undefined; className: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (!url || broken === url) return null;
  return (
    <img
      src={url}
      alt=""
      data-testid="team-logo"
      onError={() => setBroken(url)}
      className={`shrink-0 object-contain ${className}`}
    />
  );
}

/** Thin stripe in the two team colours on top of the scoreboard. */
function TeamStripe() {
  return (
    <div aria-hidden="true" className="grid h-1.5 grid-cols-2">
      <span className="bg-home" />
      <span className="bg-away" />
    </div>
  );
}

/** Score of the set: the digit that changes pops (≤ 600 ms, none with reduced motion). */
function Score({
  state,
  names,
  size,
  colon,
}: {
  state: MatchState;
  names: Record<Side, string>;
  size: string;
  colon: string;
}) {
  const { live } = state;
  return (
    <div
      className="flex items-center justify-center gap-1 font-display font-bold leading-none tabular sm:gap-3"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="sr-only">
        Punteggio del {live.set}° set: {names.home} {live.homeScore}, {names.away} {live.awayScore}
      </span>
      <span
        aria-hidden="true"
        key={`h${live.set}-${live.homeScore}`}
        className={`sir-pop sir-score inline-block ${size} ${TEXT.home}`}
      >
        {live.homeScore}
      </span>
      <span aria-hidden="true" className={`${colon} text-muted`}>
        :
      </span>
      <span
        aria-hidden="true"
        key={`a${live.set}-${live.awayScore}`}
        className={`sir-pop sir-score inline-block ${size} ${TEXT.away}`}
      >
        {live.awayScore}
      </span>
    </div>
  );
}

export function Partials({ partials, compact = false }: { partials: SetPartial[]; compact?: boolean }) {
  if (partials.length === 0) return null;
  return (
    <ol
      aria-label="Parziali dei set"
      className={
        compact
          ? 'sir-scroll-x flex flex-nowrap justify-center gap-1.5 px-2 pb-2'
          : 'flex flex-wrap justify-center gap-2 px-3 pb-3 sm:px-6'
      }
    >
      {partials.map((p) => (
        <li
          key={p.number}
          className={`flex shrink-0 items-center gap-1.5 rounded-card border tabular ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'} ${
            p.current ? 'border-focus bg-surface-2' : 'border-border bg-surface'
          }`}
        >
          <span className="text-xs font-semibold uppercase text-muted">{p.number}° set</span>
          <span className={p.winner === 'home' ? 'font-bold text-home-ink' : 'text-text'}>{p.home}</span>
          <span className="text-muted">-</span>
          <span className={p.winner === 'away' ? 'font-bold text-away-ink' : 'text-text'}>{p.away}</span>
          {p.current && <span className="text-xs font-medium text-live">in corso</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Big score of the match: first thing on the page, readable from far away. With the team colours, the logo of the
 * client (`brand`, big screen) and the score in the display font.
 * `phone`: compact scoreboard fixed on top while scrolling (teams, sets and score), the facts of the set under it.
 * `logos`: the logos of the teams next to their names (missing: none).
 */
export function Scoreboard({
  state,
  status,
  device = 'tablet',
  brand = false,
  logos,
}: {
  state: MatchState;
  status?: ReactNode;
  device?: Device;
  brand?: boolean;
  logos?: TeamLogoPair | undefined;
}) {
  const sticky = useRef<HTMLElement>(null);
  useStickyOffset(sticky, device === 'phone');
  const template = useTemplate();
  const winner = matchWinner(state);
  const partials = setPartials(state);
  const minutes = matchMinutes(state);
  const serving = state.status === 'finished' ? null : state.live.servingTeam;
  const names: Record<Side, string> = { home: teamName(state.teams, 'home'), away: teamName(state.teams, 'away') };

  const topBar = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-1.5 sm:px-6 sm:py-2">
      <div className="flex min-w-0 items-center gap-3">
        {brand && <BrandMark />}
        <p className={`min-w-0 font-medium text-muted ${device === 'phone' ? 'text-xs' : 'text-sm'}`}>
          <span className="text-text">{statusLabel(state)}</span>
          {minutes !== null && <span> · {formatMinutes(minutes)}</span>}
        </p>
      </div>
      {status}
    </div>
  );

  if (device === 'phone') {
    const short: Record<Side, string> = { home: teamShort(state.teams, 'home'), away: teamShort(state.teams, 'away') };
    return (
      <>
        <section
          ref={sticky}
          aria-label="Tabellone"
          className="sir-scoreboard sticky top-0 z-20 overflow-hidden rounded-panel border border-border shadow-card"
        >
          <TeamStripe />
          {topBar}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-2 py-2">
            {SIDES.map((side) => (
              <div
                key={side}
                className={`flex min-w-0 items-center gap-1.5 ${side === 'home' ? 'order-1' : 'order-3 flex-row-reverse'}`}
              >
                <span
                  className={`rounded-card px-2 font-display text-2xl font-bold tabular ${SOFT[side]} ${INK[side]}`}
                  aria-label={`Set vinti ${SIDE_LABEL[side]}`}
                >
                  {state.setsWon[side]}
                </span>
                <TeamLogo url={logos?.[side]} className="size-7" />
                <div className={`min-w-0 ${side === 'home' ? 'text-left' : 'text-right'}`}>
                  <h2
                    className={`truncate font-display text-base font-bold uppercase leading-tight ${INK[side]}`}
                    title={names[side]}
                  >
                    <span aria-hidden="true">{short[side]}</span>
                    <span className="sr-only">{names[side]}</span>
                  </h2>
                  <span className={`flex items-center gap-1 ${side === 'away' ? 'justify-end' : ''}`}>
                    <ServeDot side={side} active={serving === side} small />
                    {winner === side && (
                      <span className={`rounded-card px-1.5 text-[10px] font-semibold ${BG[side]} ${ON[side]}`}>
                        Vince
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ))}
            <div className="order-2">
              <Score state={state} names={names} size="text-5xl" colon="text-3xl" />
            </div>
          </div>
          <Partials partials={partials} compact />
        </section>
        <ScoreFacts state={state} size="text-sm" />
      </>
    );
  }

  if (template.scoreboard === 'mockup')
    return (
      <TemplateScoreboard state={state} status={status} brand={brand} names={names} serving={serving} logos={logos} />
    );

  const size = SIZES[device];
  return (
    <section
      aria-label="Tabellone"
      className="sir-scoreboard relative overflow-hidden rounded-panel border border-border shadow-card"
    >
      <TeamStripe />
      {topBar}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-6 py-4">
        {SIDES.map((side) => (
          <div
            key={side}
            className={`flex min-w-0 flex-col ${side === 'home' ? 'order-1 items-start' : 'order-3 items-end'}`}
          >
            <div className={`flex w-full items-center gap-2 ${side === 'home' ? 'justify-start' : 'justify-end'}`}>
              {side === 'home' && <ServeDot side={side} active={serving === side} />}
              {side === 'home' && <TeamLogo url={logos?.home} className={size.logo} />}
              <h2
                className={`min-w-0 truncate font-display font-bold uppercase leading-tight ${size.name} ${TEXT[side]}`}
                title={names[side]}
              >
                {names[side]}
              </h2>
              {side === 'away' && <TeamLogo url={logos?.away} className={size.logo} />}
              {side === 'away' && <ServeDot side={side} active={serving === side} />}
            </div>
            <div className={`mt-2 flex items-center gap-3 ${side === 'away' ? 'flex-row-reverse' : ''}`}>
              <span
                className={`rounded-card px-3 font-display font-bold tabular ${size.sets} ${SOFT[side]} ${TEXT[side]}`}
                aria-label={`Set vinti ${SIDE_LABEL[side]}`}
              >
                {state.setsWon[side]}
              </span>
              <span className="text-xs uppercase tracking-wide text-muted">set</span>
              {winner === side && (
                <span className={`rounded-card px-2 py-0.5 text-xs font-semibold ${BG[side]} ${ON[side]}`}>Vince</span>
              )}
            </div>
          </div>
        ))}
        <div className="order-2">
          <Score state={state} names={names} size={size.score} colon={size.colon} />
        </div>
      </div>
      <Partials partials={partials} />
      <ScoreFacts state={state} size={size.facts} framed={false} />
    </section>
  );
}

/**
 * Scoreboard of the template «SIR VOLLEY» (tablet, desktop, big screen), as the mockup of the specifications: status
 * and duration on top with the connection badge, the names in capitals with the box of the sets won (red once a set is
 * won) and «Vince», the big score in the middle with the partials as pills under it, the facts of the set at the
 * bottom. Sizes from the tokens of the template (`--sir-score-size`, `--sir-team-size`).
 */
function TemplateScoreboard({
  state,
  status,
  brand,
  names,
  serving,
  logos,
}: {
  state: MatchState;
  status?: ReactNode;
  brand: boolean;
  names: Record<Side, string>;
  serving: Side | null;
  logos?: TeamLogoPair | undefined;
}) {
  const winner = matchWinner(state);
  const minutes = matchMinutes(state);
  const partials = setPartials(state);
  const team = (side: Side) => (
    <div
      className={`flex min-w-0 items-center gap-3 sm:gap-4 ${side === 'home' ? 'order-1 justify-start' : 'order-3 justify-end'}`}
    >
      <ServeDot side={side} active={serving === side} />
      <TeamLogo url={logos?.[side]} className="size-12 sm:size-14" />
      <h2
        data-long={names[side].length > LONG_NAME}
        className={`sir-team-name line-clamp-3 min-w-0 break-words font-display font-bold uppercase leading-[1.05] text-text ${
          names[side].length > LONG_NAME ? 'text-xl' : 'text-2xl'
        } ${side === 'away' ? 'text-right' : ''}`}
        title={names[side]}
      >
        <BreakableName text={names[side]} />
      </h2>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span
          aria-label={`Set vinti ${SIDE_LABEL[side]}`}
          className={`rounded-card border-2 px-3 font-display text-4xl font-bold leading-tight tabular sm:text-5xl ${
            state.setsWon[side] > 0 ? 'border-accent text-accent' : 'border-border text-text'
          }`}
        >
          {state.setsWon[side]}
        </span>
        {winner === side && (
          <span className="rounded-button bg-accent px-2 py-0.5 text-xs font-semibold text-on-accent">Vince</span>
        )}
      </div>
      {side === 'home' && <span className="hidden text-sm font-semibold uppercase text-muted xl:inline">Set</span>}
    </div>
  );
  return (
    <section
      aria-label="Tabellone"
      data-variant="template"
      className="sir-scoreboard sir-card @container overflow-hidden rounded-panel border border-border shadow-card"
    >
      <div className="sir-card-head flex flex-wrap items-center justify-between gap-2 px-4 pt-3" data-open="true">
        <div className="flex min-w-0 items-center gap-3">
          {brand && <BrandMark />}
          <p className="flex min-w-0 items-center gap-2 text-sm text-muted">
            {state.status === 'inProgress' && (
              <span aria-hidden="true" className="inline-block size-2.5 shrink-0 rounded-full bg-accent sir-pulse" />
            )}
            <span className="font-semibold text-text">{matchHeadline(state)}</span>
            {minutes !== null && <span>· {formatMinutes(minutes)}</span>}
          </p>
        </div>
        {status}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:gap-6">
        {team('home')}
        {/* At most 40% of the scoreboard: the partials wrap on two lines and leave room to the names. */}
        <div className="order-2 flex max-w-[min(34rem,40cqw)] flex-col items-center gap-2">
          <Score state={state} names={names} size="text-6xl" colon="sir-score text-5xl" />
          <TemplatePartials partials={partials} />
        </div>
        {team('away')}
      </div>
      <ScoreFacts state={state} size="text-sm" framed={false} />
    </section>
  );
}

/** Partials of the template: pills «1° SET 16 - 25», the score of the winner of the set in its colour. */
function TemplatePartials({ partials }: { partials: SetPartial[] }) {
  if (partials.length === 0) return null;
  return (
    <ol aria-label="Parziali dei set" className="flex max-w-full flex-wrap justify-center gap-2">
      {partials.map((p) => (
        <li
          key={p.number}
          className={`flex shrink-0 items-center gap-2 rounded-button border bg-surface-2 px-3 py-1 text-sm tabular ${
            p.current ? 'border-accent' : 'border-border'
          }`}
        >
          <span className="text-xs font-semibold uppercase text-muted">
            {p.number}° set{p.current && <span className="sr-only"> in corso</span>}
          </span>
          <span className={p.winner === 'home' ? 'font-bold text-home-ink' : 'font-semibold text-text'}>{p.home}</span>
          <span className="text-muted">-</span>
          <span className={p.winner === 'away' ? 'font-bold text-away-ink' : 'font-semibold text-text'}>{p.away}</span>
        </li>
      ))}
    </ol>
  );
}

/** Facts of the set in progress: last point, run, timeouts, substitutions. */
export function ScoreFacts({ state, size, framed = true }: { state: MatchState; size: string; framed?: boolean }) {
  const { live } = state;
  return (
    <dl
      aria-label={framed ? 'Dettagli del set' : undefined}
      className={`grid grid-cols-2 gap-px bg-border sm:grid-cols-4 ${size} ${
        framed ? 'overflow-hidden rounded-panel border border-border shadow-card' : 'border-t border-border'
      }`}
    >
      <Fact label="Ultimo punto">
        {live.lastPoint ? (
          <span
            key={`${live.lastPoint.set}-${live.lastPoint.homeScore}-${live.lastPoint.awayScore}`}
            className="sir-flash inline-flex items-center gap-1.5"
          >
            <span className={`inline-block size-2 rounded-full ${BG[live.lastPoint.team]}`} aria-hidden="true" />
            <span className={INK[live.lastPoint.team]}>{SIDE_LABEL[live.lastPoint.team]}</span>
            <span className="text-text">{live.lastPoint.label}</span>
          </span>
        ) : (
          '–'
        )}
      </Fact>
      <Fact label="Serie in corso">
        {live.run && live.run.length > 1 ? (
          <span className={INK[live.run.team]}>
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
      <span className="text-home-ink">{home}</span>
      <span className="text-muted"> · </span>
      <span className="text-away-ink">{away}</span>
    </span>
  );
}
