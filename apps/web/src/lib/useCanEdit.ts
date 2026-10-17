import { useAuth } from '../pages/admin/auth.tsx';

/** Text next to the commands a `viewer` cannot use (read-only users of the client). */
export const READ_ONLY_TEXT = 'Sola lettura: chiedi a un amministratore del cliente per le modifiche.';

/**
 * Whether the user of the reserved area can change the data of the client: `admin` and `superadmin` yes, `viewer`
 * (sola lettura) no. The pages hide or disable their commands with it; the server refuses them anyway (403).
 */
export function useCanEdit(): boolean {
  return useAuth().isAdmin;
}
