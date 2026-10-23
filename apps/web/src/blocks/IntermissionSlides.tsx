import type { IntermissionSlide, SlideType } from '@arenalive/shared';
import type { Side, StatLine } from '@arenalive/volley-stats';
import { matchMvp, setRecap } from '@arenalive/volley-stats';
import type { ReactNode } from 'react';
import { Partials } from '../components/Scoreboard.tsx';
import { BreakableName } from '../components/ui.tsx';
import { formatPct, playerName, teamName, teamShort } from '../lib/format.ts';
import { statPeriod } from '../lib/intermission.ts';
import { nextFixture } from '../lib/schedule.ts';
import { setPartials } from '../lib/scoreboard.ts';
import { sponsorItems } from '../lib/sponsors.ts';
import { ShareQr } from '../qr/ShareQr.tsx';
import {
  currentPageUrl,
  LogoBlock,
  MessageBlock,
  QrBlock,
  shortCodeOf,
  sponsorAlt,
  SponsorBlock,
  SponsorImage,
  useImageRotation,
} from './BrandBlocks.tsx';
import { NextMatchView, StandingsView } from './CalendarBlocks.tsx';
import type { BlockEnv } from './env.ts';
import { AttackView, CountView, RoleDuelView, SetScorersView, TeamDuelView } from './StatSlides.tsx';

/** `full`: the slide fills the screen of a full-screen pause; `compact`: one line of a banner. */
export type SlideSize = 'full' | 'compact';

/** What a slide reads: the env of the blocks, the set of the pause and the sponsor logo of the branding. */
export interface SlideEnv extends BlockEnv {
  /** Set the pause is about (set just closed, set of the time-out, last set). */
  set: number;
  sponsorLogo: string | null;
}

/** Names of the slides in the editor «Pause». */
export const SLIDE_LABELS: Record<SlideType, { label: string; description: string }> = {
  setSummary: {
    label: 'Riepilogo del set',
    description: 'Punti, attacco, battuta, ricezione, muri, errori e migliore.',
  },
  finalResult: { label: 'Risultato', description: 'Set vinti e parziali della partita.' },
  mvp: { label: 'Miglior Realizzatore', description: 'Il migliore della partita (punti, poi efficienza d’attacco).' },
  setScores: { label: 'Parziali dei set', description: 'Punteggio di ogni set.' },
  setScorers: {
    label: 'Parziale e marcatori',
    description: 'Punteggio del set (o set vinti) e i giocatori con più punti di ogni squadra.',
  },
  aces: { label: 'Ace', description: 'Ace di ogni squadra e chi li ha fatti.' },
  blocks: { label: 'Muri', description: 'Muri vincenti di ogni squadra e chi li ha fatti.' },
  attack: {
    label: 'Attacco',
    description: 'Percentuale di punti ed efficienza d’attacco delle squadre, con i migliori attaccanti.',
  },
  roleDuel: {
    label: 'Sfida per ruolo',
    description: 'Giocatore contro giocatore dello stesso ruolo (opposti, schiacciatori, centrali, …).',
  },
  teamDuel: { label: 'Squadre a confronto', description: 'Le due squadre fondamentale per fondamentale.' },
  nextMatch: {
    label: 'Prossima partita',
    description: 'La prossima partita del club con avversario, data, palazzetto e QR del suo link (solo con un club).',
  },
  standings: {
    label: 'Classifica',
    description: 'La classifica del campionato del club, con la nostra squadra evidenziata (solo con un club).',
  },
  sponsor: { label: 'Sponsor', description: 'Immagini degli sponsor a rotazione (o il logo sponsor della grafica).' },
  message: { label: 'Messaggio', description: 'Un testo a scelta (senza formattazione).' },
  qr: { label: 'Codice QR', description: 'QR del link di questa pagina.' },
  logo: { label: 'Logo', description: 'Logo del cliente.' },
};

const TEXT: Record<Side, string> = { home: 'text-home-ink', away: 'text-away-ink' };
const SIDES: readonly Side[] = ['home', 'away'];

/** Rows of the summary of a set: label and value of a team. */
const RECAP_ROWS: { label: string; value: (l: StatLine) => string }[] = [
  {
    label: 'Punti (attacco, muro, ace)',
    value: (l) => `${l.points} (${l.attack.kills}, ${l.block.kills}, ${l.serve.aces})`,
  },
  { label: 'Attacco: vincenti su totale', value: (l) => `${l.attack.kills}/${l.attack.total}` },
  { label: 'Efficienza d’attacco', value: (l) => formatPct(l.attack.efficiency) },
  { label: 'Battuta: ace ed errori', value: (l) => `${l.serve.aces} / ${l.serve.errors}` },
  { label: 'Ricezione positiva', value: (l) => formatPct(l.reception.positivePct) },
  { label: 'Muri vincenti', value: (l) => String(l.block.kills) },
  { label: 'Errori', value: (l) => String(l.errors) },
];

