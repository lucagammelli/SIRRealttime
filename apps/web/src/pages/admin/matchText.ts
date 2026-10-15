import type { MatchSummary } from '@sir/shared';

const STATUS: Record<string, string> = { notStarted: 'Non iniziata', inProgress: 'In corso', finished: 'Conclusa' };

export function matchTitle(m: Pick<MatchSummary, 'homeName' | 'awayName' | 'matchKey'>): string {
  if (m.homeName || m.awayName) return `${m.homeName ?? 'Casa'} – ${m.awayName ?? 'Ospiti'}`;
  return m.matchKey;
}

export function matchStatus(m: Pick<MatchSummary, 'status'>): string {
  return m.status ? (STATUS[m.status] ?? m.status) : 'Senza dati';
}
