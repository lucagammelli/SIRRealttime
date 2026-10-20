import type { StatsCurve, StatsMatchRow, StatsNow, StatsOverview } from '@arenalive/shared';
import { StatsCurveSchema, StatsNowSchema, StatsOverviewSchema } from '@arenalive/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { curveOption, dailyOption } from '../../charts/stats.ts';
import { EChart } from '../../charts/EChart.tsx';
import { Button, Card, Empty, ErrorBox, Segmented, Spinner } from '../../components/ui.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatCount, formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { Field, inputClass } from './forms.tsx';
import { dayText, formatDuration, romeDayOf, shiftDay, statsCsv, withShare } from './statsText.ts';

const PRESETS = [
  { value: 7, label: '7 giorni' },
  { value: 30, label: '30 giorni' },
  { value: 90, label: '90 giorni' },
  { value: 365, label: '1 anno' },
] as const;

/** «Adesso» is read again this often. */
export const NOW_REFRESH_MS = 10_000;

const KIND_TEXT = {
  channel: 'Canale del club',
  fixture: 'Partita del calendario',
  match: 'Partita fissa',
  deleted: 'Link eliminato',
} as const;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface-2 px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="tabular text-2xl font-semibold text-text">{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </div>
  );
}

/** Spectators connected right now, read again every 10 seconds. */
function NowCard() {
  const errorMessage = useApiError();
  const load = useCallback((signal: AbortSignal) => apiRequest('/api/admin/stats/now', StatsNowSchema, { signal }), []);
  const { data, error, loading, reload } = useAsync(load);
  useEffect(() => {
    const id = setInterval(reload, NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, [reload]);
  const now: StatsNow | null = data;
  return (
    <Card title="Adesso" subtitle="Spettatori collegati in questo momento (le simulazioni non sono contate)">
      {loading && !now && <Spinner label="Lettura degli spettatori…" />}
      {error !== null && <ErrorBox onRetry={reload}>{errorMessage(error)}</ErrorBox>}
      {now && (
        <div className="space-y-3">
          <p className="tabular text-4xl font-semibold text-text" aria-live="polite">
            {formatCount(now.viewers)}
            <span className="ml-2 text-base font-normal text-muted">
              {now.viewers === 1 ? 'spettatore collegato' : 'spettatori collegati'}
            </span>
          </p>
          <p className="text-sm text-muted">
            {now.live ? `Partita live: ${now.live.label}` : 'Nessuna partita live in questo momento.'}
          </p>
          {now.links.length > 0 && (
            <ul className="space-y-1 text-sm">
              {now.links.map((l) => (
                <li key={l.label} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">{l.label}</span>
                  <span className="tabular font-medium">{l.viewers}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function MatchCurve({ matchId }: { matchId: string }) {
  const errorMessage = useApiError();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest(`/api/admin/stats/matches/${matchId}/curve`, StatsCurveSchema, { signal }),
    [matchId],
  );
  const { data, error, loading, reload } = useAsync(load);
  const curve: StatsCurve | null = data;
  const option = useMemo(() => (curve ? curveOption(curve) : null), [curve]);
  return (
    <div className="px-4 py-3 sm:px-5">
      {loading && <Spinner label="Caricamento della curva…" />}
      {error !== null && <ErrorBox onRetry={reload}>{errorMessage(error)}</ErrorBox>}
      {curve && curve.points.length === 0 && <Empty>Nessuna curva: nessuno spettatore campionato.</Empty>}
      {option && curve && curve.points.length > 0 && (
        <EChart option={option} label="Spettatori collegati minuto per minuto durante la partita" className="h-56" />
      )}
    </div>
  );
}

function MatchesTable({ rows }: { rows: StatsMatchRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <Empty>Nessuna visita nel periodo.</Empty>;
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-2 pl-4 sm:pl-5">Partita</th>
            <th className="px-2 text-right">Visite</th>
            <th className="px-2 text-right">Da QR</th>
            <th className="px-2 text-right">Picco</th>
            <th className="px-2">Ora del picco</th>
            <th className="px-2 text-right">Durata media</th>
            <th className="px-2 pr-4 text-right sm:pr-5">Tempo totale</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <MatchRow
              key={m.matchId ?? 'nessuna'}
              m={m}
              open={open === m.matchId && m.matchId !== null}
              onToggle={() => setOpen(open === m.matchId ? null : m.matchId)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatchRow({ m, open, onToggle }: { m: StatsMatchRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-grid last:border-0 hover:bg-surface-2">
        <td className="py-2 pl-4 sm:pl-5">
          <span className="font-medium">{m.label}</span>
          {m.matchId && (
            <Button
              variant="ghost"
              className="ml-2 !min-h-0 !px-2 !py-0.5 text-xs"
              aria-expanded={open}
              onClick={onToggle}
            >
              {open ? 'Nascondi curva' : 'Curva spettatori'}
            </Button>
          )}
        </td>
        <td className="tabular px-2 text-right">{formatCount(m.visits)}</td>
        <td className="tabular px-2 text-right">{withShare(m.qrVisits, m.visits)}</td>
        <td className="tabular px-2 text-right">{formatCount(m.peak)}</td>
        <td className="px-2">{m.peakAt ? formatDateTime(m.peakAt) : '–'}</td>
        <td className="tabular px-2 text-right">{formatDuration(m.avgSeconds)}</td>
        <td className="tabular px-2 pr-4 text-right sm:pr-5">{formatDuration(m.totalSeconds)}</td>
      </tr>
      {open && m.matchId && (
        <tr className="border-b border-grid">
          <td colSpan={7}>
            <MatchCurve matchId={m.matchId} />
          </td>
        </tr>
      )}
    </>
  );
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Overview({ o }: { o: StatsOverview }) {
  const option = useMemo(() => dailyOption(o.daily), [o.daily]);
  const devices = o.devices.tv + o.devices.tablet + o.devices.phone;
  return (
    <div className="space-y-4">
      <Card
        title="In sintesi"
        subtitle={`${dayText(o.from)} – ${dayText(o.to)}`}
        actions={
          <Button onClick={() => download(statsCsv(o), `statistiche-${o.from}-${o.to}.csv`)}>Esporta CSV</Button>
        }
      >
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Kpi label="Visite" value={formatCount(o.totals.visits)} />
          <Kpi label="Da QR" value={withShare(o.totals.qrVisits, o.totals.visits)} />
          <Kpi
            label="Picco spettatori"
            value={formatCount(o.totals.peak)}
            {...(o.totals.peakAt ? { hint: formatDateTime(o.totals.peakAt) } : {})}
          />
          <Kpi label="Durata media" value={formatDuration(o.totals.avgSeconds)} />
          <Kpi label="Tempo totale" value={formatDuration(o.totals.totalSeconds)} />
        </dl>
      </Card>
      <Card title="Andamento per giornata" subtitle="Visite e picco di spettatori di ogni giorno">
        {o.daily.length === 0 ? (
          <Empty>Nessuna visita nel periodo.</Empty>
        ) : (
          <EChart option={option} label="Visite e picco di spettatori per giornata" className="h-60" />
        )}
      </Card>
      <Card title="Partite" subtitle="Visite, picco e durata per partita">
        <MatchesTable rows={o.matches} />
      </Card>
      <Card title="Link e QR" subtitle="Da dove arrivano le visite">
        {o.links.length === 0 ? (
          <Empty>Nessuna visita nel periodo.</Empty>
        ) : (
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pl-4 sm:pl-5">Link</th>
                  <th className="px-2">Tipo</th>
                  <th className="px-2 text-right">Visite</th>
                  <th className="px-2 text-right">Da QR</th>
                  <th className="px-2 pr-4 text-right sm:pr-5">Durata media</th>
                </tr>
              </thead>
              <tbody>
                {o.links.map((l) => (
                  <tr key={l.shareTokenId ?? 'eliminato'} className="border-b border-grid last:border-0">
                    <td className="py-2 pl-4 sm:pl-5 font-medium">{l.label}</td>
                    <td className="px-2">{KIND_TEXT[l.kind]}</td>
                    <td className="tabular px-2 text-right">{formatCount(l.visits)}</td>
                    <td className="tabular px-2 text-right">{withShare(l.qrVisits, l.visits)}</td>
                    <td className="tabular px-2 pr-4 text-right sm:pr-5">{formatDuration(l.avgSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Dispositivi e app" subtitle="Come guardano la partita">
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="Maxischermo" value={withShare(o.devices.tv, devices)} />
          <Kpi label="Tablet" value={withShare(o.devices.tablet, devices)} />
          <Kpi label="Smartphone" value={withShare(o.devices.phone, devices)} />
          <Kpi label="App installata" value={withShare(o.totals.appVisits, o.totals.visits)} />
        </dl>
      </Card>
    </div>
  );
}

/**
 * «Statistiche» (`/admin/statistiche`, admin and viewer): visits of the public pages of the client, without cookies and
 * without personal data. «Adesso» is live; the rest follows the period chosen (days of Rome).
 */
export function StatsPage() {
  const errorMessage = useApiError();
  const today = useMemo(() => romeDayOf(new Date()), []);
  const [days, setDays] = useState<number>(30);
  const [range, setRange] = useState({ from: shiftDay(today, -29), to: today });
  useEffect(() => {
    document.title = 'Statistiche · Area riservata';
  }, []);
  const choose = (n: number): void => {
    setDays(n);
    setRange({ from: shiftDay(today, -(n - 1)), to: today });
  };
  const valid =
    range.from <= range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to);
  const load = useCallback(
    (signal: AbortSignal) =>
      valid
        ? apiRequest(`/api/admin/stats?from=${range.from}&to=${range.to}`, StatsOverviewSchema, { signal })
        : Promise.reject(new Error('periodo non valido')),
    [range, valid],
  );
  const { data, error, loading, reload } = useAsync(load);
  return (
    <div className="space-y-4">
      <NowCard />
      <Card
        title="Periodo"
        subtitle="Le giornate sono quelle italiane; il dettaglio resta 90 giorni, poi solo i totali"
      >
        <div className="flex flex-wrap items-end gap-3">
          <Segmented
            label="Periodo"
            value={days}
            options={PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            onChange={choose}
          />
          <Field label="Dal">
            <input
              type="date"
              className={inputClass}
              value={range.from}
              max={range.to}
              onChange={(e) => {
                setDays(0);
                setRange({ ...range, from: e.target.value });
              }}
            />
          </Field>
          <Field label="Al">
            <input
              type="date"
              className={inputClass}
              value={range.to}
              min={range.from}
              onChange={(e) => {
                setDays(0);
                setRange({ ...range, to: e.target.value });
              }}
            />
          </Field>
        </div>
        {!valid && (
          <p className="mt-2 text-sm text-danger">
            Scegli un periodo valido: la data iniziale non può seguire la finale.
          </p>
        )}
      </Card>
      {loading && !data && valid && <Spinner label="Caricamento delle statistiche…" />}
      {valid && error !== null && <ErrorBox onRetry={reload}>{errorMessage(error)}</ErrorBox>}
      {valid && data && <Overview o={data} />}
    </div>
  );
}
