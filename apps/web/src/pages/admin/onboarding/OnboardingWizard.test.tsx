import type { ClubLeagueStatus, ClubResponse, MeResponse, TenantBranding } from '@sir/shared';
import { defaultBranding, defaultIntermissions, defaultLayout, defaultOverlays } from '@sir/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '../AdminApp.tsx';
import { reachedKey, skippedKey } from './model.ts';
import { DOWNLOAD_POLL } from './steps.tsx';

// The real preview of the public page is tested with the Studio; the QR needs a canvas.
vi.mock('./OnboardingPreview.tsx', () => ({
  OnboardingPreview: ({ branding }: { branding: TenantBranding }) => (
    <div data-testid="anteprima" data-template={branding.template} />
  ),
}));
vi.mock('../../../qr/ShareQr.tsx', () => ({
  ShareQr: ({ url }: { url: string }) => <div role="img" aria-label={`QR ${url}`} />,
}));

const USER_ID = '6f1f7d36-8a43-4c50-9f0b-0f3c1d2b4a11';
const TENANT = { id: '0c2a4b6d-8e0f-4a1b-9c3d-5e7f9a1b3c5d', slug: 'sir', name: 'Sir Safety' };
const LEAGUE = '3f1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7c';
const PERUGIA = '9a1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7d';
const CUNEO = '8b1c2b9e-7a4d-4c8e-9b1a-2d3e4f5a6b7e';
const LOGO = '8a2d4e6f-1b3c-4d5e-8f7a-9b0c1d2e3f4a';

class SilentSocket {
  onopen = null;
  onmessage = null;
  onclose = null;
  onerror = null;
  close(): void {}
}

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const option = {
  id: LEAGUE,
  externalId: 999,
  season: 2026,
  name: 'Regular Season SuperLega',
  teamCount: 2,
  sync: { status: 'ok' as const, message: null, at: null, lastSuccessAt: '2026-10-16T10:00:00.000Z', running: false },
};
const teams = [
  { id: CUNEO, name: "Acqua Sant'Anna Cuneo", city: null, logoUrl: '/api/public/team-logos/c' },
  { id: PERUGIA, name: 'Sir Susa Scai Perugia', city: 'Perugia (PG)', logoUrl: '/api/public/team-logos/p' },
];

