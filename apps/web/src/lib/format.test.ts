import { describe, expect, it } from 'vitest';
import { formatBytes } from './format';

describe('formatBytes', () => {
  it('uses decimal units with a decimal from MB up', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1 kB');
    expect(formatBytes(512_000)).toBe('512 kB');
    expect(formatBytes(999_499)).toBe('999 kB');
    expect(formatBytes(1_000_000)).toBe('1 MB');
    expect(formatBytes(1_400_000)).toBe('1.4 MB');
    expect(formatBytes(282_624)).toBe('283 kB');
    expect(formatBytes(2_500_000_000)).toBe('2.5 GB');
  });

  it('never goes negative', () => {
    expect(formatBytes(-5)).toBe('0 B');
  });
});
