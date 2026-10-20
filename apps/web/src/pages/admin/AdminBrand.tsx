import { hasSystemLogo } from '@arenalive/shared';
import { Link } from 'react-router';
import { BrandMark } from '../../components/BrandMark.tsx';
import { SYSTEM_LOGO_FULL_SIZE, SystemLogo } from '../../components/SystemLogo.tsx';
import { useSystemLogos } from '../../lib/systemLogos.ts';

/**
 * Brand of the reserved area (top of the side menu and header of the phone): the left system logo when there is one,
 * before anything else (logo of the template, logo or name of the client, wordmark), in the variant meant for the
 * background behind it; otherwise the BrandMark. Also on the login page and the pages of the account links.
 * `to`: link to the first page of the user (none without a signed-in user: the logo is then decorative).
 */
export function AdminBrand({ to }: { to?: string }) {
  const { left } = useSystemLogos();
  if (!hasSystemLogo(left)) return to ? <BrandMark to={to} /> : <BrandMark />;
  const logo = <SystemLogo pair={left} side="sinistra" size={SYSTEM_LOGO_FULL_SIZE} />;
  if (!to) return <div className="flex min-h-11 items-center py-1">{logo}</div>;
  return (
    <Link
      to={to}
      className="inline-flex min-h-11 shrink-0 items-center py-1"
      title="Partita live"
      aria-label="Partita live"
    >
      {logo}
    </Link>
  );
}
