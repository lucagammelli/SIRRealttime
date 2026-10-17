import type { InviteDelivery } from '@sir/shared';
import { CopyButton } from '../../components/ui.tsx';
import { formatDateTime } from '../../lib/format.ts';

/** Text of the outcome of an invitation (pure). */
export function deliveryText(email: string, delivery: InviteDelivery): string {
  if (delivery.mail === 'sent') return `Invito inviato a ${email}.`;
  if (delivery.mail === 'not_configured')
    return 'La posta non è configurata: copia il link e mandalo all’utente a mano.';
  return 'La mail non è partita (il server di posta non l’ha accettata): copia il link e mandalo all’utente a mano.';
}

/**
 * Outcome of an invitation: sent by mail, or the link to copy (no mail server, or the server refused the mail). The
 * link works once and is shown only now.
 */
export function InviteDeliveryBox({ email, delivery }: { email: string; delivery: InviteDelivery }) {
  return (
    <div role="status" className="space-y-2 rounded-card border border-live bg-success-soft p-3 text-sm text-text">
      <p>{deliveryText(email, delivery)}</p>
      {delivery.link && <LinkToCopy link={delivery.link} label="Copia link" />}
      <p className="text-xs text-muted">
        Il link vale fino al {formatDateTime(delivery.expiresAt)} e si usa una volta sola.
      </p>
    </div>
  );
}

/** A link in a selectable box with its copy button. */
export function LinkToCopy({ link, label }: { link: string; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-card bg-surface px-3 py-2 font-mono text-xs text-text select-all">
        {link}
      </code>
      <CopyButton text={link} label={label} />
    </div>
  );
}
