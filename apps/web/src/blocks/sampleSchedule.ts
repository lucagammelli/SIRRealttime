import type { ScheduleResponse } from '@sir/shared';
import { ScheduleResponseSchema } from '@sir/shared';

/**
 * Example schedule of the previews in the editors «Pagina pubblica» and «Pause e sponsor»: invented teams, a fixed
 * date, no logos (initials), a link that goes nowhere. Static: the editor never asks the league data.
 */
const NAMES = [
  'Volley Torino',
  'Pallavolo Bari',
  'Volley Perla',
  'Aquila Volley',
  'Nostra Squadra Volley',
  'Delta Padova',
  'Lupi Verona',
  'Rapid Modena',
  'Mare Ravenna',
  'Monti Trento',
  'Vela Civitanova',
  'Orsi Cuneo',
];
const OURS = 4;

const POINTS = [31, 28, 26, 24, 22, 20, 17, 15, 12, 10, 7, 4];

export const SAMPLE_SCHEDULE: ScheduleResponse = ScheduleResponseSchema.parse({
  fixtures: [
    {
      startsAt: '2026-11-08T17:00:00.000Z',
      home: { name: 'Nostra Squadra Volley', logoUrl: null },
      away: { name: 'Volley Torino', logoUrl: null },
      ourSide: 'home',
      venue: 'PalaEsempio',
      venueCity: 'Città d’Esempio',
      roundLabel: '6ª Giornata Andata',
      leagueName: 'Campionato d’esempio',
      live: false,
      shortUrl: 'https://esempio.it/l/K7M2QX9P',
    },
    {
      startsAt: '2026-11-15T17:00:00.000Z',
      home: { name: 'Pallavolo Bari', logoUrl: null },
      away: { name: 'Nostra Squadra Volley', logoUrl: null },
      ourSide: 'away',
      venue: 'PalaBari',
      venueCity: 'Bari',
      roundLabel: '7ª Giornata Andata',
      leagueName: 'Campionato d’esempio',
      live: false,
      shortUrl: 'https://esempio.it/l/K7M2QX9Q',
    },
  ],
  standings: {
    leagueName: 'Campionato d’esempio',
    updatedAt: '2026-10-26T09:00:00.000Z',
    rows: NAMES.map((teamName, i) => {
      const played = 10;
      const won = Math.max(0, Math.round((POINTS[i] ?? 0) / 3.2));
      return {
        position: i + 1,
        teamName,
        points: POINTS[i] ?? 0,
        played,
        won,
        lost: played - won,
        setsWon: won * 3 + (played - won),
        setsLost: (played - won) * 3 + Math.floor(won / 3),
        logoUrl: null,
        ours: i === OURS,
      };
    }),
  },
});