function SetSummarySlide({ env, size }: { env: SlideEnv; size: SlideSize }) {
  const { state } = env;
  const recap = setRecap(state, env.set);
  if (!recap) return null;
  const best = recap.best;
  const bestText = best
    ? `${best.number} ${playerName(best.player ?? undefined, best.number)} (${teamShort(state.teams, best.team)}) · ${best.points} punti`
    : null;
  if (size === 'compact') {
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">{recap.set}° set </span>
        <span className="tabular font-display text-lg font-bold">
          {recap.homeScore}-{recap.awayScore}
        </span>
        {bestText && <span className="text-muted"> · Migliore del set: {bestText}</span>}
      </p>
    );
  }
  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-4">
      <p className="text-center font-display text-xl font-semibold uppercase tracking-wide text-muted">
        Riepilogo del {recap.set}° set
      </p>
      <p className="flex flex-wrap items-baseline justify-center gap-x-4 font-display font-bold uppercase">
        <span className={`min-w-0 max-w-full break-words text-2xl ${TEXT.home}`}>
          <BreakableName text={teamName(state.teams, 'home')} />
        </span>
        <span className="tabular text-5xl text-text">
          {recap.homeScore}-{recap.awayScore}
        </span>
        <span className={`min-w-0 max-w-full break-words text-2xl ${TEXT.away}`}>
          <BreakableName text={teamName(state.teams, 'away')} />
        </span>
      </p>
      <table className="w-full border-collapse text-base">
        <caption className="sr-only">Statistiche del {recap.set}° set</caption>
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="py-1 text-left">
              Fondamentale
            </th>
            {SIDES.map((side) => (
              <th key={side} scope="col" className={`py-1 text-right ${TEXT[side]}`}>
                {teamShort(state.teams, side)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-grid">
          {RECAP_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-1.5 text-left font-medium text-text">
                {row.label}
              </th>
              {SIDES.map((side) => (
                <td key={side} className="tabular py-1.5 text-right font-semibold text-text">
                  {row.value(recap.teams[side])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {bestText && (
        <p className="text-center text-lg text-text">
          <span className="font-semibold">Migliore del set: </span>
          {bestText}
        </p>
      )}
    </div>
  );
}

function FinalResultSlide({ env, size }: { env: SlideEnv; size: SlideSize }) {
  const { state } = env;
  const partials = setPartials(state);
  if (size === 'compact') {
    return (
      <p className="text-sm text-text">
        <span className="font-semibold">{teamShort(state.teams, 'home')} </span>
        <span className="tabular font-display text-lg font-bold">
          {state.setsWon.home}-{state.setsWon.away}
        </span>
        <span className="font-semibold"> {teamShort(state.teams, 'away')}</span>
        <span className="tabular text-muted"> · {partials.map((p) => `${p.home}-${p.away}`).join(' ')}</span>
      </p>
    );
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 text-center">
      <p className="font-display text-xl font-semibold uppercase tracking-wide text-muted">
        {state.status === 'finished' ? 'Risultato finale' : 'Risultato'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 font-display font-bold uppercase">
        <span className={`min-w-0 max-w-full break-words text-3xl ${TEXT.home}`}>
          <BreakableName text={teamName(state.teams, 'home')} />
        </span>
        <span
          className="tabular text-7xl text-text"
          aria-label={`Set vinti ${state.setsWon.home} a ${state.setsWon.away}`}
        >
          {state.setsWon.home}-{state.setsWon.away}
        </span>
        <span className={`min-w-0 max-w-full break-words text-3xl ${TEXT.away}`}>
          <BreakableName text={teamName(state.teams, 'away')} />
        </span>
      </div>
      <Partials partials={partials} />
    </div>
  );
}

function MvpSlide({ env, size }: { env: SlideEnv; size: SlideSize }) {
  const { state } = env;
  const mvp = matchMvp(state);
  if (!mvp) return null;
  const name = playerName(mvp.player ?? undefined, mvp.number);
  if (size === 'compact') {
    return (
      <p className="text-sm text-text">
        <span className="font-display font-bold uppercase">Miglior Realizzatore </span>
        <span className={`tabular font-bold ${TEXT[mvp.team]}`}>{mvp.number}</span> {name} (
        {teamShort(state.teams, mvp.team)}) · {mvp.points} punti
      </p>
    );
  }
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-xl font-semibold uppercase tracking-wide text-muted">Miglior Realizzatore della partita</p>
      <p className="font-display text-5xl font-bold uppercase text-text">
        <span className={`tabular mr-4 ${TEXT[mvp.team]}`}>{mvp.number}</span>
        {name}
      </p>
      <p className={`font-display text-2xl font-semibold uppercase ${TEXT[mvp.team]}`}>
        {teamName(state.teams, mvp.team)}
      </p>
      <p className="tabular text-xl text-text">
        {mvp.points} punti · {mvp.attackKills} attacchi vincenti · {mvp.blockKills} muri · {mvp.aces} ace
      </p>
      <p className="tabular text-base text-muted">Efficienza d’attacco {formatPct(mvp.attackEfficiency)}</p>
    </div>
  );
}

function SponsorSlide({
  slide,
  env,
  size,
}: {
  slide: Extract<IntermissionSlide, { type: 'sponsor' }>;
  env: SlideEnv;
  size: SlideSize;
}) {
  const items = sponsorItems(slide.options, env.brand?.sponsors ?? [], env.brand?.assetPath);
  const index = useImageRotation(items.length, slide.options.seconds, env.paused);
  // Nothing chosen: the sponsor logo of the branding.
  const current = items[index] ?? (env.sponsorLogo ? { src: env.sponsorLogo, name: null, website: null } : null);
  if (size === 'full' && items.length > 0) return <SponsorBlock options={slide.options} env={env} />;
  if (!current) return null;
  const alt = items.length > 0 ? sponsorAlt(current, index, items.length) : 'Sponsor';
  return (
    <div className="flex min-h-full items-center justify-center">
      <SponsorImage
        key={current.src}
        item={current}
        alt={alt}
        className={`w-auto max-w-full object-contain ${size === 'compact' ? 'max-h-14' : 'max-h-[60vh]'}`}
      />
    </div>
  );
}

function CompactQr({ env }: { env: SlideEnv }) {
  const url = env.pageUrl ?? currentPageUrl();
  const code = shortCodeOf(url);
  return (
    <ShareQr
      url={url}
      {...(code ? { code } : {})}
      logoSrc={env.brand?.logoMark ?? null}
      actions={false}
      imageClassName="h-16 w-16"
    />
  );
}

/** Draws one slide of a pause, full screen or as a banner line. Texts of the client are always plain text. */
export function renderSlide(slide: IntermissionSlide, env: SlideEnv, size: SlideSize): ReactNode {
  switch (slide.type) {
    case 'setSummary':
      return <SetSummarySlide env={env} size={size} />;
    case 'finalResult':
      return <FinalResultSlide env={env} size={size} />;
    case 'mvp':
      return <MvpSlide env={env} size={size} />;
    case 'setScores':
      return size === 'full' ? (
        <div className="flex min-h-full flex-col items-center justify-center gap-4">
          <p className="font-display text-xl font-semibold uppercase tracking-wide text-muted">Parziali dei set</p>
          <Partials partials={setPartials(env.state)} />
        </div>
      ) : (
        <Partials partials={setPartials(env.state)} compact />
      );
    case 'setScorers':
      return (
        <SetScorersView
          state={env.state}
          period={statPeriod(slide.options.period, env.set)}
          options={slide.options}
          size={size}
        />
      );
    case 'aces':
    case 'blocks':
      return (
        <CountView state={env.state} period={statPeriod(slide.options.period, env.set)} kind={slide.type} size={size} />
      );
    case 'attack':
      return (
        <AttackView
          state={env.state}
          period={statPeriod(slide.options.period, env.set)}
          options={slide.options}
          size={size}
        />
      );
    case 'roleDuel':
      return (
        <RoleDuelView
          state={env.state}
          period={statPeriod(slide.options.period, env.set)}
          role={slide.options.role}
          size={size}
          paused={env.paused}
        />
      );
    case 'teamDuel':
      return (
        <TeamDuelView
          state={env.state}
          period={statPeriod(slide.options.period, env.set)}
          options={slide.options}
          size={size}
        />
      );
    case 'nextMatch': {
      const fixture = nextFixture(env.schedule);
      return fixture ? (
        <NextMatchView
          fixture={fixture}
          options={slide.options}
          env={env}
          size={size === 'full' ? 'full' : 'compact'}
        />
      ) : null;
    }
    case 'standings':
      return env.schedule?.standings ? (
        <StandingsView
          standings={env.schedule.standings}
          options={slide.options}
          size={size === 'full' ? 'full' : 'compact'}
        />
      ) : null;
    case 'sponsor':
      return <SponsorSlide slide={slide} env={env} size={size} />;
    case 'message':
      return size === 'full' ? (
        <MessageBlock options={slide.options} />
      ) : (
        <p className="break-words font-display text-lg font-semibold text-text">{slide.options.text}</p>
      );
    case 'qr':
      return size === 'full' ? (
        <QrBlock options={slide.options} env={env} />
      ) : (
        <div className="flex items-center gap-3">
          <CompactQr env={env} />
          <span className="text-sm text-text">{slide.options.caption}</span>
        </div>
      );
    case 'logo':
      if (size === 'full') return <LogoBlock options={slide.options} env={env} />;
      return <CompactLogo env={env} variant={slide.options.variant} />;
  }
}

function CompactLogo({ env, variant }: { env: SlideEnv; variant: 'main' | 'mark' }) {
  const name = env.brand?.name ?? 'ArenaLive';
  const src = variant === 'mark' ? env.brand?.logoMark : env.brand?.logoMain;
  return src ? (
    <img src={src} alt={name} className="max-h-12 w-auto max-w-full object-contain" />
  ) : (
    <p className="font-display text-xl font-bold uppercase tracking-widest text-primary">{name}</p>
  );
}