/** Fake server of one client; `onboarded` is the flag of the database. */
function mockServer(
  role: MeResponse['role'],
  opts: {
    onboarded?: boolean;
    club?: Partial<ClubResponse>;
    outside?: boolean;
    /** Answers before the default ones (null: the default one answers). */
    first?: (url: string, method: string) => Response | null;
  } = {},
) {
  const calls: Call[] = [];
  let onboarded = opts.onboarded ?? false;
  let club: ClubResponse = {
    name: 'Sir Safety',
    logoUrl: null,
    displayName: null,
    logoMark: null,
    ourTeam: { code: null, name: null },
    profile: {
      series: null,
      gender: null,
      seriesId: null,
      leagueId: null,
      leagueIds: [],
      newSeason: false,
      coverage: 'homeAndAway',
      teamLogos: 'all',
    },
    leagues: [],
    available: [],
    ...opts.club,
  };
  let branding: TenantBranding = defaultBranding();
  let intermissions = defaultIntermissions();
  let overlays = defaultOverlays();
  let leagueRead = 0;
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const status = (state: ClubLeagueStatus['state']): ClubLeagueStatus => ({
    state,
    message: null,
    gender: 'M',
    series: 'superlega',
    leagueId: LEAGUE,
    leagueName: 'Regular Season SuperLega',
    season: 2026,
    teams: state === 'ready' ? teams.map((t) => ({ ...t, leagueId: LEAGUE })) : [],
    teamId: club.leagues[0]?.team?.id ?? null,
  });
  vi.stubGlobal('WebSocket', SilentSocket);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      const early = opts.first?.(url, method);
      if (early) return Promise.resolve(early);
      const tenant = role === 'superadmin' && opts.outside ? null : TENANT;
      if (url === '/api/auth/me') return json({ id: USER_ID, email: 'a@b.it', role, tenant });
      if (url === '/api/admin/onboarding')
        return json({ completed: onboarded, completedAt: onboarded ? '2026-10-17T10:00:00.000Z' : null });
      if (url === '/api/admin/onboarding/complete') {
        onboarded = true;
        return json({ completed: true, completedAt: '2026-10-17T10:00:00.000Z' });
      }
      if (url === '/api/admin/club' && method === 'GET') return json(club);
      if (url === '/api/admin/club' && method === 'PUT') {
        const choice = (body as { leagues: { leagueId: string; teamId: string | null }[] }).leagues[0];
        const team = teams.find((t) => t.id === choice?.teamId) ?? null;
        club = {
          ...club,
          ourTeam: { code: null, name: 'Perugia' },
          leagues: choice ? [{ league: option, team }] : [],
        };
        return json(club);
      }
      if (url === '/api/admin/club/profile') {
        const b = body as { displayName: string | null; logoMark: string | null; ourTeam: ClubResponse['ourTeam'] };
        club = { ...club, displayName: b.displayName, logoMark: b.logoMark, ourTeam: b.ourTeam };
        return json(club);
      }
      if (url === '/api/admin/club/league' && method === 'POST') {
        club = {
          ...club,
          profile: { ...club.profile, gender: 'M', seriesId: 'superlega', series: 'SuperLega', leagueId: LEAGUE },
          leagues: [{ league: option, team: null }],
          available: [option],
        };
        leagueRead = 0;
        return json(status('downloading'), 202);
      }
      if (url === '/api/admin/club/league') return json(status(leagueRead++ < 1 ? 'downloading' : 'ready'));
      if (url === '/api/admin/branding') {
        if (method === 'PUT') branding = { ...defaultBranding(), ...(body as Partial<TenantBranding>) };
        return json({ tenantName: 'Sir Safety', branding });
      }
      if (url === '/api/admin/assets' && method === 'GET')
        return json({ assets: [], usedBytes: 0, quotaBytes: 1000000 });
      if (url === '/api/public/tenant') return json({ error: 'Non trovato' }, 404);
      if (url === '/api/admin/layout') return json({ tenantName: 'Sir Safety', layout: defaultLayout() });
      if (url === '/api/admin/intermissions') {
        if (method === 'PUT') intermissions = body as typeof intermissions;
        return json({ tenantName: 'Sir Safety', intermissions });
      }
      if (url === '/api/admin/overlays') {
        if (method === 'PUT') overlays = body as typeof overlays;
        return json({ tenantName: 'Sir Safety', overlays });
      }
      if (url === '/api/admin/assets' && method === 'POST')
        return json(
          {
            id: LOGO,
            kind: 'logo',
            mime: 'image/png',
            width: 64,
            height: 64,
            bytes: 10,
            sha256: 'a'.repeat(64),
            createdAt: '2026-10-17T10:00:00.000Z',
            url: `/api/public/assets/${LOGO}`,
          },
          201,
        );
      if (url === '/api/admin/share-tokens' && method === 'GET') return json([]);
      if (url === '/api/admin/share-tokens' && method === 'POST')
        return json(
          {
            id: '1b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d',
            label: 'Canale del club',
            matchId: null,
            clientFixtureId: null,
            expiresAt: null,
            revoked: false,
            createdAt: '2026-10-17T10:00:00.000Z',
            shortCode: 'K7M2QX9P',
            shortUrl: 'https://sir.test/l/K7M2QX9P',
            token: 'x'.repeat(43),
            url: 'https://sir.test/live/xxxx',
          },
          201,
        );
      if (url === '/api/admin/calendar') return json({ fixtures: [], pending: [] });
      return json([]);
    }),
  );
  return { calls, onboarded: () => onboarded };
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

