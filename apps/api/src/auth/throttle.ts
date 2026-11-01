interface Bucket {
  failures: number;
  windowStartedAt: number;
}

/** Keeps the map bounded even if an attacker rotates source addresses. */
const MAX_TRACKED_KEYS = 10_000;

/**
 * Counts *failed* attempts per key (normally the client IP) inside a fixed window and blocks once
 * the limit is hit. Successful attempts never count and clear the key, so signing in on several
 * devices in a row is always fine while brute force is not.
 */
export class FailureThrottle {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Milliseconds until the key may try again, or 0 when it is allowed now. */
  retryAfterMs(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    const elapsed = this.now() - bucket.windowStartedAt;
    if (elapsed >= this.windowMs) {
      this.buckets.delete(key);
      return 0;
    }
    return bucket.failures >= this.maxFailures ? this.windowMs - elapsed : 0;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= this.windowMs) {
      if (this.buckets.size >= MAX_TRACKED_KEYS) this.prune(now);
      this.buckets.set(key, { failures: 1, windowStartedAt: now });
      return;
    }
    bucket.failures += 1;
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStartedAt >= this.windowMs) this.buckets.delete(key);
    }
    // Still full after dropping expired windows: evict the oldest to stay bounded.
    if (this.buckets.size >= MAX_TRACKED_KEYS) {
      const oldest = this.buckets.keys().next();
      if (!oldest.done) this.buckets.delete(oldest.value);
    }
  }
}
