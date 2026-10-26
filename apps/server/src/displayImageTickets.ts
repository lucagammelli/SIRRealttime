import { DISPLAY_IMAGE_TICKET_MINUTES } from '@arenalive/shared';
import { generateToken, hashToken } from './lib/tokens.js';

/** What a ticket of `POST /api/admin/displays/:id/image` allows: one download, by the same user of the same client. */
export interface DisplayImageGrant {
  tenantId: string;
  userId: string;
  displayId: string;
  displayName: string;
  /** sha256 of the token in the configuration: the download is refused (410) once the player has another one. */
  tokenHash: string;
  /** The slot of the image, with `arenalive-player.json` (token and Wi-Fi password in clear): memory only. */
  slot: Buffer;
}

interface Entry extends DisplayImageGrant {
  expiresAt: number;
}

/** Tickets kept at most: past it the oldest one is dropped (a burst of preparations never fills the memory). */
export const DISPLAY_IMAGE_TICKET_LIMIT = 200;

/**
 * Tickets of the downloads of the images ready for one player: random (as a token), used once, valid for
 * DISPLAY_IMAGE_TICKET_MINUTES, tied to client, user and player. Only in memory (they carry the Wi-Fi password, which
 * never goes into the database), keyed by their sha256; a restart of the server forgets them (prepare again). The
 * slot of a dropped ticket is zeroed.
 */
export class DisplayImageTickets {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly limit = DISPLAY_IMAGE_TICKET_LIMIT,
    private readonly ttlMs = DISPLAY_IMAGE_TICKET_MINUTES * 60_000,
  ) {}

  /** Number of live tickets (for the tests). */
  get size(): number {
    return this.entries.size;
  }

  /** A new ticket for `grant`, with its expiry. */
  issue(grant: DisplayImageGrant): { ticket: string; expiresAt: Date } {
    this.prune();
    while (this.entries.size >= this.limit) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value);
    }
    const ticket = generateToken();
    const expiresAt = this.now() + this.ttlMs;
    this.entries.set(hashToken(ticket), { ...grant, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt) };
  }

  /**
   * The grant of `ticket`, consumed, when it is valid for this client and user; null otherwise (unknown, used,
   * expired; a ticket of another client or user stays as it is).
   */
  take(ticket: string, tenantId: string, userId: string): DisplayImageGrant | null {
    this.prune();
    const key = hashToken(ticket);
    const entry = this.entries.get(key);
    if (!entry || entry.tenantId !== tenantId || entry.userId !== userId) return null;
    this.entries.delete(key);
    const { expiresAt: _expiresAt, ...grant } = entry;
    return grant;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.drop(key);
  }

  private drop(key: string): void {
    this.entries.get(key)?.slot.fill(0);
    this.entries.delete(key);
  }
}
