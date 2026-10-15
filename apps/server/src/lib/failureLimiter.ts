/**
 * Counts the failures (e.g. unknown share tokens) of each key (the client IP) in a fixed window: past `max`
 * failures the key is blocked, for every request, until the window ends. Successful requests are never counted,
 * so many spectators behind one IP are not limited, while guessing tokens stays as slow as before.
 */
export class FailureLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => Date,
    private readonly maxKeys = 100_000,
  ) {}

  /** Milliseconds until `key` may try again; 0 when it is not blocked. */
  blockedFor(key: string): number {
    const w = this.windows.get(key);
    if (!w) return 0;
    const left = w.resetAt - this.now().getTime();
    if (left <= 0) {
      this.windows.delete(key);
      return 0;
    }
    return w.count >= this.max ? left : 0;
  }

  /** True when `key` has failures in the current window (blocked or not). */
  hasRecent(key: string): boolean {
    const w = this.windows.get(key);
    return w !== undefined && w.resetAt > this.now().getTime() && w.count > 0;
  }

  /** Records a failure of `key`. */
  fail(key: string): void {
    const t = this.now().getTime();
    const w = this.windows.get(key);
    if (w && w.resetAt > t) {
      w.count++;
      return;
    }
    if (this.windows.size >= this.maxKeys) this.sweep(t);
    this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
  }

  private sweep(t: number): void {
    for (const [key, w] of this.windows) if (w.resetAt <= t) this.windows.delete(key);
    // Still full (a flood of distinct IPs): forget the oldest windows.
    for (const key of this.windows.keys()) {
      if (this.windows.size < this.maxKeys) break;
      this.windows.delete(key);
    }
  }
}
