import type { ReactNode, RefObject } from 'react';
import { useEffect, useId, useRef } from 'react';
import { NavLink } from 'react-router';
import { AdminBrand } from './AdminBrand.tsx';
import { APP_COMMIT, APP_VERSION, versionLabel } from '../../lib/version.ts';

/** Icons of the side menu: simple inline SVG strokes (24 × 24), no icon library. */
const ICONS = {
  live: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4',
  matches: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2',
  club: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4',
  simulation: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10 8.5v7l5.5-3.5z',
  links: 'M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  branding: 'M12 3a9 9 0 0 0 0 18c1.2 0 1.6-.9 1.4-1.8-.3-1.1.4-2.2 1.6-2.2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z',
  agents: 'M4 5h16v11H4zM9 20h6M12 16v4',
  sponsors: 'M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.4l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z',
  users: 'M16 20a4 4 0 0 0-8 0M12 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  tenants: 'M4 20V7l8-4 8 4v13M9 20v-5h6v5M8.5 9.5h.01M12 9.5h.01M15.5 9.5h.01',
  leagues: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  systemLogos: 'M3 6h18v12H3zM7 10h.01M21 15l-5-5-8 8',
  stats: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  collapse: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6L6 18',
  expand: 'M9 6l6 6-6 6',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01',
  account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'size-5' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

export interface MenuItem {
  to: string;
  label: string;
  icon: IconName;
}
export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

/** «Il mio account» and «Guida»: for every role, inside a client or not (they depend on no client). */
export const ACCOUNT_GROUP: MenuGroup = {
  label: 'Account e aiuto',
  items: [
    { to: '/admin/account', label: 'Il mio account', icon: 'account' },
    { to: '/admin/guida', label: 'Guida', icon: 'help' },
  ],
};

/** Pages of the superadmin with no client entered: the only ones that are not of a client. */
export const SUPERADMIN_MENU: readonly MenuGroup[] = [
  {
    label: 'Amministrazione',
    items: [
      { to: '/admin/clienti', label: 'Clienti', icon: 'tenants' },
      { to: '/admin/campionati', label: 'Campionati', icon: 'leagues' },
      { to: '/admin/posta', label: 'Posta', icon: 'mail' },
      { to: '/admin/loghi-di-sistema', label: 'Loghi di sistema', icon: 'systemLogos' },
    ],
  },
  ACCOUNT_GROUP,
];

/**
 * Pure: the groups of the side menu for a role. A viewer (sola lettura) sees the matches, the calendar, the club,
 * the public links («Pagina pubblica») and the devices; an administrator also Studio grafico and Simulazione (in
 * «Pagina pubblica», with the links) and the users. The superadmin with no client entered sees only its own pages (`SUPERADMIN_MENU`: clients,
 * championships, mail and the system logos, plus «Il mio account» and «Guida»); inside a client (`inTenant`), the pages of an administrator of that client. «Club» is a group of
 * its own: championships and team of the club are not graphics, they decide the calendar and the links of the
 * matches. Groups without items are left out.
 */
export function menuGroups({
  isAdmin,
  isSuperadmin,
  inTenant,
}: {
  isAdmin: boolean;
  isSuperadmin: boolean;
  /** A superadmin has entered a client (ignored for the other roles: they always work on their own). */
  inTenant: boolean;
}): MenuGroup[] {
  if (isSuperadmin && !inTenant) return [...SUPERADMIN_MENU];
  const groups: MenuGroup[] = [
    {
      label: 'Partite',
      items: [
        { to: '/admin/live', label: 'Partita live', icon: 'live' },
        { to: '/admin/partite', label: 'Partite', icon: 'matches' },
        { to: '/admin/calendario', label: 'Calendario', icon: 'calendar' },
      ],
    },
    { label: 'Statistiche', items: [{ to: '/admin/statistiche', label: 'Visualizzazioni', icon: 'stats' }] },
    { label: 'Club', items: [{ to: '/admin/club', label: 'Club', icon: 'club' }] },
    {
      label: 'Pagina pubblica',
      // Graphics, sponsors, links and simulation: what the spectators see. A viewer reads the links only.
      items: [
        ...(isAdmin ? [{ to: '/admin/studio', label: 'Studio grafico', icon: 'branding' } as const] : []),
        ...(isAdmin ? [{ to: '/admin/sponsor', label: 'Sponsor', icon: 'sponsors' } as const] : []),
        { to: '/admin/link', label: 'Link pubblici', icon: 'links' },
        ...(isAdmin ? [{ to: '/admin/simulazione', label: 'Simulazione', icon: 'simulation' } as const] : []),
      ],
    },
    { label: 'Dispositivi', items: [{ to: '/admin/agenti', label: 'Agenti', icon: 'agents' }] },
    {
      label: 'Amministrazione',
      items: isAdmin ? [{ to: '/admin/utenti', label: 'Utenti', icon: 'users' }] : [],
    },
    ACCOUNT_GROUP,
  ];
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Side menu of the reserved area. Desktop and tablet (from 768 px): always on the left, 240 px wide or reduced to the
 * icons (`collapsed`, button at the bottom; the names stay for screen readers and as `title`). Phone: a drawer over the
 * page, opened by the ☰ button of the top bar (`open`). From 768 px it stays under the bar of the client managed by
 * the superadmin (`--sir-admin-bar`, height of that bar; 0 without it): it takes the focus on its first item, Esc or a tap outside
 * close it and give the focus back to the button. The active item has the colours of `--sir-nav-active` (red in
 * «SIR VOLLEY»).
 */
export function AdminSidebar({
  id,
  groups,
  open,
  collapsed,
  onClose,
  onToggleCollapsed,
  returnFocus,
  tenant,
  account,
  home = '/admin/live',
  showCommit = false,
}: {
  id: string;
  groups: readonly MenuGroup[];
  open: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  /** Button that opened the drawer (phone): it gets the focus back when the drawer closes. */
  returnFocus: RefObject<HTMLElement | null>;
  /** Client: the selector of the superadmin or the name of the client. */
  tenant: ReactNode;
  /** Bottom of the menu: user, theme, «Esci». */
  account: (collapsed: boolean) => ReactNode;
  /** Target of the logo: the first page of the user. */
  home?: string;
  /** The commit of the build goes in the `title` of the version (superadmin only). */
  showCommit?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const headingId = useId();
  const wasOpen = useRef(false);

  // Phone: the opened drawer takes the focus; closed, the focus goes back to the ☰ button.
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('nav a[href]')?.focus();
    else if (wasOpen.current) returnFocus.current?.focus();
    wasOpen.current = open;
  }, [open, returnFocus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Names hidden (but read) only on the reduced menu of desktop and tablet; the drawer of the phone is always full.
  const short = collapsed ? 'md:sr-only' : '';
  return (
    <>
      {open && (
        <div
          aria-hidden="true"
          data-testid="menu-backdrop"
          className="fixed inset-0 z-40 bg-bg/70 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        id={id}
        ref={panel}
        aria-labelledby={headingId}
        data-collapsed={collapsed}
        data-open={open}
        className={`sir-sidebar fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface transition-transform duration-200 motion-reduce:transition-none md:visible md:sticky md:top-[var(--sir-admin-bar,0px)] md:z-auto md:h-[calc(100dvh-var(--sir-admin-bar,0px))] md:max-w-none md:translate-x-0 ${
          open ? 'translate-x-0' : 'max-md:invisible -translate-x-full'
        } ${collapsed ? 'md:w-[4.5rem]' : 'md:w-60'}`}
      >
        <h2 id={headingId} className="sr-only">
          Menu dell’area riservata
        </h2>
        <div
          className={`sir-navbar flex items-center border-b border-border px-4 ${collapsed ? 'md:justify-center md:px-2' : ''}`}
        >
          <div className={`min-w-0 flex-1 ${collapsed ? 'md:hidden' : ''}`}>
            <AdminBrand to={home} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi il menu"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-button text-muted hover:bg-hover hover:text-text md:hidden"
          >
            <Icon name="close" />
          </button>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-controls={id}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Espandi il menu' : 'Riduci il menu'}
            title={collapsed ? 'Espandi il menu' : 'Riduci il menu'}
            className="hidden size-10 shrink-0 items-center justify-center rounded-button text-muted hover:bg-hover hover:text-text md:inline-flex"
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} />
          </button>
        </div>
        <nav
          aria-label="Area riservata"
          className="sir-thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
        >
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="mb-3 last:mb-0">
              <h3
                className={`mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted ${collapsed ? 'md:sr-only' : ''}`}
              >
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `flex min-h-11 items-center gap-3 rounded-button px-3 text-sm font-medium md:min-h-9 md:pointer-coarse:min-h-11 ${
                          collapsed ? 'md:justify-center md:px-0' : ''
                        } ${isActive ? 'bg-nav-active text-on-nav-active' : 'text-muted hover:bg-hover hover:text-text'}`
                      }
                    >
                      <Icon name={item.icon} />
                      <span className={`min-w-0 truncate ${short}`}>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border px-3 py-3">
          <div className={collapsed ? 'md:hidden' : ''}>{tenant}</div>
          {account(collapsed)}
          {/* Discreet: not shown on the menu reduced to the icons (tablet and desktop). */}
          <p
            data-testid="app-version"
            title={showCommit && APP_COMMIT ? `Commit ${APP_COMMIT}` : undefined}
            className={`px-1 text-xs text-muted ${collapsed ? 'md:hidden' : ''}`}
          >
            {versionLabel(APP_VERSION, APP_COMMIT, false)}
          </p>
        </div>
      </aside>
    </>
  );
}
