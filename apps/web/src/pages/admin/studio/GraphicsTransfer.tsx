import type { GraphicsExport, TemplateId } from '@sir/shared';
import {
  GRAPHICS_EXPORT_FORMAT,
  GRAPHICS_EXPORT_VERSION,
  GRAPHICS_IMPORT_BODY_LIMIT,
  GraphicsExportSchema,
  GraphicsImportResponseSchema,
  templateChoices,
  templateOf,
} from '@sir/shared';
import type { ChangeEvent } from 'react';
import { useState } from 'react';
import { Button, ErrorBox } from '../../../components/ui.tsx';
import { apiRequest } from '../../../lib/api.ts';
import { formatDateTime } from '../../../lib/format.ts';
import { useApiError, useAuth } from '../auth.tsx';
import { SettingsCard } from './StudioUi.tsx';

/** Text of a file chosen by the user (FileReader: also where Blob.text is missing). */
function fileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('file not read'));
    reader.onerror = () => reject(reader.error ?? new Error('file not read'));
    reader.readAsText(file);
  });
}

/** Pure: name of the downloaded file, `grafica-<slug>-<data>.json`. */
export function exportFileName(slug: string, iso: string): string {
  return `grafica-${slug}-${iso.slice(0, 10)}.json`;
}

/** Pure: reads the text of a chosen file as a package; the second element is the message when it is not one. */
export function readPackage(text: string): { pkg: GraphicsExport; problem: null } | { pkg: null; problem: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { pkg: null, problem: 'Il file non è una configurazione grafica: non si riesce a leggerlo.' };
  }
  const record = json !== null && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  if (record.format !== GRAPHICS_EXPORT_FORMAT)
    return { pkg: null, problem: 'Il file non è una configurazione grafica di SIRRealtime.' };
  if (record.version !== GRAPHICS_EXPORT_VERSION)
    return {
      pkg: null,
      problem: 'Questa versione della configurazione non è supportata: esportala di nuovo da un portale aggiornato.',
    };
  const parsed = GraphicsExportSchema.safeParse(json);
  if (!parsed.success)
    return { pkg: null, problem: 'Il file è danneggiato o incompleto: la configurazione non è valida.' };
  return { pkg: parsed.data, problem: null };
}

/**
 * Tab «Esporta / Importa»: downloads the whole graphics of the client (colours, logos, page, pauses, alerts and their
 * images) as a JSON file, and loads one, after a summary and a confirmation, replacing the current graphics.
 */
export function GraphicsTransfer({
  currentTemplate,
  onImported,
}: {
  /** Saved template of the client: a client that already has a custom theme can import a package with it. */
  currentTemplate: TemplateId;
  onImported?: () => void;
}) {
  const errorMessage = useApiError();
  const { user, isSuperadmin } = useAuth();
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pkg, setPkg] = useState<GraphicsExport | null>(null);

  const exportNow = async (): Promise<void> => {
    setError(null);
    setDone(null);
    setBusy('export');
    try {
      const data = await apiRequest('/api/admin/branding/export', GraphicsExportSchema);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFileName(user.tenant?.slug ?? 'cliente', data.exportedAt);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setDone('Configurazione esportata: il file è nei download.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const choose = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setError(null);
    setDone(null);
    setPkg(null);
    if (!file) return;
    if (file.size > GRAPHICS_IMPORT_BODY_LIMIT) {
      setError('Il file è troppo grande.');
      return;
    }
    try {
      const read = readPackage(await fileText(file));
      if (read.problem !== null) setError(read.problem);
      else setPkg(read.pkg);
    } catch {
      setError('Non riesco a leggere il file: riprova.');
    }
  };

  const importNow = async (): Promise<void> => {
    if (!pkg) return;
    setError(null);
    setBusy('import');
    try {
      await apiRequest('/api/admin/branding/import', GraphicsImportResponseSchema, { method: 'POST', body: pkg });
      setPkg(null);
      setDone('Configurazione importata: la pagina pubblica usa già la nuova grafica.');
      (onImported ?? (() => window.location.reload()))();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const customBlocked =
    pkg !== null &&
    !templateChoices({ current: currentTemplate, superadmin: isSuperadmin }).includes(pkg.branding.template);

  return (
    <div className="space-y-3">
      <SettingsCard title="Esporta">
        <p className="text-xs text-muted">
          Scarica un file con tutta la grafica del club: colori, loghi, pagina live, pause e avvisi, con le immagini
          usate. Non contiene partite, utenti né link.
        </p>
        <div className="pt-2">
          <Button variant="primary" disabled={busy !== null} onClick={() => void exportNow()}>
            {busy === 'export' ? 'Esportazione…' : 'Esporta configurazione'}
          </Button>
        </div>
      </SettingsCard>
      <SettingsCard title="Importa">
        <p className="text-xs text-muted">
          Carica un file esportato da un altro portale. Prima di cambiare qualcosa vedrai un riepilogo e ti chiederemo
          conferma.
        </p>
        <div className="pt-2">
          <label className="block text-sm text-text">
            File della configurazione (.json)
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy !== null}
              onChange={(e) => void choose(e)}
              className="mt-1 block w-full text-sm"
            />
          </label>
        </div>
        {pkg && (
          <div
            className="mt-3 space-y-2 rounded-panel border border-border bg-bg p-3"
            role="group"
            aria-label="Riepilogo"
          >
            <h4 className="text-sm font-semibold text-text">Riepilogo del file</h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Club di origine</dt>
              <dd className="text-text">{pkg.sourceName}</dd>
              <dt className="text-muted">Esportata il</dt>
              <dd className="text-text">{formatDateTime(pkg.exportedAt)}</dd>
              <dt className="text-muted">Immagini</dt>
              <dd className="text-text">{pkg.images.length}</dd>
              <dt className="text-muted">Modello grafico</dt>
              <dd className="text-text">{templateOf(pkg.branding.template).label}</dd>
            </dl>
            {customBlocked ? (
              <ErrorBox>
                Questa configurazione usa un tema personalizzato, che può essere assegnato solo dal superadmin: non puoi
                importarla.
              </ErrorBox>
            ) : (
              <p className="text-sm text-text" role="alert">
                Attenzione: la grafica attuale (colori, loghi, pagina live, pause e avvisi) verrà sostituita. Le
                modifiche non salvate nello Studio andranno perse.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={busy !== null || customBlocked} onClick={() => void importNow()}>
                {busy === 'import' ? 'Importazione…' : 'Sostituisci la grafica'}
              </Button>
              <Button disabled={busy !== null} onClick={() => setPkg(null)}>
                Annulla
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>
      {done && (
        <p className="text-sm text-text" role="status">
          {done}
        </p>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
