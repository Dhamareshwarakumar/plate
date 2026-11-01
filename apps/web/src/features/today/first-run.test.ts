import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFirstRunDismissed, writeFirstRunDismissed } from './first-run';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('first-run dismissal flag', () => {
  it('round-trips through localStorage', () => {
    expect(readFirstRunDismissed()).toBe(false);
    writeFirstRunDismissed();
    expect(readFirstRunDismissed()).toBe(true);
    expect(localStorage.getItem('plate.firstRun.dismissed')).toBe('1');
  });

  it('ignores foreign values and survives unavailable storage', () => {
    localStorage.setItem('plate.firstRun.dismissed', 'yes');
    expect(readFirstRunDismissed()).toBe(false);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readFirstRunDismissed()).toBe(false);
    expect(() => writeFirstRunDismissed()).not.toThrow();
  });
});
