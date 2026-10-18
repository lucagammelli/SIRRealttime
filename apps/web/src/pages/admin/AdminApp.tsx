import type { TenantSummary } from '@sir/shared';
import type { ReactElement } from 'react';
import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { BrandMark } from '../../components/BrandMark.tsx';
import { MenuButton } from '../../components/MenuButton.tsx';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { ErrorBoundary } from '../../components/ErrorBoundary.tsx';
import { Button, ErrorBox, Spinner } from '../../components/ui.tsx';
import { useTemplate } from '../../lib/branding.ts';
import { useTitlePrefix } from '../../lib/titlePrefix.ts';
import { useAsync } from '../../lib/useAsync.ts';
import { useViewportWidth } from '../../lib/useLayout.ts';
import { AdminSidebar, Icon, menuGroups } from './AdminSidebar.tsx';
import { AccountPage } from './AccountPage.tsx';
import { AgentsPage } from './AgentsPage.tsx';
import { CalendarPage } from './CalendarPage.tsx';
import { ClubPage } from './ClubPage.tsx';
import { useAuth, useSession } from './auth.tsx';
import { GuidePage } from './guide/GuidePage.tsx';
import { LeaguesPage } from './LeaguesPage.tsx';
import { LiveAdminPage } from './LiveAdminPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { ManagedTenantBar } from './ManagedTenantBar.tsx';
import { MatchDetailPage } from './MatchDetailPage.tsx';
import { MailSettingsPage } from './MailSettingsPage.tsx';
import { MatchesPage } from './MatchesPage.tsx';
import { OnboardingHost } from './onboarding/OnboardingHost.tsx';
import { ShareLinksPage } from './ShareLinksPage.tsx';
import { SimulationPage } from './SimulationPage.tsx';
import { StatsPage } from './StatsPage.tsx';
import { LEGACY_PAGES, studioPath } from './studio/model.ts';
import { loadTenants, TenantsPage, useChooseTenant } from './TenantsPage.tsx';
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

/**
 * Pages by role. A superadmin with no client entered has only its own pages (Clienti, its first page, and
 * Campionati): the pages of a client send it to «Clienti». Inside a client («Entra nel cliente») it has all the
 * pages of an administrator of that client, under a warning bar with «Esci dal cliente» and with `[client]` in front
 * of the title of the tab. The users of a client never see any of this.
 */
function AdminLayout() {
  const { user, isAdmin, isSuperadmin, logout } = useAuth();
  const navigate = useNavigate();
  // The clients (superadmin only), for the «Clienti» page.
  const load = useCallback(
    (signal: AbortSignal): Promise<TenantSummary[]> => (isSuperadmin ? loadTenants(signal) : Promise.resolve([])),
    [isSuperadmin],
  );
  const tenants = useAsync(load);
  /** Client managed by the superadmin (null: none, or not a superadmin). */
  const managed = isSuperadmin ? user.tenant : null;
  const superadminHome = isSuperadmin && !managed;
  const home = superadminHome ? '/admin/clienti' : '/admin/live';
  const groups = menuGroups({ isAdmin, isSuperadmin, inTenant: managed !== null });
  useTitlePrefix(managed?.name ?? null);
  const exit = useChooseTenant();
  const leave = async (): Promise<void> => {
    if (await exit.choose(null)) void navigate('/admin/clienti');
  };
  /** A page with data of a client: not for a superadmin outside any client. */
  const ofTenant = (element: ReactElement) => (superadminHome ? <Navigate to={home} replace /> : element);
  const adminOnly = (element: ReactElement) => ofTenant(isAdmin ? element : <Navigate to={home} replace />);
  const superadminOnly = (element: ReactElement) => (isSuperadmin ? element : <Navigate to={home} replace />);
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
  const { pathname } = useLocation();
  const studio = pathname.startsWith('/admin/studio');
  useEffect(() => {
    if (studio && window.innerWidth < STUDIO_WIDE_MENU_MIN) setCollapsed(true);
  }, [studio]);

  const tenant = user.tenant && (
    <p className="truncate text-sm font-semibold text-text" title={user.tenant.name}>
      {user.tenant.name}
    </p>
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
      className={`sir-admin flex min-h-dvh flex-col ${template.id === 'standard' ? 'border-t-4 border-t-accent' : ''} ${
        managed ? '[--sir-admin-bar:3.5rem] md:[--sir-admin-bar:2.5rem]' : ''
      }`}
    >
      {/* Top: the bar of the managed client (every width) and, on the phone, ☰ and the logo. */}
      <div className="sticky top-0 z-40">
        {managed && <ManagedTenantBar tenant={managed} onLeave={() => void leave()} busy={exit.busy} />}
        <header className="sir-navbar flex items-center gap-3 border-b border-border bg-surface px-3 md:hidden">
          <MenuButton ref={menuButton} open={menuOpen} controls={menuId} onToggle={() => setMenuOpen((o) => !o)} />
          <BrandMark to={home} />
        </header>
      </div>
      <div className="flex min-w-0 flex-1 flex-col md:flex-row">
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
          home={home}
          showCommit={isSuperadmin}
        />
        {/* With the drawer open (phone) the page under it is out of reach (`inert`). */}
        <main inert={menuOpen} className="sir-page min-w-0 flex-1 px-3 py-4 sm:px-5 lg:px-8 lg:py-6">
          <div className={`mx-auto w-full ${studio ? '' : 'max-w-7xl'}`}>
            {exit.error && <ErrorBox>{exit.error}</ErrorBox>}
            {/* First setup of a client not configured yet (admin; the superadmin only gets a link). */}
            {!superadminHome && user.role !== 'viewer' && user.tenant && (
              <OnboardingHost key={`onboarding-${user.tenant.id}`} tenantId={user.tenant.id} role={user.role} />
            )}
            {/* A new client remounts every page: data and the admin WebSocket follow the choice. */}
            <ErrorBoundary resetKey={`${user.tenant?.id ?? ''}:${pathname}`}>
              <Routes key={user.tenant?.id ?? 'nessun-cliente'}>
                <Route index element={<Navigate to={home} replace />} />
                <Route path="live" element={ofTenant(<LiveAdminPage />)} />
                <Route path="partite" element={ofTenant(<MatchesPage />)} />
                <Route path="partite/:id" element={ofTenant(<MatchDetailPage />)} />
                {/* Read-only for a viewer: the pages hide or disable their commands (useCanEdit), the server refuses them. */}
                <Route path="calendario" element={ofTenant(<CalendarPage />)} />
                <Route path="club" element={ofTenant(<ClubPage />)} />
                <Route path="link" element={ofTenant(<ShareLinksPage />)} />
                <Route path="agenti" element={ofTenant(<AgentsPage />)} />
                {/* Read-only: a viewer sees them too. */}
                <Route path="statistiche" element={ofTenant(<StatsPage />)} />
                <Route path="simulazione" element={adminOnly(<SimulationPage />)} />
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
                  <Route key={path} path={path} element={ofTenant(<Navigate to={studioPath(section)} replace />)} />
                ))}
                {/* For every role, a superadmin outside any client too. */}
                <Route path="account" element={<AccountPage />} />
                <Route path="guida" element={<GuidePage />} />
                <Route path="clienti" element={superadminOnly(<TenantsPage tenants={tenants} />)} />
                <Route path="campionati" element={superadminOnly(<LeaguesPage />)} />
                <Route path="posta" element={superadminOnly(<MailSettingsPage />)} />
                <Route path="*" element={<Navigate to={home} replace />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
