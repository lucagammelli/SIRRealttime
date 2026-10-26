import type { ClubFixture, DisplayCommand, DisplaySummary, DisplayTarget, PlayerImageInfo } from '@arenalive/shared';
import {
  CalendarResponseSchema,
  ClubResponseSchema,
  CreateDisplayRequestSchema,
  DISPLAY_CONFIG_FILE_NAME,
  DisplayConfigFileSchema,
  displayImagePath,
  DisplayImageTicketSchema,
  DisplaySummarySchema,
  PLAYER_IMAGE_PATH,
  PlayerImageInfoSchema,
} from '@arenalive/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, buttonClass, Card, CopyButton, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { formatDateTime, megabytes } from '../../lib/format.ts';
import type { AsyncState } from '../../lib/useAsync.ts';
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

/** Link of the generic image of the SD card. */
export const IMAGE_TEXT = 'Scarica l’immagine ArenaLive Player';
/** The server has no image to offer yet. */
export const IMAGE_MISSING_TEXT = 'Immagine non ancora pubblicata sul server';
/** Main button of the configuration of a player: the image ready for it. */
export const READY_IMAGE_TEXT = 'Scarica l’immagine pronta';
/** Button of the configuration file alone. */
export const CONFIG_ONLY_TEXT = 'Solo il file di configurazione';
/** How to use the ready image. */
export const READY_IMAGE_HELP =
  'Scrivila sulla scheda SD con Raspberry Pi Imager («Usa file personalizzato»), rispondi No alla personalizzazione, inserisci la scheda e accendi.';
/** The server offers only the generic image (or none): no ready image. */
export const READY_IMAGE_MISSING_TEXT =
  'L’immagine pronta non è disponibile sul server: scarica il file di configurazione e copialo sulla scheda SD.';

/**
 * Generic image of the SD card offered by the server (admins only, as the download): a plain link (about 750 MB,
 * never in the memory of the page) with version, size and sha256 to check it; the text of the missing image otherwise.
 */
function ImageDownload({ info }: { info: AsyncState<PlayerImageInfo> }) {
  const errorMessage = useApiError();
  const data = info.data;
  if (info.loading && !data) return <Spinner label="Caricamento dell’immagine…" />;
  if (info.error !== null) return <ErrorBox onRetry={info.reload}>{errorMessage(info.error)}</ErrorBox>;
  if (!data?.available) return <p className="text-sm font-medium text-text">{IMAGE_MISSING_TEXT}.</p>;
  return (
    <div className="space-y-2 text-sm">
      <a href={PLAYER_IMAGE_PATH} download={data.fileName} className={buttonClass(data.ready ? 'ghost' : 'primary')}>
        {IMAGE_TEXT}
      </a>
      {data.ready && (
        <p className="text-xs text-muted">Generica, senza configurazione: per un player usa «{READY_IMAGE_TEXT}».</p>
      )}
      <p className="text-muted" data-testid="player-image">
        Versione <span className="font-mono text-text">{data.version}</span> · {formatDateTime(data.builtAt)} ·{' '}
        {megabytes(data.bytes)} MB
      </p>
      <p className="break-all text-xs text-muted">
        {data.sha256Of === 'image' ? 'sha256 dell’immagine decompressa' : 'sha256'}{' '}
        <span className="font-mono text-text">{data.sha256}</span>
      </p>
      <CopyButton text={data.sha256} label="Copia sha256" />
    </div>
  );
}

