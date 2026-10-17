import type { TenantRef } from '@sir/shared';

/**
 * Bar at the top of every page while a superadmin manages a client: warning colour (`--sir-warn`, distinct from the
 * colours of the client), the name of the client and «Esci dal cliente». Fixed height (3.5 rem on the phone, two
 * lines at most; 2.5 rem from 768 px), the same as `--sir-admin-bar` of the reserved area, so the menu and the
 * sticky previews stay below it. An error of the exit is shown by the page (the bar has no room for it).
 */
export function ManagedTenantBar({ tenant, onLeave, busy }: { tenant: TenantRef; onLeave: () => void; busy: boolean }) {
  return (
    <section
      aria-label="Cliente gestito dal superadmin"
      data-testid="barra-cliente"
      className="flex h-14 items-center gap-3 bg-warn px-3 text-sm text-on-warn md:h-10 sm:px-5"
    >
      <p className="line-clamp-2 min-w-0 flex-1 font-semibold md:line-clamp-1" title={tenant.name}>
        Stai gestendo «{tenant.name}» come superadmin
      </p>
      <button
        type="button"
        onClick={onLeave}
        disabled={busy}
        className="inline-flex min-h-9 shrink-0 items-center rounded-button border-2 border-current px-3 font-semibold hover:bg-on-warn hover:text-warn focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-warn disabled:opacity-60 pointer-coarse:min-h-11 md:min-h-8"
      >
        {busy ? 'Uscita…' : 'Esci dal cliente'}
      </button>
    </section>
  );
}
