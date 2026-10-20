import type { BlockType, LayoutBlock } from '@sir/shared';
import { BLOCK_OPTIONS, BLOCK_TYPES, BLOCK_WIDTHS } from '@sir/shared';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { CourtMap } from '../components/CourtMap.tsx';
import { MomentumChart } from '../components/MomentumChart.tsx';
import { PlayerTable } from '../components/PlayerTable.tsx';
import { Rotations } from '../components/Rotations.tsx';
import { Scoreboard } from '../components/Scoreboard.tsx';
import { TeamComparison } from '../components/TeamComparison.tsx';
import { LogoBlock, MessageBlock, QrBlock, SponsorBlock } from './BrandBlocks.tsx';
import { NextMatchView, StandingsView } from './CalendarBlocks.tsx';
import type { BlockEnv } from './env.ts';
import { LastPointBlock, SetScoresBlock, TopPlayersBlock } from './MatchBlocks.tsx';
import { AttackView, CountView, RoleDuelView, SetScorersView, TeamDuelView } from './StatSlides.tsx';
import { statPeriod } from '../lib/intermission.ts';
import { nextFixture } from '../lib/schedule.ts';

/** On the big screen every card fills its cell and never grows it. */
const TV_CARD = 'h-full min-h-0 overflow-hidden';

/** Block of type `T` (its options typed). */
export type BlockOf<T extends BlockType> = Extract<LayoutBlock, { type: T }>;

/** One type of block: what the editor shows and how the page draws it. */
export interface BlockDefinition<T extends BlockType = BlockType> {
  type: T;
  /** Name in the editor («Aggiungi blocco»). */
  label: string;
  /** One line under the name in the editor. */
  description: string;
  /** Widths allowed (columns of 12), from the shared contract. */
  widths: readonly number[];
  /** Schema of the options, from the shared contract. */
  options: z.ZodType;
  render: (block: BlockOf<T>, env: BlockEnv) => ReactNode;
}

type Registry = { [T in BlockType]: BlockDefinition<T> };

const tv = (env: BlockEnv): boolean => env.device === 'tv';

/** Statistics block of a period: the set in progress (`set`) or the whole match, in the card size. */
const statsOf = (period: 'set' | 'match', env: BlockEnv) =>
  ({ state: env.state, period: statPeriod(period, env.state.live.set), size: 'card' }) as const;

const define = <T extends BlockType>(
  type: T,
  label: string,
  description: string,
  render: BlockDefinition<T>['render'],
): BlockDefinition<T> => ({
  type,
  label,
  description,
  widths: BLOCK_WIDTHS[type],
  options: BLOCK_OPTIONS[type],
  render,
});

