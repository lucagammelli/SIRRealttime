import type { ClubFixtureTeam, UpcomingFixture } from '@arenalive/shared';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { formatFixtureDate } from '../lib/format.ts';
import { teamColorVars } from '../lib/teamColors.ts';
import type { Device } from '../lib/layout.ts';

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Pure: time left until `startsAt` (null when it is not set or already passed). */
export function countdownTo(startsAt: string | null, now: number): Countdown | null {
  const target = startsAt ? Date.parse(startsAt) : Number.NaN;
  if (!Number.isFinite(target) || target <= now) return null;
  const total = Math.floor((target - now) / 1000);
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Current time, refreshed every second while mounted. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Pure: initials of a team for the place of a missing logo («Itas Trentino» → «IT»). */
export function teamInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/);
  return words
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
}

function TeamBadge({ team, side, big }: { team: ClubFixtureTeam; side: 'home' | 'away'; big: boolean }) {
  const [broken, setBroken] = useState(false);
  const size = big ? 'size-40 lg:size-56' : 'size-20 sm:size-28';
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center">
      {team.logoUrl && !broken ? (
        <img
          src={team.logoUrl}
          alt=""
          onError={() => setBroken(true)}
          className={`${size} rounded-card bg-surface-2 object-contain p-2`}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`${size} flex items-center justify-center rounded-card font-display font-bold ${big ? 'text-6xl' : 'text-3xl'} ${
            side === 'home' ? 'bg-home-soft text-home-ink' : 'bg-away-soft text-away-ink'
          }`}
        >
          {teamInitials(team.name)}
        </span>
      )}
      {/* The name in the colour of its team: ours / the opponent (`teamColorVars` points home and away to them). */}
      <p
        data-team={side}
        className={`font-display font-bold uppercase leading-tight tracking-wide break-words ${
          side === 'home' ? 'text-home-ink' : 'text-away-ink'
        } ${big ? 'text-3xl lg:text-4xl' : 'text-base sm:text-xl'}`}
      >
        {team.name}
      </p>
    </div>
  );
}

/** Days, hours, minutes and seconds left, in four boxes (one sentence for the screen readers). */
export function CountdownView({ left, big }: { left: Countdown; big: boolean }) {
  const parts: [number, string][] = [
    [left.days, left.days === 1 ? 'giorno' : 'giorni'],
    [left.hours, left.hours === 1 ? 'ora' : 'ore'],
    [left.minutes, 'minuti'],
    [left.seconds, 'secondi'],
  ];
  const text = `Mancano ${left.days} giorni, ${left.hours} ore e ${left.minutes} minuti`;
  return (
    <div role="timer" aria-label={text} className="flex justify-center gap-2 sm:gap-3">
      {parts.map(([value, label]) => (
        <div
          key={label}
          aria-hidden="true"
          className={`flex flex-col items-center rounded-card border border-border bg-surface-2 ${big ? 'min-w-32 px-5 py-4' : 'min-w-16 px-2 py-2 sm:min-w-20 sm:px-3'}`}
        >
          <span
            className={`font-display font-bold tabular-nums text-text ${big ? 'text-6xl' : 'text-2xl sm:text-4xl'}`}
          >
            {String(value).padStart(2, '0')}
          </span>
          <span className={`uppercase tracking-wide text-muted ${big ? 'text-base' : 'text-[0.65rem] sm:text-xs'}`}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * «Prossima partita»: the public page of the link of a match of the calendar before its `.dvw` arrives. Teams with
 * their logos (initials when missing), official date and time in Italy, venue, round and a countdown; the colours of
 * the club and of the opponent; the page turns into the live match by itself (the socket stays open).
 */
export function NextMatch({
  fixture,
  device,
  status,
}: {
  fixture: UpcomingFixture;
  device?: Device;
  status?: ReactNode;
}) {
  const now = useNow();
  const big = device === 'tv';
  const left = countdownTo(fixture.startsAt, now);
  const when = formatFixtureDate(fixture.startsAt);
  const place = [fixture.venue, fixture.venueCity].filter(Boolean).join(' · ');
  const note = !fixture.inCalendar
    ? 'Partita non più presente nel calendario ufficiale.'
    : fixture.status === 'postponed'
      ? 'Partita rinviata: data e ora da confermare.'
      : fixture.status === 'played'
        ? fixture.result
          ? `Partita giocata: ${fixture.result.home}-${fixture.result.away}.`
          : 'Partita giocata.'
        : left
          ? 'La diretta comparirà qui da sola appena inizia la partita, senza ricaricare la pagina.'
          : 'In attesa dell’inizio della partita: la diretta comparirà qui da sola.';
  return (
    <section
      aria-labelledby="prossima-partita"
      style={teamColorVars(fixture.ourSide)}
      className={`sir-surface sir-card mx-auto flex w-full flex-col items-center rounded-panel border border-border text-center shadow-card ${
        big ? 'h-full max-w-none justify-center gap-8 p-10' : 'max-w-3xl gap-5 p-4 sm:p-8'
      }`}
    >
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <p className={`text-left uppercase tracking-wide text-muted ${big ? 'text-xl' : 'text-xs sm:text-sm'}`}>
          {[fixture.leagueName, fixture.roundLabel].filter(Boolean).join(' · ')}
        </p>
        {status}
      </div>
      <h1
        id="prossima-partita"
        className={`font-display font-bold uppercase tracking-wide text-accent ${big ? 'text-5xl' : 'text-2xl sm:text-3xl'}`}
      >
        Prossima partita
      </h1>
      <div className="flex w-full items-start justify-center gap-3 sm:gap-6">
        <TeamBadge team={fixture.home} side="home" big={big} />
        <span className={`self-center font-display font-bold text-muted ${big ? 'text-5xl' : 'text-xl sm:text-3xl'}`}>
          <span aria-hidden="true">VS</span>
          <span className="sr-only">contro</span>
        </span>
        <TeamBadge team={fixture.away} side="away" big={big} />
      </div>
      <div className="space-y-1">
        <p className={`font-semibold text-text ${big ? 'text-3xl' : 'text-lg sm:text-xl'}`}>
          {when.date.charAt(0).toUpperCase() + when.date.slice(1)}
          {fixture.startsAt && ` · ore ${when.time}`}
        </p>
        {place && <p className={`text-muted ${big ? 'text-2xl' : 'text-sm sm:text-base'}`}>{place}</p>}
      </div>
      {left && fixture.status === 'scheduled' && fixture.inCalendar && <CountdownView left={left} big={big} />}
      <p role="status" className={`max-w-xl text-muted ${big ? 'text-xl' : 'text-sm'}`}>
        {note}
      </p>
    </section>
  );
}
