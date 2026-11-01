import { describe, expect, it } from 'vitest';
import { parseDecimal } from './number-field';

describe('parseDecimal', () => {
  it('parses dots and commas', () => {
    expect(parseDecimal('1.5')).toBe(1.5);
    expect(parseDecimal('1,5')).toBe(1.5);
    expect(parseDecimal(' 450 ')).toBe(450);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('12.')).toBe(12);
  });
  it('returns null for empty and NaN for garbage', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    expect(Number.isNaN(parseDecimal('abc'))).toBe(true);
    expect(Number.isNaN(parseDecimal('1.2.3'))).toBe(true);
    expect(Number.isNaN(parseDecimal('1e5'))).toBe(true);
  });
});
