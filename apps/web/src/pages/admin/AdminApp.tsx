import type { TenantSummary } from '@sir/shared';
import type { ReactElement } from 'react';
import { useCallback, useId, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { BrandMark } from '../../components/BrandMark.tsx';
import { MenuButton } from '../../components/MenuButton.tsx';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { TemplateFooter } from '../../components/TemplateFooter.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { Button, Spinner } from '../../components/ui.tsx';
import { useTemplate } from '../../lib/branding.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { AgentsPage } from './AgentsPage.tsx';
import { BrandingPage } from './BrandingPage.tsx';
import { useAuth, useSession } from './auth.tsx';
import { IntermissionsPage } from './IntermissionsPage.tsx';
import { LayoutPage } from './LayoutPage.tsx';
import { LiveAdminPage } from './LiveAdminPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { MatchDetailPage } from './MatchDetailPage.tsx';
import { MatchesPage } from './MatchesPage.tsx';
import { OverlaysPage } from './OverlaysPage.tsx';
import { ShareLinksPage } from './ShareLinksPage.tsx';
import { loadTenants, TenantSelector, TenantsPage } from './TenantsPage.tsx';
import { UsersPage } from './UsersPage.tsx';

const ROLE_TEXT = { superadmin: 'superadmin', admin: 'amministratore', viewer: 'sola lettura' } as const;

/** Reserved area `/admin/*`: login, then pages by role (a viewer sees only the matches). */
export function AdminApp() {
  const { session, setUser, retry, provide } = useSession();
  if (session.kind === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner label="Verifica della sessione…" />
      </div>
    );
  }
  if (session.kind === 'error') {
    return (
      <StatusScreen
        title="Area riservata non disponibile"
        tone="error"
        action={<Button onClick={retry}>Riprova</Button>}
      >
        {session.message}
      </StatusScreen>
    );
  }
  if (session.kind === 'anonymous') return <LoginPage onLogin={setUser} notice={session.notice} />;
  return provide(<AdminLayout />);
}

function AdminLayout() {
  const { user, isAdmin, isSuperadmin, logout } = useAuth();
  // The clients (superadmin only), shared by the selector and the «Clienti» page.
  const load = useCallback(
    (signal: AbortSignal): Promise<TenantSummary[]> => (isSuperadmin ? loadTenants(signal) : Promise.resolve([])),
    [isSuperadmin],
  );
  const tenants = useAsync(load);
  const links = [
    { to: '/admin/live', label: 'Partita live' },
    { to: '/admin/partite', label: 'Partite' },
    ...(isAdmin
      ? [
          { to: '/admin/link', label: 'Link pubblici' },
          { to: '/admin/agenti', label: 'Agenti' },
          { to: '/admin/utenti', label: 'Utenti' },
          { to: '/admin/grafica', label: 'Grafica' },
          { to: '/admin/pagina', label: 'Pagina pubblica' },
          { to: '/admin/pause', label: 'Pause e sponsor' },
          { to: '/admin/avvisi', label: 'Avvisi' },
        ]
      : []),
    ...(isSuperadmin ? [{ to: '/admin/clienti', label: 'Clienti' }] : []),
  ];
  const adminOnly = (element: ReactElement) => (isAdmin ? element : <Navigate to="/admin/live" replace />);
  const superadminOnly = (element: ReactElement) => (isSuperadmin ? element : <Navigate to="/admin/live" replace />);
  const template = useTemplate();
  // Phone: the menu is behind the «Menu» button (target of 44 px); from 768 px it is always on one row.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={`sir-navbar border-b border-border bg-surface ${template.id === 'standard' ? 'border-t-4 border-t-accent' : ''}`}
      >
        <div className="sir-page mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
          <BrandMark to="/admin/live" />
          <nav
            id={menuId}
            aria-label="Area riservata"
            className={`order-3 -mx-1 w-full flex-col gap-1 md:order-none md:flex md:w-auto md:flex-1 md:flex-row md:overflow-x-auto ${
              menuOpen ? 'flex' : 'hidden'
            }`}
          >
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex min-h-11 items-center whitespace-nowrap rounded-button px-3 py-1.5 text-sm font-medium md:min-h-9 ${isActive ? 'bg-nav-active text-on-nav-active' : 'text-muted hover:bg-hover hover:text-text'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {isSuperadmin ? (
              <TenantSelector tenants={tenants} />
            ) : (
              user.tenant && <span className="text-xs font-medium text-text">{user.tenant.name}</span>
            )}
            <span className="hidden text-xs text-muted md:inline">
              {user.email} · {ROLE_TEXT[user.role]}
            </span>
            <Button variant="ghost" onClick={() => void logout().catch(() => undefined)}>
              Esci
            </Button>
            <ThemeToggle />
            <MenuButton
              open={menuOpen}
              controls={menuId}
              onToggle={() => setMenuOpen((o) => !o)}
              className="md:hidden"
            />
          </div>
        </div>
      </header>
      <main className="sir-page mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5">
        {/* A new client remounts every page: data and the admin WebSocket follow the choice. */}
        <Routes key={user.tenant?.id ?? 'nessun-cliente'}>
          <Route index element={<Navigate to="/admin/live" replace />} />
          <Route path="live" element={<LiveAdminPage />} />
          <Route path="partite" element={<MatchesPage />} />
          <Route path="partite/:id" element={<MatchDetailPage />} />
          <Route path="link" element={adminOnly(<ShareLinksPage />)} />
          <Route path="agenti" element={adminOnly(<AgentsPage />)} />
          <Route path="utenti" element={adminOnly(<UsersPage />)} />
          <Route path="grafica" element={adminOnly(<BrandingPage />)} />
          <Route path="pagina" element={adminOnly(<LayoutPage />)} />
          <Route path="pause" element={adminOnly(<IntermissionsPage />)} />
          <Route path="avvisi" element={adminOnly(<OverlaysPage />)} />
          <Route path="clienti" element={superadminOnly(<TenantsPage tenants={tenants} />)} />
          <Route path="*" element={<Navigate to="/admin/live" replace />} />
        </Routes>
      </main>
      <TemplateFooter className="sir-page mx-auto w-full max-w-7xl" />
    </div>
  );
}