/** Every block of the match page, in the order of «Aggiungi blocco». */
export const BLOCKS: Registry = {
  scoreboard: define('scoreboard', 'Tabellone', 'Punteggio, set vinti e dettagli del set in corso.', (_b, env) => (
    <Scoreboard
      state={env.state}
      status={env.status}
      device={env.device}
      brand={env.brandInScoreboard && tv(env)}
      {...(env.logos ? { logos: env.logos } : {})}
    />
  )),
  momentum: define(
    'momentum',
    'Andamento del set',
    'Vantaggio punto per punto, break point e cambi palla.',
    (_b, env) =>
      tv(env) ? (
        <MomentumChart state={env.state} className={TV_CARD} chartClassName="min-h-0 flex-1" />
      ) : (
        <MomentumChart state={env.state} className="h-full" />
      ),
  ),
  comparison: define('comparison', 'Confronto squadre', 'Fondamentali delle due squadre a confronto.', (_b, env) => (
    <TeamComparison state={env.state} compact={tv(env)} className={tv(env) ? TV_CARD : 'h-full'} />
  )),
  players: define('players', 'Statistiche giocatori', 'Tabella dei giocatori con tutti i fondamentali.', (_b, env) => (
    <PlayerTable state={env.state} className={tv(env) ? TV_CARD : ''} />
  )),
  court: define('court', 'Mappe di campo', 'Direzioni di attacco e battuta sul campo.', (b, env) => (
    <CourtMap state={env.state} options={b.options} className={tv(env) ? TV_CARD : 'h-full'} />
  )),
  rotations: define('rotations', 'Rotazioni', 'Punti fatti e subiti in ogni rotazione.', (_b, env) =>
    tv(env) ? (
      <Rotations state={env.state} className={TV_CARD} chartClassName="h-[min(28vh,14rem)]" />
    ) : (
      <Rotations state={env.state} className="h-full" />
    ),
  ),
  lastPoint: define('lastPoint', 'Ultimo punto', 'Chi ha fatto l’ultimo punto e come.', (_b, env) => (
    <LastPointBlock env={env} />
  )),
  setScores: define('setScores', 'Parziali dei set', 'Punteggio di ogni set.', (_b, env) => (
    <SetScoresBlock env={env} />
  )),
  topPlayers: define('topPlayers', 'Migliori giocatori', 'I giocatori con più punti.', (b, env) => (
    <TopPlayersBlock options={b.options} env={env} />
  )),
  setScorers: define(
    'setScorers',
    'Parziale e marcatori',
    'Punteggio del set in corso (o set vinti) e i giocatori con più punti.',
    (b, env) => <SetScorersView {...statsOf(b.options.period, env)} options={b.options} />,
  ),
  aces: define('aces', 'Ace', 'Ace di ogni squadra e chi li ha fatti.', (b, env) => (
    <CountView {...statsOf(b.options.period, env)} kind="aces" />
  )),
  blocks: define('blocks', 'Muri', 'Muri vincenti di ogni squadra e chi li ha fatti.', (b, env) => (
    <CountView {...statsOf(b.options.period, env)} kind="blocks" />
  )),
  attack: define('attack', 'Attacco', 'Percentuali d’attacco delle squadre e migliori attaccanti.', (b, env) => (
    <AttackView {...statsOf(b.options.period, env)} options={b.options} />
  )),
  roleDuel: define('roleDuel', 'Sfida per ruolo', 'Giocatore contro giocatore dello stesso ruolo.', (b, env) => (
    <RoleDuelView {...statsOf(b.options.period, env)} role={b.options.role} paused={env.paused} />
  )),
  teamDuel: define(
    'teamDuel',
    'Squadre a confronto',
    'Le due squadre fondamentale per fondamentale, in grande.',
    (b, env) => <TeamDuelView {...statsOf(b.options.period, env)} options={b.options} />,
  ),
  nextMatch: define(
    'nextMatch',
    'Prossima partita',
    'La prossima partita del club con avversario, data, palazzetto e QR del suo link (si vede solo con un club).',
    (b, env) => {
      const fixture = nextFixture(env.schedule);
      return fixture ? <NextMatchView fixture={fixture} options={b.options} env={env} size="card" /> : null;
    },
  ),
  standings: define(
    'standings',
    'Classifica',
    'La classifica del campionato del club, con la nostra squadra evidenziata (si vede solo con un club).',
    (b, env) =>
      env.schedule?.standings ? (
        <StandingsView standings={env.schedule.standings} options={b.options} size="card" />
      ) : null,
  ),
  logo: define('logo', 'Logo', 'Logo del cliente (orizzontale o quadrato).', (b, env) => (
    <LogoBlock options={b.options} env={env} />
  )),
  sponsor: define('sponsor', 'Sponsor', 'Immagini degli sponsor a rotazione.', (b, env) => (
    <SponsorBlock options={b.options} env={env} />
  )),
  message: define('message', 'Messaggio', 'Un testo a scelta (senza formattazione).', (b) => (
    <MessageBlock options={b.options} />
  )),
  qr: define('qr', 'Codice QR', 'QR del link di questa pagina, da inquadrare col telefono.', (b, env) => (
    <QrBlock options={b.options} env={env} />
  )),
};

/** Types in the order of the registry. */
export const REGISTRY_TYPES: readonly BlockType[] = Object.keys(BLOCKS) as BlockType[];

/** Draws one block of the layout with its definition. */
export function renderLayoutBlock(block: LayoutBlock, env: BlockEnv): ReactNode {
  const definition = BLOCKS[block.type] as BlockDefinition;
  return definition.render(block, env);
}

/** Every type of the contract has its definition (checked by the tests too). */
export const missingTypes = (): BlockType[] => BLOCK_TYPES.filter((t) => !(t in BLOCKS));
