import { useTenantLook } from '../lib/branding.ts';

/**
 * Waiting screen of a player (`/schermo`) given nothing to show: the logo of the client (horizontal, otherwise square,
 * otherwise its name) centred on the canvas, with the name of the player small at the bottom for who installs it.
 */
export function StandbyScreen({ tenantName, displayName }: { tenantName: string; displayName: string }) {
  const look = useTenantLook();
  const logo = look?.images.logoMain ?? look?.images.logoMark ?? null;
  const name = look?.name ?? tenantName;
  return (
    <div role="status" className="flex h-full min-h-0 flex-col items-center justify-center gap-8 p-8 text-center">
      {logo ? (
        <img src={logo} alt={name} className="max-h-[50%] max-w-[70%] object-contain" />
      ) : (
        <p className="font-display text-6xl font-bold uppercase tracking-widest text-primary">{name}</p>
      )}
      {displayName && <p className="text-sm text-muted">{displayName}</p>}
    </div>
  );
}
