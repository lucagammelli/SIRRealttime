import type { BlockOptions, ScheduleFixture, ScheduleStandings, ScheduleStandingRow } from '@arenalive/shared';
import { standingsRowsToShow } from '@arenalive/shared';
import { useState } from 'react';
import { clubLogoClass, useOurLogoSize } from '../lib/clubLogo.ts';
import { useTouch } from '../lib/useLayout.ts';
import { FitRows, MoreRows, rowsAround } from '../components/FitToBox.tsx';
import { teamInitials } from '../components/NextMatch.tsx';
import { BreakableName, Card } from '../components/ui.tsx';
import { formatDay, formatFixtureDate } from '../lib/format.ts';
import { ShareQr } from '../qr/ShareQr.tsx';
import { shortCodeOf } from './BrandBlocks.tsx';
import type { BlockEnv } from './env.ts';

/** `card`: a block of the page; `full`: a slide of a full screen pause; `compact`: one line of a banner. */
export type CalendarSize = 'card' | 'full' | 'compact';

const FILL = 'h-full min-h-0';

type Role = 'our' | 'opponent';

const BADGE: Record<Role, string> = {
  our: 'bg-our-soft text-our-ink',
  opponent: 'bg-opponent-soft text-opponent-ink',
};
const INK: Record<Role, string> = { our: 'text-our-ink', opponent: 'text-opponent-ink' };

