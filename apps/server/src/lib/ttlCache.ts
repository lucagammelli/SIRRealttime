/**
 * In-memory cache whose entries expire `ttlMs` after they were stored; at most `maxEntries` (the oldest go first).
 * One process only: with more copies of the server every copy has its own, and the invalidations stay local.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => Date,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** The stored value, or undefined when missing or expired. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now().getTime() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  /** Removes every entry whose value matches (e.g. the share token just revoked). */
  deleteWhere(match: (value: V) => boolean): void {
    for (const [key, entry] of this.entries) if (match(entry.value)) this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
