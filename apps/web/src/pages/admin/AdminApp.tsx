import type { TenantSummary } from '@sir/shared';
import type { ReactElement } from 'react';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { BrandMark } from '../../components/BrandMark.tsx';
import { MenuButton } from '../../components/MenuButton.tsx';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { Button, Spinner } from '../../components/ui.tsx';
import { useTemplate } from '../../lib/branding.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useViewportWidth } from '../../lib/useLayout.ts';
import { AdminSidebar, Icon, menuGroups } from './AdminSidebar.tsx';
import { AgentsPage } from './AgentsPage.tsx';
import { CalendarPage } from './CalendarPage.tsx';
import { ClubPage } from './ClubPage.tsx';
import { useAuth, useSession } from './auth.tsx';
import { LeaguesPage } from './LeaguesPage.tsx';
import { LiveAdminPage } from './LiveAdminPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { MatchDetailPage } from './MatchDetailPage.tsx';
import { MatchesPage } from './MatchesPage.tsx';
import { ShareLinksPage } from './ShareLinksPage.tsx';
import { LEGACY_PAGES, studioPath } from './studio/model.ts';
import { loadTenants, TenantSelector, TenantsPage } from './TenantsPage.tsx';
import { UsersPage } from './UsersPage.tsx';

/** The «Studio grafico» (editors and previews of the graphics) in its own chunk, loaded when it is opened. */
const StudioPage = lazy(() => import('./studio/StudioPage.tsx').then((m) => ({ default: m.StudioPage })));

/** From this width the side menu is beside the page (below it is a drawer); from the second one it is full at first. */
const PHONE_MAX = 768;
const WIDE_MENU_MIN = 1200;
/** The «Studio grafico» uses the whole width: below this one the menu is reduced to the icons when it opens. */
const STUDIO_WIDE_MENU_MIN = 1600;

/** Role under the email of the account (the names of the «Utenti» page, in lower case). */
const ROLE_TEXT = { superadmin: 'superadmin', admin: 'lettura e scrittura', viewer: 'sola lettura' } as const;

/**
 * Reserved area `/admin/*`: login, then pages by role (a viewer reads matches, calendar, links, club and agents). All of it, login included, in
 * Inter (`sir-admin-font`), whatever the template of the client.
 */
export function AdminApp() {
  return (
    <div className="sir-admin-font contents">
      <AdminGate />
    </div>
  );
}

function AdminGate() {
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
  const groups = menuGroups({ isAdmin, isSuperadmin });
  const adminOnly = (element: ReactElement) => (isAdmin ? element : <Navigate to="/admin/live" replace />);
  const superadminOnly = (element: ReactElement) => (isSuperadmin ? element : <Navigate to="/admin/live" replace />);
  const template = useTemplate();
  const width = useViewportWidth();
  // Phone: the menu is a drawer behind the ☰ button (target of 44 px). Tablet: reduced to the icons at first.
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => width >= PHONE_MAX && width < WIDE_MENU_MIN);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  // From the phone to a wider screen the drawer is no more: closed.
  useEffect(() => {
    if (width >= PHONE_MAX) setMenuOpen(false);
  }, [width]);
  // Entering the Studio (three columns and a big preview) the menu makes room, once: it can be opened again.
  const studio = useLocation().pathname.startsWith('/admin/studio');
  useEffect(() => {
    if (studio && window.innerWidth < STUDIO_WIDE_MENU_MIN) setCollapsed(true);
  }, [studio]);

  const tenant = isSuperadmin ? (
    <TenantSelector tenants={tenants} stacked />
  ) : (
    user.tenant && (
      <p className="truncate text-sm font-semibold text-text" title={user.tenant.name}>
        {user.tenant.name}
      </p>
    )
  );
  const account = (short: boolean) => (
    <div className="space-y-1.5">
      <p className={`min-w-0 text-xs text-muted ${short ? 'md:sr-only' : ''}`}>
        <span className="block truncate text-text" title={user.email}>
          {user.email}
        </span>
        {ROLE_TEXT[user.role]}
      </p>
      <div className={`flex items-center gap-2 ${short ? 'md:flex-col' : ''}`}>
        <Button
          variant="ghost"
          aria-label="Esci"
          title="Esci"
          className={`min-w-0 flex-1 justify-start ${short ? 'md:w-full md:justify-center md:px-0' : ''}`}
          onClick={() => void logout().catch(() => undefined)}
        >
          <Icon name="logout" />
          <span className={short ? 'md:sr-only' : ''}>Esci</span>
        </Button>
        <ThemeToggle />
      </div>
    </div>
  );

  return (
    <div
      className={`sir-admin flex min-h-dvh flex-col md:flex-row ${template.id === 'standard' ? 'border-t-4 border-t-accent' : ''}`}
    >
      <header className="sir-navbar sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface px-3 md:hidden">
        <MenuButton ref={menuButton} open={menuOpen} controls={menuId} onToggle={() => setMenuOpen((o) => !o)} />
        <BrandMark to="/admin/live" />
      </header>
      <AdminSidebar
        id={menuId}
        groups={groups}
        open={menuOpen}
        collapsed={collapsed}
        onClose={closeMenu}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        returnFocus={menuButton}
        tenant={tenant}
        account={account}
      />
      {/* With the drawer open (phone) the page under it is out of reach (`inert`). */}
      <main inert={menuOpen} className="sir-page min-w-0 flex-1 px-3 py-4 sm:px-5 lg:px-8 lg:py-6">
        <div className={`mx-auto w-full ${studio ? '' : 'max-w-7xl'}`}>
          {/* A new client remounts every page: data and the admin WebSocket follow the choice. */}
          <Routes key={user.tenant?.id ?? 'nessun-cliente'}>
            <Route index element={<Navigate to="/admin/live" replace />} />
            <Route path="live" element={<LiveAdminPage />} />
            <Route path="partite" element={<MatchesPage />} />
            <Route path="partite/:id" element={<MatchDetailPage />} />
            {/* Read-only for a viewer: the pages hide or disable their commands (useCanEdit), the server refuses them. */}
            <Route path="calendario" element={<CalendarPage />} />
            <Route path="club" element={<ClubPage />} />
            <Route path="link" element={<ShareLinksPage />} />
            <Route path="agenti" element={<AgentsPage />} />
            <Route path="utenti" element={adminOnly(<UsersPage />)} />
            <Route
              path="studio/:section?"
              element={adminOnly(
                <Suspense fallback={<Spinner label="Caricamento dello Studio grafico…" />}>
                  <StudioPage />
                </Suspense>,
              )}
            />
            {/* The old pages of the graphics are sections of the Studio now. */}
            {Object.entries(LEGACY_PAGES).map(([path, section]) => (
              <Route key={path} path={path} element={<Navigate to={studioPath(section)} replace />} />
            ))}
            <Route path="clienti" element={superadminOnly(<TenantsPage tenants={tenants} />)} />
            <Route path="campionati" element={superadminOnly(<LeaguesPage />)} />
            <Route path="*" element={<Navigate to="/admin/live" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
