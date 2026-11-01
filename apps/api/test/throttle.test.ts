import { describe, expect, it } from 'vitest';
import { FailureThrottle } from '../src/auth/throttle.js';

describe('FailureThrottle', () => {
  it('allows until the failure limit, then blocks for the rest of the window', () => {
    let now = 0;
    const t = new FailureThrottle(3, 1000, () => now);
    expect(t.retryAfterMs('ip')).toBe(0);
    t.recordFailure('ip');
    t.recordFailure('ip');
    expect(t.retryAfterMs('ip')).toBe(0);
    t.recordFailure('ip');
    expect(t.retryAfterMs('ip')).toBe(1000);
    now = 400;
    expect(t.retryAfterMs('ip')).toBe(600);
    now = 1000;
    expect(t.retryAfterMs('ip')).toBe(0);
  });

  it('starts a fresh window when a failure arrives after the old one expired', () => {
    let now = 0;
    const t = new FailureThrottle(2, 1000, () => now);
    t.recordFailure('ip');
    now = 1500;
    t.recordFailure('ip');
    expect(t.retryAfterMs('ip')).toBe(0);
  });

  it('tracks keys independently and clears a key on success', () => {
    const t = new FailureThrottle(1, 1000, () => 0);
    t.recordFailure('a');
    expect(t.retryAfterMs('a')).toBe(1000);
    expect(t.retryAfterMs('b')).toBe(0);
    t.recordSuccess('a');
    expect(t.retryAfterMs('a')).toBe(0);
  });
});
