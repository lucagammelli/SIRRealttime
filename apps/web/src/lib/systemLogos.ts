import type { SystemLogos } from '@sir/shared';
import { NO_SYSTEM_LOGOS, SystemLogosSchema } from '@sir/shared';
import { useSyncExternalStore } from 'react';

/**
 * Logos of the platform («loghi di sistema», the same for every client): read once at start
 * (`GET /api/public/system-logos`), replaced after a change of the superadmin. Any failure leaves no logo: the
 * headers simply show none.
 */

let logos: SystemLogos = NO_SYSTEM_LOGOS;
const listeners = new Set<() => void>();

/** Replaces the logos in use (after a load, or the answer of a change in the reserved area). */
export function setSystemLogos(next: SystemLogos): void {
  logos = next;
  for (const listener of listeners) listener();
}

/** Reads the logos from the server; null on any failure. `fresh` skips the HTTP cache. */
export async function loadSystemLogos(
  options: { fetch?: typeof fetch; fresh?: boolean } = {},
): Promise<SystemLogos | null> {
  try {
    const res = await (options.fetch ?? fetch)('/api/public/system-logos', {
      credentials: 'omit',
      headers: { accept: 'application/json' },
      ...(options.fresh ? { cache: 'no-cache' as const } : {}),
    });
    if (!res.ok) return null;
    const parsed = SystemLogosSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Loads and applies the logos (at start); a failure keeps what is there. */
export async function initSystemLogos(options: { fetch?: typeof fetch; fresh?: boolean } = {}): Promise<void> {
  const loaded = await loadSystemLogos(options);
  if (loaded) setSystemLogos(loaded);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The system logos in use (none until loaded). */
export function useSystemLogos(): SystemLogos {
  return useSyncExternalStore(
    subscribe,
    () => logos,
    () => NO_SYSTEM_LOGOS,
  );
}
