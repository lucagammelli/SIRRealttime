import type { GraphicsExport } from '@sir/shared';
import { defaultBranding, defaultIntermissions, defaultLayout, defaultOverlays } from '@sir/shared';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, renderAs } from '../../../test/adminPage.tsx';
import { exportFileName, GraphicsTransfer, readPackage } from './GraphicsTransfer.tsx';

const pkg = (template = 'standard'): GraphicsExport => ({
  format: 'sirrealtime-grafica',
  version: 1,
  exportedAt: '2026-10-18T10:00:00.000Z',
  sourceName: 'SIR VOLLEY',
  branding: { ...defaultBranding(), template: template as GraphicsExport['branding']['template'] },
  layout: defaultLayout(),
  intermissions: defaultIntermissions(),
  overlays: defaultOverlays(),
  images: [],
  sponsors: [],
});

const fileOf = (content: unknown): File =>
  new File([typeof content === 'string' ? content : JSON.stringify(content)], 'g.json', { type: 'application/json' });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('readPackage', () => {
  it('accepts a package and explains what is wrong with a file that is not one', () => {
    expect(readPackage(JSON.stringify(pkg())).problem).toBeNull();
    expect(readPackage('no').problem).toContain('non si riesce a leggerlo');
    expect(readPackage(JSON.stringify({ a: 1 })).problem).toContain('non è una configurazione grafica');
    expect(readPackage(JSON.stringify({ ...pkg(), version: 9 })).problem).toContain('versione');
    expect(readPackage(JSON.stringify({ ...pkg(), images: 3 })).problem).toContain('non è valida');
  });

  it('names the file after the club and the date', () => {
    expect(exportFileName('sir', '2026-10-18T10:00:00.000Z')).toBe('grafica-sir-2026-10-18.json');
  });
});

describe('GraphicsTransfer', () => {
  it('downloads the package', async () => {
    const calls = mockApi(() => ({ body: pkg() }));
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:g');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderAs('admin', <GraphicsTransfer currentTemplate="standard" />);
    fireEvent.click(screen.getByRole('button', { name: 'Esporta configurazione' }));
    await waitFor(() => expect(click).toHaveBeenCalled(), { timeout: 5000 });
    expect(calls[0]?.url).toBe('/api/admin/branding/export');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('shows a summary and asks for confirmation before replacing', async () => {
    const calls = mockApi(() => ({ body: { images: 0, template: 'standard' } }));
    const onImported = vi.fn();
    renderAs('admin', <GraphicsTransfer currentTemplate="standard" onImported={onImported} />);
    fireEvent.change(screen.getByLabelText(/File della configurazione/), { target: { files: [fileOf(pkg())] } });
    expect(await screen.findByText('SIR VOLLEY', {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText(/verrà sostituita/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci la grafica' }));
    await waitFor(() => expect(onImported).toHaveBeenCalled(), { timeout: 5000 });
    expect(calls[0]).toMatchObject({ url: '/api/admin/branding/import', method: 'POST' });
  });

  it('cancels without sending anything, and refuses a wrong file', async () => {
    const calls = mockApi(() => ({ body: {} }));
    renderAs('admin', <GraphicsTransfer currentTemplate="standard" />);
    const input = screen.getByLabelText(/File della configurazione/);
    fireEvent.change(input, { target: { files: [fileOf(pkg())] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Annulla' }, { timeout: 5000 }));
    expect(screen.queryByText('Riepilogo del file')).toBeNull();
    fireEvent.change(input, { target: { files: [fileOf('{"x":1}')] } });
    expect(
      await screen.findByText(/non è una configurazione grafica di SIRRealtime/, {}, { timeout: 5000 }),
    ).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('blocks a custom theme for a client admin, not for the superadmin', async () => {
    mockApi(() => ({ body: {} }));
    renderAs('admin', <GraphicsTransfer currentTemplate="standard" />);
    fireEvent.change(screen.getByLabelText(/File della configurazione/), {
      target: { files: [fileOf(pkg('sir-volley'))] },
    });
    expect(await screen.findByText(/non puoi importarla/, {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sostituisci la grafica' }).disabled).toBe(true);
    cleanup();
    renderAs('superadmin', <GraphicsTransfer currentTemplate="standard" />);
    fireEvent.change(screen.getByLabelText(/File della configurazione/), {
      target: { files: [fileOf(pkg('sir-volley'))] },
    });
    await screen.findByText('Riepilogo del file', {}, { timeout: 5000 });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sostituisci la grafica' }).disabled).toBe(false);
  });

  it('lets the admin of a client that already has the custom theme import it', async () => {
    mockApi(() => ({ body: {} }));
    renderAs('admin', <GraphicsTransfer currentTemplate="sir-volley" />);
    fireEvent.change(screen.getByLabelText(/File della configurazione/), {
      target: { files: [fileOf(pkg('sir-volley'))] },
    });
    await screen.findByText('Riepilogo del file', {}, { timeout: 5000 });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Sostituisci la grafica' }).disabled).toBe(false);
  });
});
