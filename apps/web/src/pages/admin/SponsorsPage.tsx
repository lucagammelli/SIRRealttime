import type { AssetSummary, Sponsor } from '@sir/shared';
import {
  AssetListResponseSchema,
  AssetSummarySchema,
  CreateSponsorRequestSchema,
  SPONSOR_IMAGES_MAX,
  SponsorListResponseSchema,
  SponsorSchema,
  UpdateSponsorRequestSchema,
} from '@sir/shared';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Empty, ErrorBox, Spinner } from '../../components/ui.tsx';
import { apiCommand, apiRequest } from '../../lib/api.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useApiError } from './auth.tsx';
import { ConfirmButton, Field, inputClass } from './forms.tsx';
import { ACCEPT, IMAGE_TOO_LARGE, imageCountText, uploadSponsorImage } from './imageUpload.ts';

/** First problem of a sponsor form, in Italian. */
function formProblem(issues: readonly { path: readonly PropertyKey[] }[]): string {
  const field = issues[0]?.path[0];
  if (field === 'website') return 'Sito non valido: scrivi l’indirizzo completo che inizia con https://';
  return 'Il nome è obbligatorio (al massimo 80 caratteri).';
}

/** Pure: website typed in a form, null when empty. */
const websiteOf = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** Pure: the ids of the list with the sponsor at `from` moved to `to`. */
export function movedIds(ids: readonly string[], from: number, to: number): string[] {
  const out = [...ids];
  const [id] = out.splice(from, 1);
  if (id === undefined || to < 0 || to > out.length) return [...ids];
  out.splice(to, 0, id);
  return out;
}

/** Name and website of a sponsor (new or changed). */
function SponsorFields({
  name,
  website,
  onName,
  onWebsite,
}: {
  name: string;
  website: string;
  onName: (v: string) => void;
  onWebsite: (v: string) => void;
}) {
  return (
    <>
      <Field label="Nome">
        <input value={name} onChange={(e) => onName(e.target.value)} maxLength={80} className={inputClass} />
      </Field>
      <Field label="Sito (facoltativo)" hint="Indirizzo completo, es. https://www.sponsor.it: le immagini ci portano.">
        <input
          type="url"
          inputMode="url"
          value={website}
          onChange={(e) => onWebsite(e.target.value)}
          placeholder="https://"
          className={inputClass}
        />
      </Field>
    </>
  );
}

/**
 * «Sponsor»: the sponsors of the client in their order (the order of the rotation), each with name, optional website
 * and its images (upload, take away, delete); the sponsor images without sponsor, to give to one. The blocks and the
 * pauses of the «Studio grafico» choose the sponsors.
 */
