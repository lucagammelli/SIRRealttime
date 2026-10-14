import type { ReactElement } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router';
import { StatusScreen } from '../../components/StatusScreen.tsx';
import { ThemeToggle } from '../../components/ThemeToggle.tsx';
import { Button, Spinner } from '../../components/ui.tsx';
import { AgentsPage } from './AgentsPage.tsx';
import { useAuth, useSession } from './auth.tsx';
import { LiveAdminPage } from './LiveAdminPage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { MatchDetailPage } from './MatchDetailPage.tsx';
import { MatchesPage } from './MatchesPage.tsx';
import { ShareLinksPage } from './ShareLinksPage.tsx';
import { UsersPage } from './UsersPage.tsx';

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
  const { user, isAdmin, logout } = useAuth();
  const links = [
    { to: '/admin/live', label: 'Partita live' },
    { to: '/admin/partite', label: 'Partite' },
    ...(isAdmin
      ? [
          { to: '/admin/link', label: 'Link pubblici' },
          { to: '/admin/agenti', label: 'Agenti' },
          { to: '/admin/utenti', label: 'Utenti' },
        ]
      : []),
  ];
  const adminOnly = (element: ReactElement) => (isAdmin ? element : <Navigate to="/admin/live" replace />);
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:px-5">
          <p className="font-display text-lg font-bold uppercase tracking-widest text-muted">
            SIR<span className="text-home">Realtime</span>
          </p>
          <nav
            aria-label="Area riservata"
            className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
          >
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-card px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-home-soft text-home' : 'text-muted hover:text-text'}`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-xs text-muted md:inline">
              {user.email} · {user.role === 'admin' ? 'amministratore' : 'sola lettura'}
            </span>
            <Button variant="ghost" onClick={() => void logout().catch(() => undefined)}>
              Esci
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-5">
        <Routes>
          <Route index element={<Navigate to="/admin/live" replace />} />
          <Route path="live" element={<LiveAdminPage />} />
          <Route path="partite" element={<MatchesPage />} />
          <Route path="partite/:id" element={<MatchDetailPage />} />
          <Route path="link" element={adminOnly(<ShareLinksPage />)} />
          <Route path="agenti" element={adminOnly(<AgentsPage />)} />
          <Route path="utenti" element={adminOnly(<UsersPage />)} />
          <Route path="*" element={<Navigate to="/admin/live" replace />} />
        </Routes>
      </main>
    </div>
  );
}
