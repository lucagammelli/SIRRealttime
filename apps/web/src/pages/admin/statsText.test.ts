import type { StatsOverview } from '@sir/shared';
import { describe, expect, it } from 'vitest';
import { csvCell, dayText, formatDuration, shiftDay, statsCsv, withShare } from './statsText.ts';

describe('statsText', () => {
  it('writes durations and shares', () => {
    expect(formatDuration(0)).toBe('–');
    expect(formatDuration(45)).toBe('45 s');
    expect(formatDuration(260)).toBe('4 min 20 s');
    expect(formatDuration(3900)).toBe('1 h 05 min');
    expect(withShare(1, 4)).toBe('1 (25%)');
    expect(withShare(0, 0)).toBe('0');
    expect(dayText('2026-10-17')).toBe('17/10/2026');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('neutralizes the formulas: = + - @ tab and carriage return are prefixed', () => {
    for (const bad of ['=SOMMA(A1:A2)', '+1', '-2+3', '@cmd', '\tx', '\rx'])
      expect(csvCell(bad).replace(/^"|"$/g, '')).toMatch(/^'/);
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvCell('Perugia – Trento')).toBe('Perugia – Trento');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('riga\nnuova')).toBe('"riga\nnuova"');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
  });

  it('builds the CSV with a BOM, ; and CRLF, with labels neutralized', () => {
    const overview: StatsOverview = {
      from: '2026-10-01',
      to: '2026-10-17',
      totals: { visits: 3, qrVisits: 1, appVisits: 0, totalSeconds: 300, avgSeconds: 100, peak: 2, peakAt: null },
      devices: { tv: 0, tablet: 1, phone: 2 },
      matches: [
        {
          matchId: null,
          label: '=1+1',
          visits: 3,
          qrVisits: 1,
          totalSeconds: 300,
          avgSeconds: 100,
          peak: 2,
          peakAt: '2026-10-17T10:00:00.000Z',
        },
      ],
      links: [{ shareTokenId: null, label: '-link', kind: 'deleted', visits: 3, qrVisits: 1, avgSeconds: 100 }],
      daily: [{ day: '2026-10-17', visits: 3, totalSeconds: 300, peak: 2 }],
    };
    const csv = statsCsv(overview);
    expect(csv.startsWith(`${String.fromCharCode(0xfeff)}Periodo;01/10/2026 - 17/10/2026\r\n`)).toBe(true);
    expect(csv).toContain("\r\n'=1+1;3;1;2;2026-10-17T10:00:00.000Z;100;300\r\n");
    expect(csv).toContain("\r\n'-link;deleted;3;1;100\r\n");
    expect(csv).not.toMatch(/(^|[;\n])[=+@-]/);
  });
});