export function SponsorsPage() {
  const errorMessage = useApiError();
  const loadSponsors = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/sponsors', SponsorListResponseSchema, { signal }),
    [],
  );
  const loadAssets = useCallback(
    (signal: AbortSignal) => apiRequest('/api/admin/assets', AssetListResponseSchema, { signal }),
    [],
  );
  const sponsors = useAsync(loadSponsors);
  const assets = useAsync(loadAssets);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Sponsor · Area riservata';
  }, []);

  const reload = (): void => {
    sponsors.reload();
    assets.reload();
  };

  /** Runs an action of the list (one at a time), then reloads; the error in Italian. */
  const run = async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setBusy(key);
    try {
      await action();
      reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setFormError(null);
    const body = CreateSponsorRequestSchema.safeParse({ name, website: websiteOf(website) });
    if (!body.success) {
      setFormError(formProblem(body.error.issues));
      return;
    }
    setBusy('nuovo');
    try {
      await apiRequest('/api/admin/sponsors', SponsorSchema, { method: 'POST', body: body.data });
      setName('');
      setWebsite('');
      reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const list = sponsors.data?.sponsors ?? [];
  const byId = new Map((assets.data?.assets ?? []).map((a) => [a.id, a]));
  const loose = (assets.data?.assets ?? []).filter((a) => a.kind === 'sponsor' && a.sponsorId === null);
  const move = (from: number, to: number): void => {
    const ids = movedIds(
      list.map((s) => s.id),
      from,
      to,
    );
    void run(`ordine`, () =>
      apiRequest('/api/admin/sponsors/order', SponsorListResponseSchema, { method: 'PUT', body: { ids } }),
    );
  };
  const giveTo = (assetId: string, sponsorId: string | null): Promise<boolean> =>
    run(`immagine-${assetId}`, () =>
      apiRequest(`/api/admin/assets/${encodeURIComponent(assetId)}`, AssetSummarySchema, {
        method: 'PATCH',
        body: { sponsorId },
      }),
    );

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <Card title="Nuovo sponsor">
        <form onSubmit={(e) => void create(e)} className="space-y-4" noValidate aria-label="Nuovo sponsor">
          <SponsorFields name={name} website={website} onName={setName} onWebsite={setWebsite} />
          {formError && <ErrorBox>{formError}</ErrorBox>}
          <Button type="submit" variant="primary" disabled={busy === 'nuovo'}>
            {busy === 'nuovo' ? 'Creazione…' : 'Crea sponsor'}
          </Button>
        </form>
      </Card>
      <div className="space-y-4">
        <Card
          title="Sponsor"
          subtitle="Nei blocchi sponsor e nelle pause dello «Studio grafico» scegli gli sponsor: le loro immagini ruotano in quest’ordine."
        >
          {(sponsors.loading || assets.loading) && !sponsors.data && <Spinner label="Caricamento degli sponsor…" />}
          {sponsors.error !== null && <ErrorBox onRetry={reload}>{errorMessage(sponsors.error)}</ErrorBox>}
          {assets.error !== null && <ErrorBox onRetry={reload}>{errorMessage(assets.error)}</ErrorBox>}
          {error && <ErrorBox>{error}</ErrorBox>}
          {sponsors.data && list.length === 0 && <Empty>Nessuno sponsor: crealo qui accanto.</Empty>}
          {list.length > 0 && (
            <ol className="divide-y divide-grid">
              {list.map((s, i) => (
                <SponsorRow
                  key={s.id}
                  sponsor={s}
                  index={i}
                  count={list.length}
                  images={s.imageIds.map((id) => byId.get(id)).filter((a): a is AssetSummary => a !== undefined)}
                  busy={busy}
                  run={run}
                  onMove={move}
                  onTakeAway={(assetId) => void giveTo(assetId, null)}
                />
              ))}
            </ol>
          )}
        </Card>
        {loose.length > 0 && (
          <Card
            title="Immagini senza sponsor"
            subtitle="Immagini sponsor caricate prima dell’elenco degli sponsor, o tolte da uno sponsor: assegnale a uno sponsor."
          >
            <ul className="divide-y divide-grid">
              {loose.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <img src={a.url} alt="" className="size-12 rounded object-contain" />
                  <span className="min-w-0 flex-1 text-sm text-text">
                    {a.width}×{a.height} px
                  </span>
                  <label className="flex items-center gap-2 text-sm text-text">
                    Assegna a
                    <select
                      className={`${inputClass} w-auto`}
                      value=""
                      disabled={list.length === 0 || busy === `immagine-${a.id}`}
                      onChange={(e) => {
                        if (e.target.value) void giveTo(a.id, e.target.value);
                      }}
                    >
                      <option value="">{list.length === 0 ? 'Nessuno sponsor' : 'Scegli lo sponsor'}</option>
                      {list.map((s) => (
                        <option key={s.id} value={s.id} disabled={s.imageIds.length >= SPONSOR_IMAGES_MAX}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function SponsorRow({
  sponsor,
  index,
  count,
  images,
  busy,
  run,
  onMove,
  onTakeAway,
}: {
  sponsor: Sponsor;
  index: number;
  count: number;
  images: AssetSummary[];
  busy: string | null;
  run: (key: string, action: () => Promise<unknown>) => Promise<boolean>;
  onMove: (from: number, to: number) => void;
  onTakeAway: (assetId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sponsor.name);
  const [website, setWebsite] = useState(sponsor.website ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const key = `sponsor-${sponsor.id}`;
  const full = sponsor.imageIds.length >= SPONSOR_IMAGES_MAX;
  const path = `/api/admin/sponsors/${encodeURIComponent(sponsor.id)}`;

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setProblem(null);
    const body = UpdateSponsorRequestSchema.safeParse({ name, website: websiteOf(website) });
    if (!body.success) {
      setProblem(formProblem(body.error.issues));
      return;
    }
    const ok = await run(key, () => apiRequest(path, SponsorSchema, { method: 'PATCH', body: body.data }));
    if (ok) setEditing(false);
  };

  const upload = (file: File): void => {
    setProblem(null);
    void run(key, async () => {
      const asset = await uploadSponsorImage(file, sponsor.id);
      if (!asset) setProblem(IMAGE_TOO_LARGE);
    });
  };

  return (
    <li className="space-y-3 py-3" aria-label={sponsor.name}>
      {editing ? (
        <form onSubmit={(e) => void save(e)} className="space-y-3" noValidate aria-label={`Modifica ${sponsor.name}`}>
          <SponsorFields name={name} website={website} onName={setName} onWebsite={setWebsite} />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy === key}>
              {busy === key ? 'Salvataggio…' : 'Salva'}
            </Button>
            <Button onClick={() => setEditing(false)} disabled={busy === key}>
              Annulla
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-text">
              {index + 1}. {sponsor.name}
            </p>
            <p className="break-all text-xs text-muted">
              {sponsor.website ?? 'Nessun sito'} · {imageCountText(sponsor.imageIds.length)}
            </p>
          </div>
          <span className="inline-flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={index === 0 || busy !== null}
              onClick={() => onMove(index, index - 1)}
              aria-label={`Sposta su ${sponsor.name}`}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              disabled={index === count - 1 || busy !== null}
              onClick={() => onMove(index, index + 1)}
              aria-label={`Sposta giù ${sponsor.name}`}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setName(sponsor.name);
                setWebsite(sponsor.website ?? '');
                setEditing(true);
              }}
              aria-label={`Modifica ${sponsor.name}`}
            >
              Modifica
            </Button>
            <ConfirmButton
              label="Elimina"
              confirmLabel="Conferma eliminazione"
              busy={busy === `elimina-${sponsor.id}`}
              onConfirm={() => void run(`elimina-${sponsor.id}`, () => apiCommand(path, { method: 'DELETE' }))}
            />
          </span>
        </div>
      )}
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Immagini di ${sponsor.name}`}>
          {images.map((a, i) => (
            <li key={a.id} className="space-y-1 rounded-card border border-border bg-surface p-2">
              <img src={a.url} alt={`${sponsor.name}, immagine ${i + 1}`} className="h-16 w-28 object-contain" />
              <span className="flex flex-wrap gap-1">
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => onTakeAway(a.id)}
                  aria-label={`Togli l’immagine ${i + 1} da ${sponsor.name}`}
                >
                  Togli
                </Button>
                <ConfirmButton
                  label="Elimina"
                  confirmLabel="Conferma"
                  busy={busy === `elimina-immagine-${a.id}`}
                  onConfirm={() =>
                    void run(`elimina-immagine-${a.id}`, () =>
                      apiCommand(`/api/admin/assets/${encodeURIComponent(a.id)}`, { method: 'DELETE' }),
                    )
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <label
        className={`inline-flex min-h-9 items-center rounded-card border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text ${
          full ? 'opacity-60' : 'cursor-pointer hover:bg-surface-2'
        }`}
      >
        {busy === key ? 'Caricamento…' : full ? `Massimo ${SPONSOR_IMAGES_MAX} immagini` : 'Carica immagine'}
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={full || busy !== null}
          aria-label={`Carica un’immagine per ${sponsor.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload(file);
          }}
        />
      </label>
      {problem && <ErrorBox>{problem}</ErrorBox>}
    </li>
  );
}
