/** Shortest time between two full states sent to one socket because of `resync`. */
export const RESYNC_MIN_INTERVAL_MS = 5000;
/** Most full states sent because of `resync` per second to the sockets of one IP; more wait for a later second. */
export const RESYNC_MAX_PER_IP_PER_S = 100;

const SECOND = 1000;

/**
 * Paces the answers to `resync`: every request is answered, but at most once per `minIntervalMs` per socket (a
 * request inside the interval is answered when it ends, one pending answer per socket) and at most
 * `maxPerIpPerSecond` per IP (the others move to the next free second). A client cannot make the server send full
 * states faster than that, however many requests it sends.
 */
export class ResyncScheduler {
  /** Per IP: the second (ms since epoch / 1000) answers are booked into, and how many are booked there. */
  private readonly perIp = new Map<string, { second: number; count: number }>();

  constructor(
    private readonly now: () => Date,
    private readonly minIntervalMs = RESYNC_MIN_INTERVAL_MS,
    private readonly maxPerIpPerSecond = RESYNC_MAX_PER_IP_PER_S,
  ) {}

  /** Pacing of one socket: `request()` for every `resync`, `cancel()` when the socket closes. */
  forSocket(ip: string | null, send: () => void): { request(): void; cancel(): void } {
    let last = Number.NEGATIVE_INFINITY;
    let timer: NodeJS.Timeout | null = null;
    const fire = (at: number): void => {
      timer = null;
      last = at;
      send();
    };
    return {
      request: () => {
        if (timer) return;
        const t = this.now().getTime();
        const at = this.book(ip, Math.max(t, last + this.minIntervalMs));
        if (at <= t) fire(t);
        else timer = setTimeout(() => fire(at), at - t);
      },
      cancel: () => {
        if (timer) clearTimeout(timer);
        timer = null;
      },
    };
  }

  /** Earliest time from `at` with a free slot of the IP in its second; books it. */
  private book(ip: string | null, at: number): number {
    if (ip === null) return at;
    const second = Math.floor(at / SECOND);
    const slot = this.perIp.get(ip);
    if (!slot || slot.second < second) {
      if (this.perIp.size > 10_000) this.sweep(second);
      this.perIp.set(ip, { second, count: 1 });
      return at;
    }
    if (slot.count < this.maxPerIpPerSecond) {
      slot.count++;
      return slot.second === second ? at : slot.second * SECOND;
    }
    slot.second++;
    slot.count = 1;
    return slot.second * SECOND;
  }

  private sweep(second: number): void {
    for (const [ip, slot] of this.perIp) if (slot.second < second) this.perIp.delete(ip);
  }
}