/** Logo of a team of the league, its initials when there is none (or it does not load). */
function TeamLogo({
  name,
  logoUrl,
  role,
  className,
}: {
  name: string;
  logoUrl: string | null;
  role: Role | null;
  className: string;
}) {
  const [broken, setBroken] = useState(false);
  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt=""
        onError={() => setBroken(true)}
        className={`${className} max-w-none shrink-0 object-contain`}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} flex items-center justify-center rounded-card font-display font-bold ${
        role ? BADGE[role] : 'bg-surface-2 text-muted'
      }`}
    >
      {teamInitials(name)}
    </span>
  );
}

const upper = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** Code of a short link, to show under its QR. */
const codeOfLink = (url: string): string | null => shortCodeOf(url);

function FixtureQr({
  fixture,
  logoSrc,
  className,
}: {
  fixture: ScheduleFixture;
  logoSrc: string | null;
  className: string;
}) {
  if (!fixture.shortUrl) return null;
  const code = codeOfLink(fixture.shortUrl);
  return (
    <ShareQr
      url={fixture.shortUrl}
      {...(code ? { code } : {})}
      logoSrc={logoSrc}
      actions={false}
      imageClassName={className}
    />
  );
}

const sideRole = (fixture: ScheduleFixture, side: 'home' | 'away'): Role =>
  fixture.ourSide === side ? 'our' : 'opponent';

/**
 * «Prossima partita»: the next match of the club (opponent with logo, home or away, day and time in Italy, venue) and
 * the QR of its own link. Colours of «nostra squadra» for the club and of the opponent for the other team.
 */
export function NextMatchView({
  fixture,
  options,
  env,
  size,
}: {
  fixture: ScheduleFixture;
  options: BlockOptions<'nextMatch'>;
  env: Pick<BlockEnv, 'brand' | 'device'>;
  size: CalendarSize;
}) {
  const when = formatFixtureDate(fixture.startsAt);
  const place = [fixture.venue, fixture.venueCity].filter(Boolean).join(' · ');
  const opponent = fixture.ourSide === 'home' ? fixture.away : fixture.home;
  const where = fixture.ourSide === 'home' ? 'In casa' : 'In trasferta';
  const logoSrc = env.brand?.logoMark ?? null;
  const showQr = options.qr && fixture.shortUrl !== null;
  // On the phone the viewer is already on the device: no QR in the banner, the name is the link of the match.
  const phone = env.device === 'phone';
  // Without touch the name is plain text.
  const touch = useTouch();
  // Our logo (the logo of the club) follows «Dimensione del logo del club»; the opponent keeps the medium size.
  const ourLogoSize = useOurLogoSize();
  const dateText = `${upper(when.date)} · ore ${when.time}`;

  if (size === 'compact') {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TeamLogo
          name={opponent.name}
          logoUrl={opponent.logoUrl}
          role="opponent"
          className="size-10 shrink-0 text-sm"
        />
        <p className="min-w-48 flex-1 text-sm text-text">
          <span className="font-semibold">Prossima partita: </span>
          {phone && showQr && fixture.shortUrl && touch ? (
            <a href={fixture.shortUrl} className="font-display font-bold uppercase text-opponent-ink underline">
              {opponent.name}
            </a>
          ) : (
            <span className="font-display font-bold uppercase text-opponent-ink">{opponent.name}</span>
          )}
          <span className="text-muted">
            {' '}
            · {where} · {dateText}
          </span>
          {place && <span className="block text-muted">{place}</span>}
        </p>
        {showQr && !phone && <FixtureQr fixture={fixture} logoSrc={logoSrc} className="size-16 shrink-0" />}
      </div>
    );
  }

  const big = size === 'full';
  const tv = env.device === 'tv';
  const teams = (
    <div className="flex w-full items-start justify-center gap-3 sm:gap-6">
      {(['home', 'away'] as const).map((side, i) => {
        const team = fixture[side];
        return (
          <div key={side} className="contents">
            {i === 1 && (
              <span className={`self-center font-display font-bold text-muted ${big ? 'text-4xl' : 'text-xl'}`}>
                <span aria-hidden="true">VS</span>
                <span className="sr-only">contro</span>
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
              <TeamLogo
                name={team.name}
                logoUrl={team.logoUrl}
                role={sideRole(fixture, side)}
                className={`${clubLogoClass(
                  big ? 'nextMatchBlockFull' : tv ? 'nextMatchBlockTv' : 'nextMatchBlock',
                  ourLogoSize,
                  fixture.ourSide === side,
                )} ${big ? 'p-2 text-5xl' : tv ? 'text-3xl' : 'text-xl'}`}
              />
              <p
                className={`min-w-0 max-w-full break-words font-display font-bold uppercase leading-tight tracking-wide ${INK[sideRole(fixture, side)]} ${
                  big ? 'text-2xl [@media(min-height:900px)]:text-4xl' : tv ? 'text-xl' : 'text-sm sm:text-base'
                }`}
              >
                <BreakableName text={team.name} />
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
  const details = (
    <div className="space-y-1 text-center">
      <p
        className={`font-semibold text-text ${big ? 'text-2xl [@media(min-height:900px)]:text-3xl' : tv ? 'text-xl' : 'text-base'}`}
      >
        {dateText}
      </p>
      <p className={`text-muted ${big ? 'text-lg' : tv ? 'text-base' : 'text-sm'}`}>
        {[where, place].filter(Boolean).join(' · ')}
      </p>
    </div>
  );

  if (big) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col items-center justify-center gap-6">
        <p className="text-center font-display text-xl font-semibold uppercase tracking-wide text-muted">
          {[fixture.leagueName, fixture.roundLabel].filter(Boolean).join(' · ')}
        </p>
        {teams}
        {details}
        {showQr && (
          <div className="flex flex-col items-center gap-2">
            <FixtureQr fixture={fixture} logoSrc={logoSrc} className="h-auto w-32 [@media(min-height:900px)]:w-48" />
            <p className="text-center text-base text-muted">Inquadra il codice per seguire la partita sul telefono</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card
      title="Prossima partita"
      subtitle={fixture.roundLabel}
      className={FILL}
      bodyClassName="flex flex-col justify-center gap-3"
    >
      {teams}
      {details}
      {showQr && (
        <div className="flex items-center justify-center gap-3">
          <FixtureQr fixture={fixture} logoSrc={logoSrc} className={tv ? 'h-auto w-32' : 'h-auto w-24'} />
          <p className="max-w-40 text-xs text-muted">Inquadra il codice per seguire la partita</p>
        </div>
      )}
    </Card>
  );
}

const COLUMNS: { key: 'points' | 'played' | 'won' | 'lost' | 'setsWon' | 'setsLost'; short: string; full: string }[] = [
  { key: 'points', short: 'Pt', full: 'Punti' },
  { key: 'played', short: 'G', full: 'Partite giocate' },
  { key: 'won', short: 'V', full: 'Partite vinte' },
  { key: 'lost', short: 'P', full: 'Partite perse' },
  { key: 'setsWon', short: 'SV', full: 'Set vinti' },
  { key: 'setsLost', short: 'SP', full: 'Set persi' },
];

/** Text under the table: when the standings were stored. */
export const updatedText = (standings: ScheduleStandings): string => `Aggiornata al ${formatDay(standings.updatedAt)}`;

function ordinal(row: ScheduleStandingRow): string {
  return `${row.position}°`;
}

/**
 * «Classifica» of the championship of the club: the first N rows, all of them or the club ±2 positions (pure choice
 * of `standingsRowsToShow`), the club highlighted in the colours of «nostra squadra».
 */
export function StandingsView({
  standings,
  options,
  size,
}: {
  standings: ScheduleStandings;
  options: BlockOptions<'standings'>;
  size: CalendarSize;
}) {
  const rows = standingsRowsToShow(standings.rows, options.scope, options.count);
  const ours = standings.rows.find((r) => r.ours) ?? standings.rows[0];

  if (size === 'compact') {
    if (!ours) return null;
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">Classifica: </span>
        <span className="font-display font-bold uppercase text-our-ink">
          {ordinal(ours)} {ours.teamName}
        </span>
        <span className="tabular text-muted">
          {' '}
          · {ours.points} punti · {ours.played} giocate · {ours.won} vinte · {ours.lost} perse · set {ours.setsWon}-
          {ours.setsLost}
        </span>
      </p>
    );
  }

  const big = size === 'full';
  const table = (
    <table className={`w-full table-fixed border-collapse ${big ? 'text-base lg:text-xl' : 'text-xs sm:text-sm'}`}>
      <caption className="sr-only">Classifica{standings.leagueName ? ` ${standings.leagueName}` : ''}</caption>
      <colgroup>
        <col className={big ? 'w-12' : 'w-6 sm:w-8'} />
        <col className={big ? 'w-14' : 'w-8 sm:w-10'} />
        <col />
        {COLUMNS.map((c) => (
          <col key={c.key} className={big ? 'w-14' : 'w-7 sm:w-11'} />
        ))}
      </colgroup>
      <thead>
        <tr className="text-left text-[0.7rem] uppercase tracking-wide text-muted sm:text-xs">
          <th scope="col" className="py-1 pr-2 text-right">
            <abbr title="Posizione" className="no-underline">
              #
            </abbr>
          </th>
          <td />
          <th scope="col" className={`py-1 ${big ? 'px-3' : 'px-1'}`}>
            Squadra
          </th>
          {COLUMNS.map((c) => (
            <th key={c.key} scope="col" className={`py-1 text-right ${big ? 'px-2' : 'px-0.5 sm:px-1'}`}>
              <abbr title={c.full} className="no-underline">
                {c.short}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      {/* In a card that cannot scroll (screen without touch) and does not fit even scaled down: the rows around our
          team (always visible) and «+N» for the ones left out above and below. */}
      <FitRows count={rows.length}>
        {(fit) => {
          const range = rowsAround(
            rows.length,
            fit.shown,
            rows.findIndex((r) => r.ours),
          );
          const more = (hidden: number) =>
            hidden > 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="py-1 text-center">
                  <MoreRows hidden={hidden} of="teams" />
                </td>
              </tr>
            );
          return (
            <tbody data-fit-list={rows.length} className="divide-y divide-grid">
              {more(range.above)}
              {rows.slice(range.start, range.end).map((row) => (
                <tr
                  key={row.position}
                  className={row.ours ? 'bg-our-soft font-bold text-our-ink' : 'text-text'}
                  aria-current={row.ours ? 'true' : undefined}
                >
                  <td className="tabular py-1 pr-2 text-right font-display font-bold">{row.position}</td>
                  <td className="py-1">
                    <div className="flex justify-center">
                      <TeamLogo
                        name={row.teamName}
                        logoUrl={row.logoUrl}
                        role={row.ours ? 'our' : null}
                        className={big ? 'size-9 text-xs' : 'size-6 text-[0.55rem]'}
                      />
                    </div>
                  </td>
                  <th scope="row" className={`truncate py-1 text-left font-medium ${big ? 'px-3' : 'px-1'}`}>
                    {row.teamName}
                  </th>
                  {COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`tabular py-1 text-right ${big ? 'px-2' : 'px-0.5 sm:px-1'} ${c.key === 'points' ? 'font-display font-bold' : ''}`}
                    >
                      {row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {more(range.below)}
            </tbody>
          );
        }}
      </FitRows>
    </table>
  );

  if (big) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-3">
        <p className="text-center font-display text-xl font-semibold uppercase tracking-wide text-muted">
          Classifica{standings.leagueName ? ` · ${standings.leagueName}` : ''}
        </p>
        {table}
        <p className="text-center text-base text-muted">{updatedText(standings)}</p>
      </div>
    );
  }
  return (
    <Card title="Classifica" subtitle={standings.leagueName} className={FILL} bodyClassName="flex flex-col gap-2">
      {table}
      <p className="text-xs text-muted">{updatedText(standings)}</p>
    </Card>
  );
}
