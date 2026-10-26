import type { ClubFixture, DisplayCommand, DisplaySummary, DisplayTarget } from '@arenalive/shared';
import {
  CalendarResponseSchema,
  ClubResponseSchema,
  CreateDisplayRequestSchema,
  DISPLAY_CONFIG_FILE_NAME,
  DisplayConfigFileSchema,
  DisplaySummarySchema,
} from '@arenalive/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useRefresh } from '../../lib/useRefresh.ts';
import { READ_ONLY_TEXT, useCanEdit } from '../../lib/useCanEdit.ts';
import { useApiError } from './auth.tsx';
import { COMMAND_LABEL, displayStateText, targetChoices, targetKey, targetText, wifiOf } from './displayText.ts';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { MatchListSchema } from './MatchesPage.tsx';

const DisplayListSchema = z.array(DisplaySummarySchema);

/** While the page is open the players are read again this often (they send a heartbeat every 15 s). */
export const DISPLAYS_REFRESH_MS = 5000;

/** Text of the image of the SD card (the link comes with the software of the player). */
export const IMAGE_TEXT = 'Scarica l’immagine ArenaLive Player';

/** Saves `text` as a file named `name` (the browser download, from memory). */
function saveFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * «Scarica configurazione» of a player: optional Wi-Fi (never kept by the server), warning that the previous file
 * stops working, download of `arenalive-player.json` and where to copy it.
 */
function ConfigDownload({ display, onDone }: { display: DisplaySummary; onDone: () => void }) {
  const errorMessage = useApiError();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('IT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const wifi = wifiOf({ ssid, password, country });
    if ('error' in wifi) {
      setError(wifi.error);
      return;
    }
    setBusy(true);
    try {
      const file = await apiRequest(
        `/api/admin/displays/${encodeURIComponent(display.id)}/config`,
        DisplayConfigFileSchema,
        { method: 'POST', body: wifi.wifi ? { wifi: wifi.wifi } : {} },
      );
      saveFile(DISPLAY_CONFIG_FILE_NAME, `${JSON.stringify(file, null, 2)}\n`);
      setPassword('');
      setSaved(true);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="space-y-3 rounded-card border border-border p-3"
      noValidate
      aria-label={`Configurazione di ${display.name}`}
    >
      {display.configured && (
        <p className="text-sm text-warn">
          Un nuovo file sostituisce il precedente: la scheda SD con il file vecchio smette di funzionare.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem]">
        <Field label="Rete Wi-Fi (facoltativa)" hint="Vuota: il player usa il cavo di rete.">
          <input value={ssid} onChange={(e) => setSsid(e.target.value)} maxLength={32} className={inputClass} />
        </Field>
        <Field label="Password del Wi-Fi" hint="Vuota per una rete aperta. Non resta sul server.">
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            maxLength={63}
            className={inputClass}
          />
        </Field>
        <Field label="Paese">
          <input value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} className={inputClass} />
        </Field>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'Preparazione…' : 'Scarica il file del player'}
      </Button>
      {saved && (
        <p className="text-sm text-text" role="status">
          File {DISPLAY_CONFIG_FILE_NAME} scaricato.
        </p>
      )}
      <p className="text-xs text-muted">
        Copia il file nella partizione <span className="font-semibold text-text">bootfs</span> della scheda SD del
        Raspberry, accanto agli altri file. All’accensione il player lo legge da solo e apre la pagina.
      </p>
    </form>
  );
}

/**
 * Players for big screens («Player»: a Raspberry Pi connected to the screen): create, choose what each one shows,
 * send commands (reload, reboot, screen off/on), download the configuration for the SD card, revoke. The list is read
 * again every 5 s (state «In linea» from the last heartbeat).
 */