/** Starts the download of `url` as `name` with a plain link (the file never goes into the memory of the page). */
function downloadLink(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

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
 * «Scarica configurazione» of a player: optional Wi-Fi (never kept by the server), warning that the previous download
 * stops working, then the image ready for the player (`ready`: the server has the image in three parts; a ticket,
 * then a plain link) or `arenalive-player.json` alone and where to copy it.
 */
function ConfigDownload({ display, ready, onDone }: { display: DisplaySummary; ready: boolean; onDone: () => void }) {
  const errorMessage = useApiError();
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('IT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<'image' | 'file' | null>(null);

  const run = async (what: 'image' | 'file'): Promise<void> => {
    setError(null);
    const wifi = wifiOf({ ssid, password, country });
    if ('error' in wifi) {
      setError(wifi.error);
      return;
    }
    setBusy(true);
    const path = `/api/admin/displays/${encodeURIComponent(display.id)}`;
    const body = wifi.wifi ? { wifi: wifi.wifi } : {};
    try {
      if (what === 'image') {
        const t = await apiRequest(`${path}/image`, DisplayImageTicketSchema, { method: 'POST', body });
        downloadLink(displayImagePath(t.ticket), t.fileName);
      } else {
        const file = await apiRequest(`${path}/config`, DisplayConfigFileSchema, { method: 'POST', body });
        saveFile(DISPLAY_CONFIG_FILE_NAME, `${JSON.stringify(file, null, 2)}\n`);
      }
      setPassword('');
      setSaved(what);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void run(ready ? 'image' : 'file');
  };

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded-card border border-border p-3"
      noValidate
      aria-label={`Configurazione di ${display.name}`}
    >
      {display.configured && (
        <p className="text-sm text-warn">
          Il download precedente smette di valere: la scheda SD preparata prima smette di funzionare.
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
      {!ready && <p className="text-sm text-muted">{READY_IMAGE_MISSING_TEXT}</p>}
      <div className="flex flex-wrap gap-2">
        {ready && (
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Preparazione…' : READY_IMAGE_TEXT}
          </Button>
        )}
        <Button
          type={ready ? 'button' : 'submit'}
          variant={ready ? 'ghost' : 'primary'}
          disabled={busy}
          onClick={ready ? () => void run('file') : undefined}
        >
          {busy && !ready ? 'Preparazione…' : CONFIG_ONLY_TEXT}
        </Button>
      </div>
      {saved === 'image' && (
        <p className="text-sm text-text" role="status">
          Download dell’immagine avviato.
        </p>
      )}
      {saved === 'file' && (
        <p className="text-sm text-text" role="status">
          File {DISPLAY_CONFIG_FILE_NAME} scaricato.
        </p>
      )}
      {ready && <p className="text-xs text-muted">{READY_IMAGE_HELP}</p>}
      <p className="text-xs text-muted">
        {ready ? 'Con il solo file di configurazione: copialo' : 'Copia il file'} nella partizione{' '}
        <span className="font-semibold text-text">bootfs</span> della scheda SD con l’immagine generica, accanto agli
        altri file. All’accensione il player lo legge da solo e apre la pagina.
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
  const loadImage = useCallback(
    (signal: AbortSignal): Promise<PlayerImageInfo> =>
      canEdit
        ? apiRequest(`${PLAYER_IMAGE_PATH}/info`, PlayerImageInfoSchema, { signal })
        : Promise.resolve({ available: false }),
    [canEdit],
  );
  const image = useAsync(loadImage);
  const ready = image.data?.available === true && image.data.ready;
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
          {canEdit && (
            <div className="mb-3">
              <ImageDownload info={image} />
            </div>
          )}
          {ready ? (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Crea il player qui e premi «Scarica configurazione».</li>
              <li>
                Premi «{READY_IMAGE_TEXT}» e scrivila sulla scheda SD con Raspberry Pi Imager («Usa file
                personalizzato»), rispondendo No alla personalizzazione.
              </li>
              <li>Inserisci la scheda nel Raspberry e accendilo: dopo poco qui risulta «In linea».</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>
                Scarica l’immagine ArenaLive Player e scrivila sulla scheda SD con Raspberry Pi Imager («Usa file
                personalizzato»).
              </li>
              <li>Crea il player qui e premi «Scarica configurazione».</li>
              <li>
                Copia <code className="font-mono text-text">{DISPLAY_CONFIG_FILE_NAME}</code> nella partizione bootfs
                della scheda SD, accanto agli altri file.
              </li>
              <li>Inserisci la scheda nel Raspberry e accendilo: dopo poco qui risulta «In linea».</li>
            </ol>
          )}
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
                      {configOpen === d.id && <ConfigDownload display={d} ready={ready} onDone={displays.reload} />}
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