const renderAdmin = (path = '/admin/live') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/admin/*" element={<AdminApp />} />
      </Routes>
    </MemoryRouter>,
  );

const wizard = () => screen.findByRole('dialog');
const next = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Avanti' }));
const posted = (calls: Call[], url: string, method = 'PUT') =>
  calls.filter((c) => c.url === url && c.method === method);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  window.sessionStorage.clear();
  DOWNLOAD_POLL.ms = 5;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guided first setup: who sees it', () => {
  it('opens by itself to an admin of a client not configured yet', async () => {
    mockServer('admin');
    renderAdmin();
    const dialog = await wizard();
    expect(await within(dialog).findByText('Passo 1 di 5')).toBeTruthy();
    expect(await within(dialog).findByRole('heading', { name: 'Il logo' })).toBeTruthy();
  });

  it('does not open for a viewer, nor show the notice', async () => {
    mockServer('viewer');
    renderAdmin();
    await screen.findByRole('navigation', { name: 'Area riservata' });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Configurazione da completare')).toBeNull();
  });

  it('does not open for the superadmin inside a client: only a link opens it', async () => {
    mockServer('superadmin');
    renderAdmin();
    const open = await screen.findByRole('button', { name: 'Apri la configurazione guidata' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Riprendi' })).toBeNull();
    fireEvent.click(open);
    expect(await wizard()).toBeTruthy();
  });

  it('does not open for the superadmin outside any client', async () => {
    mockServer('superadmin', { outside: true });
    renderAdmin('/admin/clienti');
    await screen.findByRole('navigation', { name: 'Area riservata' });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Configurazione da completare')).toBeNull();
  });

  it('does not open, and shows no notice, once the client is configured', async () => {
    mockServer('admin', { onboarded: true });
    renderAdmin();
    await screen.findByRole('navigation', { name: 'Area riservata' });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Configurazione da completare')).toBeNull();
  });
});

describe('guided first setup: steps', () => {
  it('saves every step, leads to the summary and «Fine» marks the client as configured', async () => {
    const { calls, onboarded } = mockServer('admin');
    renderAdmin();
    let dialog = await wizard();

    // 1. Logo: saved as soon as it is uploaded.
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });
    fireEvent.change((await within(dialog).findAllByLabelText('Carica immagine'))[0] as HTMLElement, {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(posted(calls, '/api/admin/club/profile')[0]?.body).toMatchObject({ logoMark: LOGO, displayName: null }),
    );
    next(dialog);

    // 2. Squadra: male only, series from the list, download, team with its logo, name.
    expect(await within(dialog).findByRole('heading', { name: 'La squadra' })).toBeTruthy();
    expect(
      within(dialog)
        .getByRole('radio', { name: /Femminile/ })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(within(dialog).getByText('Presto disponibile')).toBeTruthy();
    const series = within(dialog).getByRole('combobox', { name: /In che serie gioca/ });
    expect(
      within(series)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Scegli la serie', 'SuperLega', 'Serie A2', 'Serie A3']);
    fireEvent.change(series, { target: { value: 'superlega' } });
    expect(await within(dialog).findByText('Sto scaricando il calendario…')).toBeTruthy();
    expect(posted(calls, '/api/admin/club/league', 'POST')[0]?.body).toEqual({ gender: 'M', series: 'superlega' });
    const perugia = await within(dialog).findByRole('radio', { name: /Sir Susa Scai Perugia/ });
    expect(within(dialog).getAllByRole('radio', { name: /Cuneo|Perugia/ })).toHaveLength(2);
    fireEvent.click(perugia);
    await waitFor(() =>
      expect(posted(calls, '/api/admin/club')[0]?.body).toEqual({ leagues: [{ leagueId: LEAGUE, teamId: PERUGIA }] }),
    );
    await waitFor(() =>
      expect(within(dialog).getByLabelText<HTMLInputElement>(/Nome della squadra/).value).toBe('Sir Susa Scai Perugia'),
    );
    next(dialog);

    // 3. Colori: a template, shown in the preview, saved with «Avanti».
    expect(await within(dialog).findByRole('heading', { name: 'I colori' })).toBeTruthy();
    const models = within(dialog).getAllByRole('radio', {
      name: /Standard|Chiaro e pulito|Scuro sportivo|Alto contrasto/,
    });
    expect(models).toHaveLength(4);
    // The custom theme of a club is not part of the procedure.
    expect(within(dialog).queryByRole('radio', { name: /SIR VOLLEY/i })).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Scuro sportivo/i }));
    expect(screen.getByTestId('anteprima').dataset.template).toBe('notte');
    next(dialog);
    await waitFor(() => expect(posted(calls, '/api/admin/branding')[0]?.body).toMatchObject({ template: 'notte' }));

    // 4. Grafica: a ready-made model for pauses and notices.
    expect(await within(dialog).findByRole('heading', { name: 'La grafica' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Sponsor in evidenza/ }));
    next(dialog);
    await waitFor(() => expect(posted(calls, '/api/admin/intermissions')).toHaveLength(1));
    expect(posted(calls, '/api/admin/overlays')).toHaveLength(1);

    // 5. Fatto: summary, channel link with its QR, agent, Studio; «Fine».
    expect(await within(dialog).findByRole('heading', { name: 'Fatto' })).toBeTruthy();
    expect(await within(dialog).findByRole('img', { name: 'QR https://sir.test/l/K7M2QX9P' })).toBeTruthy();
    expect(posted(calls, '/api/admin/share-tokens', 'POST')[0]?.body).toMatchObject({
      matchId: null,
      label: 'Canale del club',
    });
    expect(within(dialog).getByRole('link', { name: 'Scarica l’agente' }).getAttribute('href')).toBe(
      '/api/admin/agent/download',
    );
    expect(within(dialog).getByRole('link', { name: 'Apri lo Studio grafico' }).getAttribute('href')).toBe(
      '/admin/studio/colori',
    );
    expect(await within(dialog).findByText(/Nessuna partita in calendario/)).toBeTruthy();
    expect(onboarded()).toBe(false);
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fine' }));
    await waitFor(() => expect(onboarded()).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Configurazione da completare')).toBeNull();
  });

  it('a team that is not in the list: the name is written by hand and saved with «nostra squadra»', async () => {
    const { calls } = mockServer('admin', { club: { logoMark: LOGO } });
    renderAdmin();
    const dialog = await wizard();
    fireEvent.change(await within(dialog).findByRole('combobox', { name: /In che serie gioca/ }), {
      target: { value: 'superlega' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'La mia squadra non è nell’elenco' }));
    expect(within(dialog).queryByRole('radiogroup', { name: 'Squadra del club' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Nome della squadra/), { target: { value: 'Volley Valle' } });
    next(dialog);
    await waitFor(() =>
      expect(posted(calls, '/api/admin/club/profile')[0]?.body).toMatchObject({
        displayName: 'Volley Valle',
        ourTeam: { code: null, name: 'Valle' },
      }),
    );
    expect(await within(dialog).findByRole('heading', { name: 'I colori' })).toBeTruthy();
  });

  it('shows the error of a series the site cannot give', async () => {
    mockServer('admin', {
      club: { logoMark: LOGO },
      first: (url, method) =>
        url === '/api/admin/club/league' && method === 'POST'
          ? new Response(JSON.stringify({ error: 'La pagina del calendario della Lega è cambiata' }), { status: 502 })
          : null,
    });
    renderAdmin();
    const dialog = await wizard();
    fireEvent.change(await within(dialog).findByRole('combobox', { name: /In che serie gioca/ }), {
      target: { value: 'a2' },
    });
    expect(await within(dialog).findByText(/La pagina del calendario della Lega è cambiata/)).toBeTruthy();
    expect(within(dialog).queryByText('Sto scaricando il calendario…')).toBeNull();
  });
});

describe('guided first setup: close and resume', () => {
  it('«Salta per ora» closes it, the notice stays, it does not reopen by itself and «Riprendi» resumes from the right step', async () => {
    const { onboarded } = mockServer('admin', { club: { logoMark: LOGO } });
    const first = renderAdmin();
    const dialog = await wizard();
    // The logo is saved: the procedure resumes from the squad.
    expect(await within(dialog).findByRole('heading', { name: 'La squadra' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salta per ora' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.sessionStorage.getItem(skippedKey(TENANT.id))).toBe('1');
    expect(screen.getByRole('region', { name: 'Configurazione da completare' })).toBeTruthy();
    expect(onboarded()).toBe(false);

    // A reload in the same session: no dialog by itself, the notice is there.
    first.unmount();
    renderAdmin();
    const notice = await screen.findByRole('region', { name: 'Configurazione da completare' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(notice).getByRole('button', { name: 'Riprendi' }));
    expect(within(await wizard()).getByRole('heading', { name: 'La squadra' })).toBeTruthy();
  });

  it('Esc closes it like «Salta per ora»', async () => {
    mockServer('admin');
    renderAdmin();
    await within(await wizard()).findByRole('heading', { name: 'Il logo' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Riprendi' })).toBeTruthy();
  });

  it('resumes at the step reached, even when its data are not saved yet', async () => {
    mockServer('admin', { club: { logoMark: LOGO, displayName: 'Sir' } });
    renderAdmin();
    const dialog = await wizard();
    expect(await within(dialog).findByRole('heading', { name: 'I colori' })).toBeTruthy();
    next(dialog);
    expect(await within(dialog).findByRole('heading', { name: 'La grafica' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salta per ora' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riprendi' }));
    expect(within(await wizard()).getByRole('heading', { name: 'La grafica' })).toBeTruthy();
  });
});

describe('guided first setup: last step', () => {
  const lastStep = async (club: Partial<ClubResponse> = { logoMark: LOGO, displayName: 'Sir' }) => {
    const server = mockServer('admin', { club });
    window.sessionStorage.setItem(reachedKey(TENANT.id), 'fatto');
    renderAdmin();
    const dialog = await wizard();
    await within(dialog).findByRole('heading', { name: 'Fatto' });
    return { ...server, dialog };
  };
  const where = (): string => screen.getByTestId('where').textContent ?? '';

  it('«Apri lo Studio grafico» goes to the colours of the Studio in the same tab and shows it', async () => {
    const { dialog } = await lastStep();
    const link = within(dialog).getByRole('link', { name: 'Apri lo Studio grafico' });
    expect(link.getAttribute('href')).toBe('/admin/studio/colori');
    // Same tab: no target, no download, and not an external address.
    expect(link.getAttribute('target')).toBeNull();
    expect(link.hasAttribute('download')).toBe(false);
    fireEvent.click(link);
    await waitFor(() => expect(where()).toBe('/admin/studio/colori'));
    expect(screen.queryByRole('dialog')).toBeNull();
    // The Studio itself is on screen (not a blank page) and the notice of the procedure is there only once.
    expect(await screen.findByTestId('studio', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByRole('region', { name: 'Configurazione da completare' })).toHaveLength(1);
    // React complained about two children with the same key (the cause of the blank page): never again.
    const keyWarnings = vi.mocked(console.error).mock.calls.filter((c) => /same key/.test(String(c[0])));
    expect(keyWarnings).toHaveLength(0);
  }, 20000);

  it('has the agent download, the channel link with its QR, and «Riprendi» that leads back to the last step', async () => {
    const { dialog } = await lastStep();
    const agent = within(dialog).getByRole('link', { name: 'Scarica l’agente' });
    expect(agent.getAttribute('href')).toBe('/api/admin/agent/download');
    expect(agent.hasAttribute('download')).toBe(true);
    expect(await within(dialog).findByText('https://sir.test/l/K7M2QX9P')).toBeTruthy();
    expect(await within(dialog).findByRole('img', { name: 'QR https://sir.test/l/K7M2QX9P' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salta per ora' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riprendi' }));
    expect(within(await wizard()).getByRole('heading', { name: 'Fatto' })).toBeTruthy();
  });
});