export function DisplaysPage() {
  const errorMessage = useApiError();
  const canEdit = useCanEdit();
  const load = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/displays', DisplayListSchema, { signal }),
    [],
  );
  const displays = useAsync(load);
  const loadMatches = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/matches', MatchListSchema, { signal }),
    [],
  );
  const matches = useAsync(loadMatches);
  const loadCalendar = useCallback(
    (signal: AbortSignal): Promise<{ fixtures: ClubFixture[]; ourName: string | null }> =>
      Promise.all([
        apiRequest('/api/admin/calendar', CalendarResponseSchema, { signal }),
        apiRequest('/api/admin/club', ClubResponseSchema, { signal }),
      ]).then(
        ([calendar, club]) => ({ fixtures: calendar.fixtures, ourName: club.name }),
        // Without a calendar the matches of the calendar are just not offered.
        () => ({ fixtures: [], ourName: null }),
      ),
    [],
  );
  const calendar = useAsync(loadCalendar);
  useRefresh(displays.reload, DISPLAYS_REFRESH_MS);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState<string | null>(null);
  const now = Date.now();

  useEffect(() => {
    document.title = 'Player · Area riservata';
  }, []);

  const choicesFor = (current?: DisplayTarget) =>
    targetChoices({
      fixtures: calendar.data?.fixtures ?? [],
      matches: matches.data ?? [],
      ourName: calendar.data?.ourName ?? null,
      now,
      ...(current ? { current } : {}),
    });

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    const body = CreateDisplayRequestSchema.safeParse({ name: name.trim() });
    if (!body.success) {
      setFormError('Scrivi un nome (al massimo 100 caratteri, senza caratteri speciali).');
      return;
    }
    setBusy(true);
    try {
      const created = await apiRequest('/api/admin/displays', DisplaySummarySchema, {
        method: 'POST',
        body: body.data,
      });
      setName('');
      setConfigOpen(created.id);
      displays.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** A change of one player (target, command, revocation), then the list again. */
  const act = async (id: string, run: () => Promise<unknown>): Promise<void> => {
    setWorking(id);
    setListError(null);
    try {
      await run();
      displays.reload();
    } catch (err) {
      setListError(errorMessage(err));
    } finally {
      setWorking(null);
    }
  };
  const path = (id: string) => `/api/admin/displays/${encodeURIComponent(id)}`;
  const setTarget = (id: string, target: DisplayTarget) =>
    act(id, () => apiRequest(path(id), DisplaySummarySchema, { method: 'PATCH', body: { target } }));
  const command = (id: string, c: DisplayCommand) =>
    act(id, () => apiRequest(`${path(id)}/command`, DisplaySummarySchema, { method: 'POST', body: { command: c } }));
  const revoke = (id: string) => act(id, () => apiCommand(path(id), { method: 'DELETE' }));

  const list = displays.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        {canEdit && (
          <Card title="Nuovo player" subtitle="Un Raspberry Pi collegato a un maxischermo o a un televisore.">
            <form onSubmit={(e) => void create(e)} className="space-y-4" noValidate>
              <Field label="Nome" hint="Es. «Maxischermo tribuna».">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                  className={inputClass}
                />
              </Field>
              {formError && <ErrorBox>{formError}</ErrorBox>}
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Creazione…' : 'Crea player'}
              </Button>
            </form>
          </Card>
        )}
        <Card title="Scheda SD del player">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              <span className="text-text">{IMAGE_TEXT}</span> e scrivila sulla scheda SD con Raspberry Pi Imager.
            </li>
            <li>Crea il player qui e premi «Scarica configurazione».</li>
            <li>
              Copia <code className="font-mono text-text">{DISPLAY_CONFIG_FILE_NAME}</code> nella partizione bootfs
              della scheda SD, accanto agli altri file.
            </li>
            <li>Inserisci la scheda nel Raspberry e accendilo: dopo poco qui risulta «In linea».</li>
          </ol>
        </Card>
      </div>

      <Card title="Player">
        {!canEdit && <p className="mb-2 text-sm text-muted">{READ_ONLY_TEXT}</p>}
        {displays.loading && !list && <Spinner label="Caricamento dei player…" />}
        {displays.error !== null && <ErrorBox onRetry={displays.reload}>{errorMessage(displays.error)}</ErrorBox>}
        {listError && <ErrorBox>{listError}</ErrorBox>}
        {list && list.length === 0 && <Empty>Nessun player creato.</Empty>}
        {list && list.length > 0 && (
          <ul className="divide-y divide-grid">
            {list.map((d) => {
              const state = displayStateText(d, now);
              const choices = choicesFor(d.target);
              const disabled = working !== null;
              return (
                <li key={d.id} className="space-y-3 py-3" data-testid="display">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-text">
                        {d.name}{' '}
                        <span className={`ml-1 text-xs font-semibold uppercase ${state.className}`}>{state.text}</span>
                      </p>
                      <p className="text-xs text-muted">
                        Mostra: {targetText(d.target, choices)}
                        {d.version && ` · versione ${d.version}`}
                        {d.resolution && ` · schermo ${d.resolution}`}
                        {d.lastIp && ` · IP ${d.lastIp}`}
                        {` · creato ${formatDateTime(d.createdAt)}`}
                      </p>
                      {d.command && !d.revoked && (
                        <p className="text-xs text-warn">Comando in attesa: {COMMAND_LABEL[d.command]}</p>
                      )}
                    </div>
                    {canEdit && !d.revoked && (
                      <ConfirmButton
                        label="Revoca"
                        confirmLabel="Conferma revoca"
                        busy={working === d.id}
                        onConfirm={() => void revoke(d.id)}
                      />
                    )}
                  </div>
                  {canEdit && !d.revoked && (
                    <>
                      <Field label="Cosa mostra">
                        <select
                          value={targetKey(d.target)}
                          disabled={disabled}
                          onChange={(e) => {
                            const chosen = choices.find((c) => c.key === e.target.value);
                            if (chosen) void setTarget(d.id, chosen.target);
                          }}
                          className={inputClass}
                        >
                          {choices.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.text}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="flex flex-wrap gap-2" role="group" aria-label={`Comandi di ${d.name}`}>
                        <Button disabled={disabled} onClick={() => void command(d.id, 'reload')}>
                          {COMMAND_LABEL.reload}
                        </Button>
                        <ConfirmButton
                          label={COMMAND_LABEL.reboot}
                          confirmLabel="Conferma riavvio"
                          busy={false}
                          onConfirm={() => void command(d.id, 'reboot')}
                        />
                        <Button disabled={disabled} onClick={() => void command(d.id, 'screenOff')}>
                          {COMMAND_LABEL.screenOff}
                        </Button>
                        <Button disabled={disabled} onClick={() => void command(d.id, 'screenOn')}>
                          {COMMAND_LABEL.screenOn}
                        </Button>
                        <Button
                          variant="ghost"
                          aria-expanded={configOpen === d.id}
                          onClick={() => setConfigOpen((open) => (open === d.id ? null : d.id))}
                        >
                          Scarica configurazione
                        </Button>
                      </div>
                      {configOpen === d.id && <ConfigDownload display={d} onDone={displays.reload} />}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
